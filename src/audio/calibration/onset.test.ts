import { describe, expect, it } from 'vitest';
import { calibrationTake } from '../testing/calibration-signal';
import { BandOnsetDetector } from './onset';

const SAMPLE_RATE = 48000;

function onsetTimes(signal: Float32Array, centerHz = 442): number[] {
  const detector = new BandOnsetDetector(SAMPLE_RATE, centerHz);
  const times: number[] = [];
  for (let start = 0; start < signal.length; start += 128) {
    detector.push(signal.subarray(start, start + 128));
    for (let k = 0; k < detector.count; k++) times.push((start + detector.offsets[k]) / SAMPLE_RATE);
  }
  return times;
}

const take = (options: Partial<Parameters<typeof calibrationTake>[0]>) =>
  calibrationTake({ clickTimes: [0.5, 1.5, 2.5], delayMs: 0, leak: 0, durationSec: 3.2, ...options });

describe('BandOnsetDetector', () => {
  it('times a step-onset A within 1 ms', () => {
    for (const noise of [0, 0.05]) {
      const { signal, attackTimes } = take({ delayMs: 40, attackMs: 0.1, noise });
      const onsets = onsetTimes(signal);
      expect(onsets).toHaveLength(3);
      onsets.forEach((t, i) => expect(Math.abs(t - (attackTimes[i] as number))).toBeLessThan(0.001));
    }
  });

  it('times a 30 ms bowed rise within 5 ms of its start', () => {
    const { signal, attackTimes } = take({ delayMs: 40, attackMs: 30, noise: 0.05 });
    const onsets = onsetTimes(signal);
    expect(onsets).toHaveLength(3);
    onsets.forEach((t, i) => expect(Math.abs(t - (attackTimes[i] as number))).toBeLessThan(0.005));
  });

  it('ignores the click leak, even into a silent microphone', () => {
    for (const noise of [0, 0.02, 0.05]) {
      const { signal } = take({ leak: 0.9, noise, missed: [0, 1, 2] });
      expect(onsetTimes(signal)).toEqual([]);
    }
  });

  it('keeps the onset of an A that starts while the click leak still rings', () => {
    const { signal, attackTimes } = take({ delayMs: 3, attackMs: 15, leak: 0.9, noise: 0.01 });
    const onsets = onsetTimes(signal);
    expect(onsets).toHaveLength(3);
    onsets.forEach((t, i) => expect(Math.abs(t - (attackTimes[i] as number))).toBeLessThan(0.004));
  });

  it('stays quiet on noise alone', () => {
    const { signal } = take({ noise: 0.2, missed: [0, 1, 2] });
    expect(onsetTimes(signal)).toEqual([]);
  });

  it('fires once per note, not again while the note sustains', () => {
    const { signal } = take({ noteSeconds: 0.9, noise: 0.02 });
    expect(onsetTimes(signal)).toHaveLength(3);
  });

  it('rejects a centre outside (0, Nyquist)', () => {
    expect(() => new BandOnsetDetector(SAMPLE_RATE, 0)).toThrow(RangeError);
    expect(() => new BandOnsetDetector(SAMPLE_RATE, 30000)).toThrow(RangeError);
  });
});
