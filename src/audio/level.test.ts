import { describe, expect, it } from 'vitest';
import { SILENCE_DB, fallOff, meterFraction, peak, rms, toDbfs } from './level';
import { sine, silence, whiteNoise } from './testing/synth';

describe('level', () => {
  it('measures a full-scale sine at -3 dBFS RMS and 0 dBFS peak', () => {
    const s = sine(442, 0.5);
    s.forEach((v, i) => (s[i] = v / 0.8));
    expect(toDbfs(rms(s))).toBeCloseTo(-3.01, 1);
    expect(toDbfs(peak(s))).toBeCloseTo(0, 3);
  });

  it('treats silence and empty input as the floor', () => {
    expect(rms(new Float32Array(0))).toBe(0);
    expect(toDbfs(rms(silence(0.1)))).toBe(SILENCE_DB);
    expect(toDbfs(1e-9)).toBe(SILENCE_DB);
    expect(toDbfs(Number.NaN)).toBe(SILENCE_DB);
  });

  it('separates quiet noise from a played note', () => {
    const noise = toDbfs(rms(whiteNoise(4800, 0.003)));
    const note = toDbfs(rms(sine(295, 0.1)));
    expect(noise).toBeLessThan(-50);
    expect(note).toBeGreaterThan(-6);
  });

  it('maps dB to a 0–1 meter', () => {
    expect(meterFraction(-80)).toBe(0);
    expect(meterFraction(-60)).toBe(0);
    expect(meterFraction(-30)).toBeCloseTo(0.5);
    expect(meterFraction(0)).toBe(1);
    expect(meterFraction(6)).toBe(1);
    expect(meterFraction(-20, -40)).toBeCloseTo(0.5);
  });

  it('rises instantly and falls at a fixed rate', () => {
    expect(fallOff(-40, -10, 0.016)).toBe(-10);
    expect(fallOff(-10, -60, 0.5)).toBeCloseTo(-30);
    expect(fallOff(-10, -60, 5)).toBe(-60);
  });
});
