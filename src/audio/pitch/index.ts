import workletUrl from './worklet.ts?worker&url';
import { DEFAULT_A4 } from '../notes';
import { PROCESSOR_NAME, type FromProcessor, type ProcessorOptions, type ToProcessor } from './protocol';
import { DEFAULT_MIN_CLARITY, type PitchHandle, type PitchListener, type PitchOptions } from './types';

export * from './types';

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

function assertA4(a4: number): void {
  if (!Number.isFinite(a4) || a4 <= 0) throw new RangeError(`invalid reference A4: ${a4}`);
}

function isAudioNode(source: MediaStream | AudioNode): source is AudioNode {
  return typeof (source as AudioNode).connect === 'function';
}

export async function startPitch(
  source: MediaStream | AudioNode,
  onReading: PitchListener,
  options: PitchOptions = {},
): Promise<PitchHandle> {
  let a4 = options.a4 ?? DEFAULT_A4;
  assertA4(a4);
  const minClarity = options.minClarity ?? DEFAULT_MIN_CLARITY;

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
    const processorOptions: ProcessorOptions = { a4, minClarity };
    node = new AudioWorkletNode(context, PROCESSOR_NAME, {
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

  node.port.onmessage = (event: MessageEvent<FromProcessor>) => onReading(event.data);
  input.connect(node);
  // The processor writes silence; reaching the destination keeps the graph pulling a source nobody else listens to.
  node.connect(context.destination);

  let stopped = false;
  return {
    context,
    get a4() {
      return a4;
    },
    setA4(next: number) {
      assertA4(next);
      a4 = next;
      const message: ToProcessor = { type: 'a4', a4: next };
      node.port.postMessage(message);
    },
    async stop() {
      if (stopped) return;
      stopped = true;
      node.port.onmessage = null;
      input.disconnect(node);
      node.disconnect();
      ownedInput?.disconnect();
      await ownedContext?.close();
    },
  };
}
