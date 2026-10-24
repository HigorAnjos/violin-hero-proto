import { describe, expect, it } from 'vitest';
import { midiToFrequency } from '../notes';
import { calibrationTake, detectAttacks } from '../testing/calibration-signal';
import { concat, silence, tone } from '../testing/synth';

const clickTimes = [0.5, 1.5, 2.5];

describe('AttackTracker', () => {
  it('reports each open A at its onset, with its pitch', () => {
    const { signal, attackTimes } = calibrationTake({ clickTimes, delayMs: 60, noise: 0.05, leak: 0.5 });
    const attacks = detectAttacks(signal);
    expect(attacks).toHaveLength(3);
    attacks.forEach((a, i) => {
      expect(Math.abs(a.time - (attackTimes[i] as number))).toBeLessThan(0.005);
      expect(a.hz).toBeGreaterThan(437);
      expect(a.hz).toBeLessThan(447);
    });
  });

  it('never reports the click leak alone', () => {
    const { signal } = calibrationTake({ clickTimes, delayMs: 0, missed: [0, 1, 2], leak: 1, noise: 0.01 });
    expect(detectAttacks(signal)).toEqual([]);
  });

  it('ignores other notes, even ones with energy near 442 Hz', () => {
    const notes = [midiToFrequency(62), midiToFrequency(70), midiToFrequency(57)].map((frequency) =>
      concat(silence(0.4), tone({ frequency, durationSec: 0.4, peak: 0.5 })),
    );
    expect(detectAttacks(concat(...notes, silence(0.4)))).toEqual([]);
  });

  it('follows a different reference A', () => {
    const { signal } = calibrationTake({ clickTimes, delayMs: 60, a4: 415, noise: 0.02 });
    expect(detectAttacks(signal, { a4: 442 })).toEqual([]);
    expect(detectAttacks(signal, { a4: 415 })).toHaveLength(3);
  });

  it('stamps attacks on the context clock of the first sample', () => {
    const { signal, attackTimes } = calibrationTake({ clickTimes, delayMs: 60 });
    const attacks = detectAttacks(signal, { startAt: 100 });
    expect(Math.abs(attacks[0].time - 100 - (attackTimes[0] as number))).toBeLessThan(0.005);
  });
});
