import { describe, expect, it } from 'vitest';
import { assignBeats, estimate, summarize, trim } from './estimator';
import type { Attack } from './types';

const clicks = [1, 2, 3, 4, 5, 6, 7, 8];
const at = (...times: number[]): Attack[] => times.map((time) => ({ time, hz: 442 }));

describe('assignBeats', () => {
  it('gives each click its closest attack', () => {
    const beats = assignBeats([1, 2], at(1.05, 1.2, 2.08));
    expect(beats.map((b) => b.attackTime)).toEqual([1.05, 2.08]);
    expect(beats[0].delayMs).toBeCloseTo(50);
    expect(beats[1].status).toBe('hit');
  });

  it('marks clicks with no attack as missed', () => {
    const beats = assignBeats([1, 2, 3], at(1.05, 3.05));
    expect(beats.map((b) => b.status)).toEqual(['hit', 'missed', 'hit']);
    expect(beats[1]).toMatchObject({ attackTime: null, delayMs: null });
  });

  it('marks attacks beyond maxDelay as outliers and ignores those beyond twice that', () => {
    const beats = assignBeats([1, 3], at(1.35, 2), 300);
    expect(beats[0]).toMatchObject({ status: 'outlier' });
    expect(beats[0].delayMs).toBeCloseTo(350);
    expect(beats[1].status).toBe('missed');
  });

  it('ignores count-in attacks before the first beat', () => {
    const beats = assignBeats([4, 5], at(3.05, 4.04, 5.06));
    expect(beats.map((b) => b.delayMs?.toFixed(0))).toEqual(['40', '60']);
  });

  it('accepts early attacks', () => {
    expect(assignBeats([1], at(0.97))[0].delayMs).toBeCloseTo(-30);
  });
});

describe('trim', () => {
  it('drops 20% from each end', () => {
    expect(trim([5, 1, 9, 3, 7, 2, 8, 4], 0.2)).toEqual([2, 3, 4, 5, 7, 8]);
    expect(trim([2, 1], 0.2)).toEqual([1, 2]);
  });
});

describe('summarize / estimate', () => {
  it('returns the trimmed mean and its spread', () => {
    const delays = [100, 104, 96, 102, 98, 300, 101, 99];
    const result = estimate(clicks, at(...clicks.map((c, i) => c + delays[i] / 1000)), { maxDelayMs: 400 });
    const kept = [98, 99, 100, 101, 102, 104];
    const mean = kept.reduce((s, d) => s + d, 0) / kept.length;
    expect(result.delayMs).toBeCloseTo(mean, 6);
    expect(result.spreadMs).toBeCloseTo(Math.sqrt(kept.reduce((s, d) => s + (d - mean) ** 2, 0) / 5), 6);
    expect(result.beatsUsed).toBe(8);
    expect(result.ok).toBe(true);
  });

  it('is not ok with fewer than minBeats hits', () => {
    const result = estimate(clicks, at(1.1, 2.1, 3.1, 4.1));
    expect(result.beatsUsed).toBe(4);
    expect(result.ok).toBe(false);
    expect(result.delayMs).toBeCloseTo(100, 6);
  });

  it('gives NaN and not ok when nothing was hit', () => {
    const result = summarize(assignBeats(clicks, []));
    expect(result.delayMs).toBeNaN();
    expect(result.spreadMs).toBe(0);
    expect(result.ok).toBe(false);
    expect(result.beats.every((b) => b.status === 'missed')).toBe(true);
  });
});
