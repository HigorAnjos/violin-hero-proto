import { AttackTracker } from './attack';
import { ATTACK_PROCESSOR_NAME, type AttackProcessorOptions, type FromAttackProcessor } from './protocol';
import type { Attack } from './types';

declare const sampleRate: number;
declare const currentTime: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, processor: new (options: AudioWorkletNodeOptions) => object): void;

class AttackProcessor extends AudioWorkletProcessor {
  private readonly tracker: AttackTracker;
  private readonly onAttack = (attack: Attack): void => {
    const message: FromAttackProcessor = attack;
    this.port.postMessage(message);
  };

  constructor(options: AudioWorkletNodeOptions) {
    super();
    const { a4 } = options.processorOptions as AttackProcessorOptions;
    this.tracker = new AttackTracker({ sampleRate, a4 });
  }

  process(inputs: Float32Array[][]): boolean {
    const channel = inputs[0]?.[0];
    if (channel) this.tracker.push(channel, currentTime, this.onAttack);
    return true;
  }
}

registerProcessor(ATTACK_PROCESSOR_NAME, AttackProcessor);
