import { describe, expect, it, vi } from 'vitest';
import { VIOLIN_HARMONICS } from '../audio/testing/synth';
import { createTestSignal, harmonicWave } from './test-signal';

describe('harmonicWave', () => {
  it('puts the violin harmonics on sine terms after a zero DC term', () => {
    const { real, imag } = harmonicWave();
    expect(real).toHaveLength(VIOLIN_HARMONICS.length + 1);
    expect([...real].every((v) => v === 0)).toBe(true);
    expect(imag[0]).toBe(0);
    expect([...imag.subarray(1)]).toEqual(VIOLIN_HARMONICS.map((h) => Math.fround(h)));
  });
});

describe('createTestSignal', () => {
  it('starts an oscillator at the requested pitch with the harmonic wave', () => {
    const oscillator = { setPeriodicWave: vi.fn(), frequency: { value: 0 }, start: vi.fn() };
    const wave = {};
    const context = {
      createOscillator: () => oscillator,
      createPeriodicWave: vi.fn(() => wave),
    } as unknown as BaseAudioContext;

    const node = createTestSignal(context, 293.6);

    expect(node).toBe(oscillator);
    expect(oscillator.frequency.value).toBe(293.6);
    expect(oscillator.setPeriodicWave).toHaveBeenCalledWith(wave);
    expect(oscillator.start).toHaveBeenCalled();
  });
});
