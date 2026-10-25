import { AttackTracker } from '../calibration/attack';
import { CLICK_PEAK_SECONDS, renderClick } from '../calibration/click';
import type { Attack } from '../calibration/types';
import { DEFAULT_A4 } from '../notes';
import { DEFAULT_SAMPLE_RATE, mulberry32, tone, whiteNoise } from './synth';

export interface PlayerOptions {
  /** Click times in seconds from the start of the signal. */
  clickTimes: readonly number[];
  delayMs: number;
  /** Uniform human jitter, ±ms. */
  jitterMs?: number;
  seed?: number;
  sampleRate?: number;
  a4?: number;
  /** Gain of the click leaking from the speaker into the microphone. */
  leak?: number;
  /** Time from the scheduled click to its leak in the signal (output + input latency). */
  leakLatencyMs?: number;
  noise?: number;
  /** Indices of clicks the player does not answer. */
  missed?: readonly number[];
  /** Extra A attacks, seconds from the start of the signal. */
  extra?: readonly number[];
  noteSeconds?: number;
  attackMs?: number;
  peak?: number;
  durationSec?: number;
}

export interface PlayerSignal {
  signal: Float32Array;
  /** True onset of the A answering each click, or null when missed. */
  attackTimes: (number | null)[];
}

/** A microphone take of the calibration: click leaks, an open A after each click, and noise. */
export function calibrationTake(options: PlayerOptions): PlayerSignal {
  const {
    clickTimes,
    delayMs,
    jitterMs = 0,
    seed = 1,
    sampleRate = DEFAULT_SAMPLE_RATE,
    a4 = DEFAULT_A4,
    leak = 0.3,
    leakLatencyMs = 0,
    noise = 0,
    missed = [],
    extra = [],
    noteSeconds = 0.4,
    attackMs = 15,
    peak = 0.5,
  } = options;
  const last = Math.max(0, ...clickTimes, ...extra);
  const durationSec = options.durationSec ?? last + 1;
  const signal = new Float32Array(Math.round(durationSec * sampleRate));
  const random = mulberry32(seed);

  const click = renderClick(sampleRate, leak);
  for (const time of clickTimes) mix(signal, click, time - CLICK_PEAK_SECONDS + leakLatencyMs / 1000, sampleRate);

  const note = shapedNote({ a4, noteSeconds, attackMs, peak, sampleRate });
  const attackTimes = clickTimes.map((time, index) => {
    const jitter = (random() * 2 - 1) * jitterMs;
    if (missed.includes(index)) return null;
    const onset = time + (delayMs + jitter) / 1000;
    mix(signal, note, onset, sampleRate);
    return onset;
  });
  for (const time of extra) mix(signal, note, time, sampleRate);

  if (noise > 0) {
    const n = whiteNoise(signal.length, noise, seed + 1000);
    for (let i = 0; i < signal.length; i++) signal[i] += n[i];
  }
  return { signal, attackTimes };
}

/** Runs the attack tracker over a signal in 128-sample render quanta, the signal starting at context time `startAt`. */
export function detectAttacks(
  signal: Float32Array,
  options: { sampleRate?: number; a4?: number; startAt?: number } = {},
): Attack[] {
  const { sampleRate = DEFAULT_SAMPLE_RATE, a4 = DEFAULT_A4, startAt = 0 } = options;
  const tracker = new AttackTracker({ sampleRate, a4 });
  const attacks: Attack[] = [];
  const quantum = 128;
  for (let start = 0; start < signal.length; start += quantum) {
    tracker.push(signal.subarray(start, start + quantum), startAt + start / sampleRate, (a) => attacks.push(a));
  }
  return attacks;
}

function shapedNote(options: { a4: number; noteSeconds: number; attackMs: number; peak: number; sampleRate: number }) {
  const { a4, noteSeconds, attackMs, peak, sampleRate } = options;
  const out = tone({ frequency: a4, durationSec: noteSeconds, sampleRate, peak });
  const attack = Math.max(1, Math.round((attackMs / 1000) * sampleRate));
  const release = Math.round(0.03 * sampleRate);
  for (let i = 0; i < attack && i < out.length; i++) out[i] *= i / attack;
  for (let i = 0; i < release; i++) out[out.length - 1 - i] *= i / release;
  return out;
}

function mix(target: Float32Array, source: Float32Array, at: number, sampleRate: number): void {
  const start = Math.round(at * sampleRate);
  for (let i = 0; i < source.length; i++) {
    const j = start + i;
    if (j >= 0 && j < target.length) target[j] += source[i];
  }
}
