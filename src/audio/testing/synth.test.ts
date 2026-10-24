import { describe, expect, it } from 'vitest';
import { buildNoteTable } from '../notes';
import { DEFAULT_SAMPLE_RATE, concat, frames, silence, sine, tone, whiteNoise } from './synth';

const SR = DEFAULT_SAMPLE_RATE;

function magnitudeAt(signal: Float32Array, hz: number, sampleRate = SR): number {
  const w = (2 * Math.PI * hz) / sampleRate;
  let re = 0;
  let im = 0;
  for (let i = 0; i < signal.length; i++) {
    re += signal[i] * Math.cos(w * i);
    im -= signal[i] * Math.sin(w * i);
  }
  return (2 * Math.hypot(re, im)) / signal.length;
}

function upwardCrossings(signal: Float32Array): number[] {
  const at: number[] = [];
  for (let i = 1; i < signal.length; i++) {
    if (signal[i - 1] < 0 && signal[i] >= 0) {
      at.push(i - 1 + -signal[i - 1] / (signal[i] - signal[i - 1]));
    }
  }
  return at;
}

function peak(signal: Float32Array): number {
  return signal.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
}

function rms(signal: Float32Array): number {
  return Math.sqrt(signal.reduce((s, v) => s + v * v, 0) / signal.length);
}

describe('tone', () => {
  it('has the requested length and peak', () => {
    const s = tone({ frequency: 442, durationSec: 0.5, peak: 0.5 });
    expect(s).toHaveLength(SR / 2);
    expect(peak(s)).toBeCloseTo(0.5, 5);
  });

  it('produces the fundamental for every note G3–E6', () => {
    for (const note of buildNoteTable()) {
      const s = sine(note.frequency, 0.2);
      const crossings = upwardCrossings(s);
      const period = (crossings.at(-1)! - crossings[0]) / (crossings.length - 1);
      expect(SR / period).toBeCloseTo(note.frequency, 1);
    }
  });

  it('adds harmonics with the given relative amplitudes', () => {
    const s = tone({ frequency: 300, durationSec: 1, harmonics: [1, 0.5, 0.25], peak: 1 });
    const h1 = magnitudeAt(s, 300);
    expect(magnitudeAt(s, 600) / h1).toBeCloseTo(0.5, 2);
    expect(magnitudeAt(s, 900) / h1).toBeCloseTo(0.25, 2);
    expect(magnitudeAt(s, 1200) / h1).toBeLessThan(0.01);
  });

  it('drops harmonics at or above Nyquist', () => {
    const sampleRate = 8000;
    const s = tone({ frequency: 1500, durationSec: 1, sampleRate, harmonics: [1, 1, 1], peak: 1 });
    expect(magnitudeAt(s, 3000, sampleRate)).toBeGreaterThan(0.4);
    expect(magnitudeAt(s, 3500, sampleRate)).toBeLessThan(0.01);
  });

  it('modulates pitch by ±depth cents at the vibrato rate', () => {
    const f0 = 442;
    const s = tone({ frequency: f0, durationSec: 1, harmonics: [1], vibrato: { depthCents: 30, rateHz: 5 } });
    const crossings = upwardCrossings(s);
    const cents: number[] = [];
    for (let i = 1; i < crossings.length; i++) {
      cents.push(1200 * Math.log2(SR / (crossings[i] - crossings[i - 1]) / f0));
    }
    expect(Math.max(...cents)).toBeGreaterThan(27);
    expect(Math.max(...cents)).toBeLessThan(31);
    expect(Math.min(...cents)).toBeLessThan(-27);
    expect(Math.min(...cents)).toBeGreaterThan(-31);

    const signChanges = cents.slice(1).filter((c, i) => Math.sign(c) !== Math.sign(cents[i])).length;
    expect(signChanges).toBeGreaterThanOrEqual(9);
    expect(signChanges).toBeLessThanOrEqual(11);
  });

  it('mixes deterministic noise on top', () => {
    const clean = tone({ frequency: 442, durationSec: 0.1 });
    const a = tone({ frequency: 442, durationSec: 0.1, noise: 0.1, seed: 7 });
    const b = tone({ frequency: 442, durationSec: 0.1, noise: 0.1, seed: 7 });
    const c = tone({ frequency: 442, durationSec: 0.1, noise: 0.1, seed: 8 });
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    const diff = a.map((v, i) => v - clean[i]);
    expect(rms(diff)).toBeCloseTo(0.1 / Math.sqrt(3), 2);
    expect(peak(diff)).toBeLessThanOrEqual(0.1 + 1e-6);
  });

  it('rejects non-positive parameters', () => {
    expect(() => tone({ frequency: 0, durationSec: 1 })).toThrow(RangeError);
    expect(() => tone({ frequency: 440, durationSec: 0 })).toThrow(RangeError);
  });
});

describe('helpers', () => {
  it('whiteNoise is uniform within ±amplitude', () => {
    const n = whiteNoise(SR, 0.2, 3);
    expect(peak(n)).toBeLessThanOrEqual(0.2);
    expect(rms(n)).toBeCloseTo(0.2 / Math.sqrt(3), 2);
  });

  it('concat and silence build sequences', () => {
    const s = concat(sine(442, 0.1), silence(0.05), sine(330, 0.1));
    expect(s).toHaveLength(Math.round(0.25 * SR));
    expect(peak(s.subarray(0.1 * SR, 0.15 * SR))).toBe(0);
  });

  it('frames slices with hop, dropping the partial tail', () => {
    const f = frames(new Float32Array(1000), 256, 128);
    expect(f).toHaveLength(6);
    expect(f[0]).toHaveLength(256);
  });
});
