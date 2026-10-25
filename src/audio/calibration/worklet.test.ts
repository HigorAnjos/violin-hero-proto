import { beforeEach, describe, expect, it, vi } from 'vitest';
import { calibrationTake } from '../testing/calibration-signal';
import { ATTACK_PROCESSOR_NAME, type AttackProcessorOptions, type FromAttackProcessor } from './protocol';

const SAMPLE_RATE = 48000;
const QUANTUM = 128;

interface Processor {
  port: FakePort;
  process(inputs: Float32Array[][]): boolean;
}

class FakePort {
  readonly sent: FromAttackProcessor[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  postMessage(message: FromAttackProcessor): void {
    this.sent.push(message);
  }
}

let registered: { name: string; ctor: new (options: AudioWorkletNodeOptions) => Processor } | undefined;

beforeEach(async () => {
  registered = undefined;
  vi.resetModules();
  vi.stubGlobal('sampleRate', SAMPLE_RATE);
  vi.stubGlobal('currentTime', 0);
  vi.stubGlobal(
    'AudioWorkletProcessor',
    class {
      readonly port = new FakePort();
    },
  );
  vi.stubGlobal('registerProcessor', (name: string, ctor: never) => {
    registered = { name, ctor };
  });
  await import('./worklet');
});

function create(options: AttackProcessorOptions = { a4: 442 }): Processor {
  return new registered!.ctor({ processorOptions: options });
}

describe('attack worklet', () => {
  it('registers the processor', () => {
    expect(registered?.name).toBe(ATTACK_PROCESSOR_NAME);
  });

  it('posts each A attack on the AudioContext clock', () => {
    const processor = create();
    const offset = 12.5;
    const { signal, attackTimes } = calibrationTake({ clickTimes: [0.5, 1.5], delayMs: 70, noise: 0.03 });
    for (let start = 0; start < signal.length; start += QUANTUM) {
      vi.stubGlobal('currentTime', offset + start / SAMPLE_RATE);
      expect(processor.process([[signal.subarray(start, start + QUANTUM)]])).toBe(true);
    }
    expect(processor.port.sent).toHaveLength(2);
    processor.port.sent.forEach((attack, i) => {
      expect(Math.abs(attack.time - offset - (attackTimes[i] as number))).toBeLessThan(0.005);
    });
  });

  it('keeps running without an input', () => {
    expect(create().process([[]])).toBe(true);
    expect(create().process([])).toBe(true);
  });
});
