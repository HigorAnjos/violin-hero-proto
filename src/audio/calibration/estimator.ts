import { MAX_DELAY_MS, MIN_BEATS, type Attack, type BeatResult, type CalibrationResult } from './types';

export const TRIM_FRACTION = 0.2;
export const OUTLIER_SIGMAS = 3;
/** Scales the median absolute deviation to a standard deviation for normal data. */
const MAD_TO_SIGMA = 1.4826;
/** Floor of the outlier band: ±15 ms of human jitter spans 30 ms, and a beat at one edge must survive a median at the other. */
export const MIN_OUTLIER_MS = 40;

export interface EstimatorOptions {
  maxDelayMs?: number;
  minBeats?: number;
}

/**
 * Each attack goes to its nearest click; a click keeps the attack closest to it. A click with no attack is missed, and
 * one whose attack is beyond ±maxDelayMs is an outlier. Attacks beyond twice that (count-in, stray notes) are ignored.
 */
export function assignBeats(
  clickTimes: readonly number[],
  attacks: readonly Attack[],
  maxDelayMs: number = MAX_DELAY_MS,
): BeatResult[] {
  const best: (number | null)[] = clickTimes.map(() => null);
  for (const attack of attacks) {
    const index = nearest(clickTimes, attack.time);
    if (index < 0) continue;
    const current = best[index];
    const click = clickTimes[index];
    if (Math.abs(attack.time - click) * 1000 > 2 * maxDelayMs) continue;
    if (current === null || Math.abs(attack.time - click) < Math.abs(current - click)) best[index] = attack.time;
  }
  return clickTimes.map((clickTime, index) => {
    const attackTime = best[index];
    if (attackTime === null) return { index, clickTime, attackTime: null, delayMs: null, status: 'missed' };
    const delayMs = (attackTime - clickTime) * 1000;
    return { index, clickTime, attackTime, delayMs, status: Math.abs(delayMs) <= maxDelayMs ? 'hit' : 'outlier' };
  });
}

/**
 * Hits farther than max(3 robust σ, MIN_OUTLIER_MS) from the median become outliers, then the rest are averaged with a
 * 20% trimmed mean. The trim alone cuts one beat per end out of 8, so two late re-bows on the same side would pull the
 * mean ~20 ms.
 */
export function summarize(beats: readonly BeatResult[], minBeats: number = MIN_BEATS): CalibrationResult {
  const hits = beats.filter((b) => b.status === 'hit').map((b) => b.delayMs as number);
  const center = hits.length ? median(hits) : 0;
  const limit = Math.max(OUTLIER_SIGMAS * MAD_TO_SIGMA * (hits.length ? median(hits.map((d) => Math.abs(d - center))) : 0), MIN_OUTLIER_MS);
  const judged = beats.map((b): BeatResult =>
    b.status === 'hit' && Math.abs((b.delayMs as number) - center) > limit ? { ...b, status: 'outlier' } : b,
  );
  const delays = judged.filter((b) => b.status === 'hit').map((b) => b.delayMs as number);
  const trimmed = trim(delays, TRIM_FRACTION);
  const delayMs = mean(trimmed);
  const spreadMs = trimmed.length > 1 ? Math.sqrt(trimmed.reduce((s, d) => s + (d - delayMs) ** 2, 0) / (trimmed.length - 1)) : 0;
  return { delayMs, spreadMs, beatsUsed: delays.length, beats: judged, ok: delays.length >= minBeats };
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function estimate(
  clickTimes: readonly number[],
  attacks: readonly Attack[],
  options: EstimatorOptions = {},
): CalibrationResult {
  return summarize(assignBeats(clickTimes, attacks, options.maxDelayMs), options.minBeats);
}

/** Drops floor(n·fraction) values from each end of the sorted list. */
export function trim(values: readonly number[], fraction: number): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const cut = Math.floor(sorted.length * fraction);
  return sorted.slice(cut, sorted.length - cut);
}

function mean(values: readonly number[]): number {
  return values.length ? values.reduce((s, v) => s + v, 0) / values.length : Number.NaN;
}

function nearest(times: readonly number[], time: number): number {
  let index = -1;
  let distance = Infinity;
  for (let i = 0; i < times.length; i++) {
    const d = Math.abs(times[i] - time);
    if (d < distance) {
      distance = d;
      index = i;
    }
  }
  return index;
}
