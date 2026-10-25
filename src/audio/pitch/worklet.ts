import { PROCESSOR_NAME, type FromProcessor, type ProcessorOptions, type ToProcessor } from './protocol';
import { PitchTracker, type SlidingWindow } from './tracker';

declare const sampleRate: number;
declare const currentTime: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, processor: new (options: AudioWorkletNodeOptions) => object): void;

class PitchProcessor extends AudioWorkletProcessor {
  private readonly tracker: PitchTracker;
  private readonly stream: SlidingWindow;
  private blockStart = 0;
  private readonly onWindow = (window: Float32Array, end: number): void => {
    const event: FromProcessor | undefined = this.tracker.analyse(window, this.blockStart + end / sampleRate);
    if (event !== undefined) this.port.postMessage(event);
  };

  constructor(options: AudioWorkletNodeOptions) {
    super();
    const { a4, minClarity } = options.processorOptions as ProcessorOptions;
    this.tracker = new PitchTracker({ sampleRate, a4, minClarity });
    this.stream = this.tracker.createWindow();
    this.port.onmessage = (event: MessageEvent<ToProcessor>) => {
      if (event.data.type === 'a4') this.tracker.setA4(event.data.a4);
    };
  }

  process(inputs: Float32Array[][]): boolean {
    const channel = inputs[0]?.[0];
    if (!channel) return true;
    this.blockStart = currentTime;
    this.stream.push(channel, this.onWindow);
    return true;
  }
}

registerProcessor(PROCESSOR_NAME, PitchProcessor);
