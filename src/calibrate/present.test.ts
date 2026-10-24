import { describe, expect, it } from 'vitest';
import type { BeatResult, CalibrationResult } from '../audio/calibration/types';
import {
  formatMs,
  markerView,
  outputContextTime,
  parseSimulateMs,
  pulsePhase,
  pulseText,
  resultView,
  savedText,
  toCompensation,
} from './present';

const beat = (over: Partial<BeatResult>): BeatResult => ({
  index: 0,
  clickTime: 1,
  attackTime: 1.08,
  delayMs: 80,
  status: 'hit',
  ...over,
});

const result = (over: Partial<CalibrationResult>): CalibrationResult => ({
  delayMs: 84.4,
  spreadMs: 6.2,
  beatsUsed: 8,
  beats: Array.from({ length: 8 }, (_, index) => beat({ index })),
  ok: true,
  ...over,
});

describe('parseSimulateMs', () => {
  it.each([
    ['?simular=120', 120],
    ['?simular=0', 0],
    ['?simular=80,5', 80.5],
    ['?simular=%2095%20', 95],
    ['?simular=1000', 1000],
  ])('reads %s as %d ms', (search, ms) => {
    expect(parseSimulateMs(search)).toBe(ms);
  });

  it.each(['', '?simular=', '?simular=abc', '?simular=-5', '?simular=1001', '?sinal=440'])(
    'ignores %j',
    (search) => {
      expect(parseSimulateMs(search)).toBeNull();
    },
  );
});

describe('formatMs', () => {
  it.each([
    [84.4, '84 ms'],
    [84.5, '85 ms'],
    [0, '0 ms'],
    [-0.2, '0 ms'],
    [-12, '−12 ms'],
  ])('formats %d', (ms, text) => {
    expect(formatMs(ms)).toBe(text);
  });
});

describe('markerView', () => {
  it('shows the beat number while waiting', () => {
    expect(markerView(2, undefined)).toEqual({ state: 'pending', text: '3', label: 'Batida 3: aguardando' });
  });

  it('shows the delay of a hit', () => {
    expect(markerView(0, beat({ delayMs: 92.6 }))).toEqual({ state: 'hit', text: '93 ms', label: 'Batida 1: 93 ms' });
  });

  it('marks a missed beat', () => {
    expect(markerView(4, beat({ status: 'missed', attackTime: null, delayMs: null }))).toMatchObject({
      state: 'missed',
      text: '—',
    });
  });

  it('keeps the delay of an outlier but says it was discarded', () => {
    expect(markerView(1, beat({ status: 'outlier', delayMs: 230 }))).toEqual({
      state: 'outlier',
      text: '230 ms',
      label: 'Batida 2: 230 ms, descartada',
    });
  });
});

describe('pulsePhase', () => {
  const schedule = { countIn: [1, 2, 3, 4], beats: [5, 6, 7, 8, 9, 10, 11, 12] };

  it('waits before the first click', () => {
    expect(pulsePhase(0.99, schedule)).toEqual({ kind: 'waiting' });
  });

  it('counts down during the count-in and lights right after each click', () => {
    expect(pulsePhase(1, schedule)).toEqual({ kind: 'count-in', index: 0, remaining: 4, lit: true });
    expect(pulsePhase(1.5, schedule)).toEqual({ kind: 'count-in', index: 0, remaining: 4, lit: false });
    expect(pulsePhase(4.1, schedule)).toEqual({ kind: 'count-in', index: 3, remaining: 1, lit: true });
  });

  it('follows the measured beats', () => {
    expect(pulsePhase(5.05, schedule)).toEqual({ kind: 'beat', index: 0, lit: true });
    expect(pulsePhase(11.9, schedule)).toEqual({ kind: 'beat', index: 6, lit: false });
    expect(pulsePhase(12.5, schedule)).toEqual({ kind: 'beat', index: 7, lit: false });
  });

  it('finishes one interval after the last click', () => {
    expect(pulsePhase(13, schedule)).toEqual({ kind: 'finished' });
  });

  it('works without count-in', () => {
    expect(pulsePhase(0.5, { countIn: [], beats: [0.5, 1] })).toEqual({ kind: 'beat', index: 0, lit: true });
  });
});

describe('pulseText', () => {
  it.each([
    [{ kind: 'waiting' } as const, 'Prepare o arco…'],
    [{ kind: 'count-in', index: 1, remaining: 3, lit: true } as const, '3'],
    [{ kind: 'beat', index: 4, lit: false } as const, '5/8'],
    [{ kind: 'finished' } as const, 'Pronto'],
  ])('%j → %s', (phase, text) => {
    expect(pulseText(phase, 8)).toBe(text);
  });
});

describe('resultView', () => {
  it('shows mean and spread of a trusted session', () => {
    expect(resultView(result({}))).toEqual({
      delay: '84 ms',
      spread: '± 6 ms',
      summary: '8 de 8 batidas usadas.',
      canSave: true,
    });
  });

  it('refuses to save an untrusted session', () => {
    const view = resultView(result({ ok: false, beatsUsed: 3, delayMs: 70 }));
    expect(view.canSave).toBe(false);
    expect(view.delay).toBe('—');
    expect(view.summary).toMatch(/^Só 3 de 8 batidas valeram/);
  });

  it('refuses a NaN delay even if flagged ok', () => {
    expect(resultView(result({ delayMs: Number.NaN })).canSave).toBe(false);
  });
});

describe('toCompensation', () => {
  it('stamps the measurement time', () => {
    expect(toCompensation(result({}), new Date('2026-10-24T15:30:00Z'))).toEqual({
      delayMs: 84.4,
      spreadMs: 6.2,
      measuredAt: '2026-10-24T15:30:00.000Z',
    });
  });
});

describe('savedText', () => {
  it('explains the default when nothing is saved', () => {
    expect(savedText(null)).toBe('Nenhuma calibração salva. O jogo usa 0 ms.');
  });

  it('shows value, spread and local date', () => {
    expect(savedText({ delayMs: 84.4, spreadMs: 6.2, measuredAt: '2026-10-24T15:30:00Z' })).toBe(
      'Salvo: 84 ms (± 6 ms) em 24/10, 12:30.',
    );
  });

  it('omits an unreadable date', () => {
    expect(savedText({ delayMs: 50, spreadMs: 0, measuredAt: '' })).toBe('Salvo: 50 ms (± 0 ms).');
  });
});

describe('outputContextTime', () => {
  it('extrapolates from the last output timestamp', () => {
    expect(outputContextTime(1250, { contextTime: 3, performanceTime: 1000 })).toBeCloseTo(3.25);
  });
});
