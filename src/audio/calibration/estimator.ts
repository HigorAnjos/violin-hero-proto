import { MAX_DELAY_MS, MIN_BEATS, type Attack, type BeatResult, type CalibrationResult } from './types';

export const TRIM_FRACTION = 0.2;

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

export function summarize(beats: readonly BeatResult[], minBeats: number = MIN_BEATS): CalibrationResult {
  const delays = beats.filter((b) => b.status === 'hit').map((b) => b.delayMs as number);
  const trimmed = trim(delays, TRIM_FRACTION);
  const delayMs = mean(trimmed);
  const spreadMs = trimmed.length > 1 ? Math.sqrt(trimmed.reduce((s, d) => s + (d - delayMs) ** 2, 0) / (trimmed.length - 1)) : 0;
  return { delayMs, spreadMs, beatsUsed: delays.length, beats: [...beats], ok: delays.length >= minBeats };
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
