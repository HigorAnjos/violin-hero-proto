import { describe, expect, it } from 'vitest';
import { calibrationTake, detectAttacks, type PlayerOptions } from '../testing/calibration-signal';
import { estimate, trim, TRIM_FRACTION } from './estimator';
import { clickSchedule } from './schedule';
import type { CalibrationResult } from './types';

const START_AT = 0.5;
const schedule = clickSchedule(START_AT);
const allClicks = [...schedule.countIn, ...schedule.beats];
const COUNT_IN = schedule.countIn.length;

interface Session {
  result: CalibrationResult;
  /** Trimmed mean of the true delays of the beats the estimator kept. */
  truth: number;
}

function session(options: Partial<PlayerOptions> & { delayMs: number }): Session {
  const { signal, attackTimes } = calibrationTake({
    clickTimes: allClicks,
    jitterMs: 15,
    noise: 0.05,
    leak: 0.5,
    leakLatencyMs: 5,
    ...options,
  });
  const result = estimate(schedule.beats, detectAttacks(signal));
  const kept = result.beats
    .filter((b) => b.status === 'hit')
    .map((b) => ((attackTimes[COUNT_IN + b.index] as number) - b.clickTime) * 1000);
  const trimmed = trim(kept, TRIM_FRACTION);
  return { result, truth: trimmed.reduce((s, d) => s + d, 0) / trimmed.length };
}

describe('calibration on generated takes (F3 ready-when)', () => {
  for (const delayMs of [0, 40, 120, 250]) {
    it(`recovers a ${delayMs} ms delay within 5 ms, three sessions within 20 ms`, () => {
      const sessions = [11, 22, 33].map((seed) => session({ delayMs, seed }));
      for (const { result, truth } of sessions) {
        expect(result.ok).toBe(true);
        expect(result.beatsUsed).toBe(8);
        expect(Math.abs(result.delayMs - truth)).toBeLessThanOrEqual(5);
        expect(Math.abs(result.delayMs - delayMs)).toBeLessThanOrEqual(15);
        for (const beat of result.beats) expect(beat.status).toBe('hit');
      }
      const delays = sessions.map((s) => s.result.delayMs);
      expect(Math.max(...delays) - Math.min(...delays)).toBeLessThanOrEqual(20);
    }, 30000);
  }

  it('survives missed beats, extra notes and count-in playing', () => {
    const beats = schedule.beats;
    const extra = [beats[1] + 0.5, beats[4] + 0.45, schedule.countIn[2] + 0.05, beats[6] + 0.15];
    const { result, truth } = session({ delayMs: 80, seed: 7, missed: [COUNT_IN + 2, COUNT_IN + 5], extra });
    expect(result.beats[2].status).not.toBe('hit');
    expect(result.beats[5].status).not.toBe('hit');
    expect(result.beatsUsed).toBe(6);
    expect(result.ok).toBe(true);
    expect(Math.abs(result.delayMs - truth)).toBeLessThanOrEqual(5);
  }, 30000);

  it('reports a session with too few beats as not ok instead of a number to trust', () => {
    const missed = [0, 1, 2, 3, 4].map((i) => COUNT_IN + i);
    const { result } = session({ delayMs: 60, seed: 3, missed });
    expect(result.beatsUsed).toBe(3);
    expect(result.ok).toBe(false);
  }, 30000);

  it('ignores a take that is only click leak and noise', () => {
    const { result } = session({ delayMs: 0, seed: 5, missed: allClicks.map((_, i) => i), leak: 1 });
    expect(result.beatsUsed).toBe(0);
    expect(result.ok).toBe(false);
  }, 30000);
});
