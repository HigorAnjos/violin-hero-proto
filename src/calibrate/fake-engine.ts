import { clickSchedule } from '../audio/calibration/schedule';
import type {
  BeatResult,
  CalibrationHandle,
  CalibrationOptions,
  CalibrationResult,
  StartCalibration,
} from '../audio/calibration/types';
import { MAX_DELAY_MS, MIN_BEATS } from '../audio/calibration/types';

// Stand-in until src/audio/calibration/index.ts lands: plays the clicks and reports fake beats around 85 ms.
export const startCalibration: StartCalibration = async (source, options: CalibrationOptions = {}) => {
  const context = source instanceof AudioNode ? source.context : (options.context as BaseAudioContext);
  const startAt = options.startAt ?? context.currentTime + 0.5;
  const schedule = clickSchedule(startAt, options);
  const emit = options.onEvent ?? (() => undefined);
  const timers: number[] = [];
  const at = (time: number, fn: () => void) =>
    timers.push(window.setTimeout(fn, Math.max(0, (time - context.currentTime) * 1000)));

  const clicks = [...schedule.countIn, ...schedule.beats];
  for (const time of clicks) {
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.frequency.value = 1500;
    gain.gain.setValueAtTime(0.5, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.03);
    osc.connect(gain).connect(context.destination);
    osc.start(time);
    osc.stop(time + 0.04);
  }

  emit({ type: 'scheduled', schedule });
  const beats: BeatResult[] = [];
  let cancelled = false;
  let abort: () => void = () => undefined;
  const result = new Promise<CalibrationResult>((resolve, reject) => {
    clicks.forEach((time, i) =>
      at(time, () => emit({ type: 'click', index: i, time, countIn: i < schedule.countIn.length })),
    );
    schedule.beats.forEach((clickTime, index) => {
      at(clickTime + MAX_DELAY_MS / 1000, () => {
        const missed = index === 5;
        const delayMs = missed ? null : 85 + 6 * Math.sin(index * 1.7);
        const beat: BeatResult = {
          index,
          clickTime,
          attackTime: delayMs == null ? null : clickTime + delayMs / 1000,
          delayMs,
          status: missed ? 'missed' : 'hit',
        };
        beats.push(beat);
        emit({ type: 'beat', beat });
        if (index === schedule.beats.length - 1) {
          const kept = beats.filter((b) => b.status === 'hit').map((b) => b.delayMs!);
          const mean = kept.reduce((a, b) => a + b, 0) / kept.length;
          const spread = Math.sqrt(kept.reduce((a, b) => a + (b - mean) ** 2, 0) / kept.length);
          const done = { delayMs: mean, spreadMs: spread, beatsUsed: kept.length, beats, ok: kept.length >= MIN_BEATS };
          emit({ type: 'done', result: done });
          resolve(done);
        }
      });
    });
    abort = () => reject(new DOMException('calibration cancelled', 'AbortError'));
  });
  result.catch(() => undefined);
  const handle: CalibrationHandle = {
    context,
    schedule,
    result,
    async cancel() {
      if (cancelled) return;
      cancelled = true;
      timers.forEach((t) => window.clearTimeout(t));
      abort();
    },
  };
  return handle;
};
