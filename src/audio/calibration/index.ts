import workletUrl from './worklet.ts?worker&url';
import { DEFAULT_A4 } from '../notes';
import { CONFIRM_SECONDS } from './attack';
import { scheduleClicks } from './click';
import { assignBeats, summarize } from './estimator';
import { ATTACK_PROCESSOR_NAME, type AttackProcessorOptions, type FromAttackProcessor } from './protocol';
import { clickSchedule } from './schedule';
import { saveCompensation } from './storage';
import {
  DEFAULT_BPM,
  MAX_DELAY_MS,
  type Attack,
  type BeatResult,
  type CalibrationEvent,
  type CalibrationHandle,
  type CalibrationOptions,
  type CalibrationResult,
} from './types';

export * from './types';
export { clickSchedule } from './schedule';
export { clearCompensation, compensationSeconds, loadCompensation, saveCompensation } from './storage';

export const LEAD_IN_SECONDS = 0.5;
const TICK_MS = 20;
/** postMessage and timer slack after the attack tracker's own confirmation window. */
const CLOSE_MARGIN_SECONDS = 0.05;

const modules = new WeakMap<BaseAudioContext, Promise<void>>();

function loadProcessor(context: BaseAudioContext): Promise<void> {
  let loading = modules.get(context);
  if (!loading) {
    loading = context.audioWorklet.addModule(workletUrl);
    loading.catch(() => modules.delete(context));
    modules.set(context, loading);
  }
  return loading;
}

function isAudioNode(source: MediaStream | AudioNode): source is AudioNode {
  return typeof (source as AudioNode).connect === 'function';
}

export async function startCalibration(
  source: MediaStream | AudioNode,
  options: CalibrationOptions = {},
): Promise<CalibrationHandle> {
  const a4 = options.a4 ?? DEFAULT_A4;
  if (!Number.isFinite(a4) || a4 <= 0) throw new RangeError(`invalid reference A4: ${a4}`);
  const bpm = options.bpm ?? DEFAULT_BPM;
  const emit = (event: CalibrationEvent) => options.onEvent?.(event);

  let context: BaseAudioContext;
  let input: AudioNode;
  let ownedContext: AudioContext | undefined;
  let ownedInput: AudioNode | undefined;
  let resumed: Promise<void> | undefined;
  if (isAudioNode(source)) {
    context = source.context;
    input = source;
  } else {
    if (options.context) {
      context = options.context;
    } else {
      // Created and resumed before the first await so iOS Safari still counts it as inside the user gesture.
      ownedContext = new AudioContext({ latencyHint: 'interactive' });
      resumed = ownedContext.resume();
      context = ownedContext;
    }
    input = ownedInput = (context as AudioContext).createMediaStreamSource(source);
  }

  let node: AudioWorkletNode;
  try {
    if (ownedContext) {
      await resumed;
      if (ownedContext.state !== 'running') {
        throw new DOMException(`audio context is ${ownedContext.state}`, 'InvalidStateError');
      }
    }
    await loadProcessor(context);
    const processorOptions: AttackProcessorOptions = { a4 };
    node = new AudioWorkletNode(context, ATTACK_PROCESSOR_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCount: 1,
      channelCountMode: 'explicit',
      processorOptions,
    });
  } catch (error) {
    ownedInput?.disconnect();
    await ownedContext?.close().catch(() => undefined);
    throw error;
  }

  // Read the clock only after addModule: on a phone it can take long enough to put a precomputed count-in in the past.
  const startAt = options.startAt ?? context.currentTime + LEAD_IN_SECONDS;
  const schedule = clickSchedule(startAt, { bpm, beats: options.beats, countIn: options.countIn });
  const clicks = [
    ...schedule.countIn.map((time, index) => ({ time, index, countIn: true })),
    ...schedule.beats.map((time, index) => ({ time, index, countIn: false })),
  ];
  const closeAfter = Math.min(30 / bpm, (2 * MAX_DELAY_MS) / 1000) + CONFIRM_SECONDS + CLOSE_MARGIN_SECONDS;

  const attacks: Attack[] = [];
  const beats: BeatResult[] = [];
  let nextClick = 0;
  let settled = false;
  let resolve!: (result: CalibrationResult) => void;
  let reject!: (error: unknown) => void;
  const result = new Promise<CalibrationResult>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  result.catch(() => undefined);

  node.port.onmessage = (event: MessageEvent<FromAttackProcessor>) => {
    attacks.push(event.data);
    emit({ type: 'attack', attack: event.data });
  };
  input.connect(node);
  // The processor writes silence; reaching the destination keeps the graph pulling a source nobody else listens to.
  node.connect(context.destination);
  const stopClicks = scheduleClicks(context, clicks.map((c) => c.time));

  let timer: ReturnType<typeof setInterval> | undefined;
  let tornDown: Promise<void> | undefined;
  const teardown = (): Promise<void> => {
    tornDown ??= (async () => {
      if (timer !== undefined) clearInterval(timer);
      stopClicks();
      node.port.onmessage = null;
      input.disconnect(node);
      node.disconnect();
      ownedInput?.disconnect();
      await ownedContext?.close().catch(() => undefined);
    })();
    return tornDown;
  };

  const tick = () => {
    if (settled) return;
    const now = context.currentTime;
    while (nextClick < clicks.length && clicks[nextClick].time <= now) {
      const { index, time, countIn } = clicks[nextClick++];
      emit({ type: 'click', index, time, countIn });
    }
    while (beats.length < schedule.beats.length && schedule.beats[beats.length] + closeAfter <= now) {
      const beat = assignBeats(schedule.beats, attacks)[beats.length];
      beats.push(beat);
      emit({ type: 'beat', beat });
    }
    if (beats.length < schedule.beats.length) return;
    settled = true;
    const final = summarize(beats);
    if (final.ok && options.save !== false) {
      saveCompensation({ delayMs: final.delayMs, spreadMs: final.spreadMs, measuredAt: new Date().toISOString() });
    }
    void teardown();
    emit({ type: 'done', result: final });
    resolve(final);
  };

  emit({ type: 'scheduled', schedule });
  timer = setInterval(tick, TICK_MS);

  return {
    context,
    schedule,
    result,
    async cancel() {
      if (!settled) {
        settled = true;
        reject(new DOMException('calibration cancelled', 'AbortError'));
      }
      await teardown();
    },
  };
}
