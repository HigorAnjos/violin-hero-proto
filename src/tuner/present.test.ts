import { describe, expect, it } from 'vitest';
import {
  STATE_COLORS,
  clampCents,
  formatCents,
  formatHz,
  needleFraction,
  tuneHint,
  tuneState,
} from './present';

describe('needleFraction', () => {
  it.each([
    [-50, 0],
    [-25, 0.25],
    [0, 0.5],
    [25, 0.75],
    [50, 1],
  ])('maps %d cents to %d of the gauge', (cents, fraction) => {
    expect(needleFraction(cents)).toBeCloseTo(fraction);
  });

  it('pins the needle at the ends outside ±50 cents', () => {
    expect(needleFraction(-80)).toBe(0);
    expect(needleFraction(120)).toBe(1);
    expect(clampCents(-80)).toBe(-50);
  });
});

describe('tuneState', () => {
  it.each([
    [0, 'in-tune'],
    [5, 'in-tune'],
    [-5, 'in-tune'],
    [5.1, 'close'],
    [-15, 'close'],
    [15.1, 'off'],
    [-49, 'off'],
  ] as const)('classifies %d cents as %s', (cents, state) => {
    expect(tuneState(cents)).toBe(state);
  });

  it('paints in-tune green', () => {
    expect(STATE_COLORS[tuneState(2)]).toBe('#4cc38a');
  });
});

describe('tuneHint', () => {
  it('tells the player which way to turn the peg', () => {
    expect(tuneHint(1)).toBe('Afinado');
    expect(tuneHint(-20)).toBe('Baixo · suba');
    expect(tuneHint(20)).toBe('Alto · desça');
  });
});

describe('formatHz', () => {
  it('uses one decimal with a pt-BR comma', () => {
    expect(formatHz(293.62)).toBe('293,6 Hz');
    expect(formatHz(442)).toBe('442,0 Hz');
    expect(formatHz(1318.5)).toBe('1.318,5 Hz');
  });
});

describe('formatCents', () => {
  it('rounds and signs with a true minus', () => {
    expect(formatCents(12.4)).toBe('+12');
    expect(formatCents(-3.6)).toBe('−4');
    expect(formatCents(0.4)).toBe('0');
    expect(formatCents(-0.4)).toBe('0');
  });
});
