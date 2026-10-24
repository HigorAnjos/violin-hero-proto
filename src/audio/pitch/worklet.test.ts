import { beforeEach, describe, expect, it, vi } from 'vitest';
import { midiToFrequency } from '../notes';
import { concat, silence, tone } from '../testing/synth';
import { PROCESSOR_NAME, type FromProcessor, type ProcessorOptions } from './protocol';

const SAMPLE_RATE = 48000;
const QUANTUM = 128;

interface Processor {
  port: FakePort;
  process(inputs: Float32Array[][]): boolean;
}

class FakePort {
  readonly sent: FromProcessor[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  postMessage(message: FromProcessor): void {
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

function create(options: ProcessorOptions = { a4: 442, minClarity: 0.9 }): Processor {
  return new registered!.ctor({ processorOptions: options });
}

function feed(processor: Processor, signal: Float32Array): void {
  for (let start = 0; start < signal.length; start += QUANTUM) {
    vi.stubGlobal('currentTime', start / SAMPLE_RATE);
    expect(processor.process([[signal.subarray(start, start + QUANTUM)]])).toBe(true);
  }
}

describe('pitch worklet', () => {
  it('registers the processor', () => {
    expect(registered?.name).toBe(PROCESSOR_NAME);
  });

  it('posts a reading about every 10 ms with AudioContext time', () => {
    const processor = create();
    feed(processor, tone({ frequency: midiToFrequency(62), durationSec: 1 }));
    const readings = processor.port.sent.filter((m) => m !== null);
    expect(readings.length).toBeGreaterThanOrEqual(94);
    expect(readings.every((r) => r.midi === 62)).toBe(true);
    const gaps = readings.slice(1).map((r, i) => r.time - readings[i].time);
    for (const gap of gaps) expect(gap).toBeCloseTo(0.01, 6);
    expect(readings.at(-1)!.time).toBeCloseTo(1, 1);
  });

  it('posts one null when the signal goes silent', () => {
    const processor = create();
    feed(processor, concat(tone({ frequency: 440, durationSec: 0.2 }), silence(0.2)));
    expect(processor.port.sent.filter((m) => m === null)).toHaveLength(1);
    expect(processor.port.sent.at(-1)).toBeNull();
  });

  it('keeps running without input', () => {
    const processor = create();
    expect(processor.process([[]])).toBe(true);
    expect(processor.process([])).toBe(true);
    expect(processor.port.sent).toEqual([]);
  });

  it('applies an A4 change sent from the main thread', () => {
    const processor = create({ a4: 442, minClarity: 0.9 });
    processor.port.onmessage!({ data: { type: 'a4', a4: 440 } });
    feed(processor, tone({ frequency: 440, durationSec: 0.3 }));
    const last = processor.port.sent.at(-1)!;
    expect(last.cents).toBeCloseTo(0, 0);
  });
});
