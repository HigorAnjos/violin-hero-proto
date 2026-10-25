import { describe, expect, it, vi } from 'vitest';
import { PitchTracker, SlidingWindow } from '../audio/pitch/tracker';
import { createJudge } from './judge';
import { ODE_TO_JOY, scheduleSong } from './song';
import { LEAD_SECONDS, parseSimulate, pickWrongNotes, renderPerformance, simulatePlayer, type PerformanceOptions } from './simulate';
import type { GameEvent, GameResult } from './types';

const A4 = 442;
const BLOCK = 128;

/** Plays a rendered take through the real pitch tracker into the judge, as the worklet would, block by block. */
function playGame(options: PerformanceOptions): { result: GameResult; events: GameEvent[]; wrong: number[] } {
  const take = renderPerformance(ODE_TO_JOY, { a4: A4, ...options });
  const { signal, sampleRate } = take;
  const events: GameEvent[] = [];
  const judge = createJudge(scheduleSong(ODE_TO_JOY, LEAD_SECONDS, A4), { onEvent: (e) => events.push(e) });
  const tracker = new PitchTracker({ sampleRate, a4: A4 });
  const stream = new SlidingWindow(tracker.windowSize, tracker.hopSize);
  for (let start = 0; start < signal.length && !judge.done; start += BLOCK) {
    const blockStart = start / sampleRate;
    stream.push(signal.subarray(start, start + BLOCK), (window, end) => {
      const reading = tracker.analyse(window, blockStart + end / sampleRate);
      if (reading !== undefined) judge.push(reading);
    });
    judge.advance((start + BLOCK) / sampleRate);
  }
  return { result: judge.result(), events, wrong: take.wrong };
}

// ~3 s of pitch tracking per game; the default 5 s timeout trips when the whole suite shares the CPU.
describe('whole game with the simulated player', { timeout: 30_000 }, () => {
  it('on time: every note Perfeito, full combo', () => {
    const { result } = playGame({ offsetMs: 0 });
    expect(result.judgments).toHaveLength(ODE_TO_JOY.notes.length);
    expect(result.counts).toEqual({ perfect: ODE_TO_JOY.notes.length, great: 0, good: 0, miss: 0 });
    expect(result.maxCombo).toBe(ODE_TO_JOY.notes.length);
    const offsets = result.judgments.map((j) => j.offsetMs ?? NaN);
    expect(Math.max(...offsets.map(Math.abs))).toBeLessThan(30);
  });

  it('100 ms late: every note Ótimo', () => {
    const { result } = playGame({ offsetMs: 100 });
    expect(result.counts).toEqual({ perfect: 0, great: ODE_TO_JOY.notes.length, good: 0, miss: 0 });
  });

  it('100 ms early: every note Ótimo too', () => {
    const { result } = playGame({ offsetMs: -100 });
    expect(result.counts.great).toBe(ODE_TO_JOY.notes.length);
  });

  it('with errors: exactly the wrong notes are Errou and each one zeroes the combo', () => {
    const { result, events, wrong } = playGame({ offsetMs: 0, errors: 3, seed: 7 });
    expect(wrong).toHaveLength(3);
    const misses = result.judgments.filter((j) => j.judgment === 'miss').map((j) => j.index);
    expect(misses).toEqual(wrong);
    expect(result.counts.perfect).toBe(ODE_TO_JOY.notes.length - 3);
    for (const index of wrong) {
      const event = events.find((e) => e.type === 'judgment' && e.index === index);
      expect(event).toMatchObject({ judgment: 'miss', combo: 0, multiplier: 1 });
    }
    expect(result.maxCombo).toBeLessThan(ODE_TO_JOY.notes.length);
  });

  it('160 ms late: every note Bom', () => {
    const { result } = playGame({ offsetMs: 160 });
    expect(result.counts.good).toBe(ODE_TO_JOY.notes.length);
  });
});

describe('renderPerformance', () => {
  it('places each onset at note time + offset, with beat 0 at LEAD_SECONDS', () => {
    const take = renderPerformance(ODE_TO_JOY, { offsetMs: 50, sampleRate: 8000 });
    expect(take.onsets[0]).toBeCloseTo(0.05);
    expect(take.onsets[4]).toBeCloseTo(4 * (60 / 90) + 0.05);
    const first = take.signal.findIndex((v) => Math.abs(v) > 1e-4);
    expect(first / 8000).toBeCloseTo(LEAD_SECONDS + 0.05, 2);
  });

  it('honours explicit wrong notes', () => {
    expect(renderPerformance(ODE_TO_JOY, { wrong: [2, 5], sampleRate: 8000 }).wrong).toEqual([2, 5]);
  });
});

describe('pickWrongNotes', () => {
  it('is deterministic, distinct, sorted and bounded', () => {
    const a = pickWrongNotes(62, 5, 3);
    expect(a).toEqual(pickWrongNotes(62, 5, 3));
    expect(new Set(a).size).toBe(5);
    expect([...a].sort((x, y) => x - y)).toEqual(a);
    expect(pickWrongNotes(4, 10)).toEqual([0, 1, 2, 3]);
    expect(pickWrongNotes(4, 0)).toEqual([]);
  });
});

describe('parseSimulate', () => {
  it.each([
    ['?simular=0', { offsetMs: 0, errors: 0 }],
    ['?simular=100', { offsetMs: 100, errors: 0 }],
    ['?simular=-80,5', { offsetMs: -80.5, errors: 0 }],
    ['?simular=100&erros=3', { offsetMs: 100, errors: 3 }],
    ['?simular=%2050%20&erros=', { offsetMs: 50, errors: 0 }],
  ])('%s', (search, expected) => {
    expect(parseSimulate(search)).toEqual(expected);
  });

  it.each(['', '?simular=', '?simular=abc', '?simular=1001', '?simular=0&erros=-1', '?simular=0&erros=1.5', '?erros=2'])(
    '%s → null',
    (search) => {
      expect(parseSimulate(search)).toBeNull();
    },
  );
});

describe('simulatePlayer', () => {
  function context() {
    const ctx = new OfflineAudioContext(1, 8000, 8000);
    const gain = { connections: new Set<unknown>(), connect: () => undefined, disconnect: vi.fn() };
    return Object.assign(ctx, { createGain: () => gain }) as unknown as OfflineAudioContext & {
      sources: { startTime: number | null; buffer: AudioBuffer | null }[];
    };
  }

  it('schedules the rendered take so beat 0 lands on startAt', () => {
    const ctx = context();
    const player = simulatePlayer(ctx, ODE_TO_JOY, { errors: 2, seed: 4 });
    expect(player.wrong).toEqual(pickWrongNotes(ODE_TO_JOY.notes.length, 2, 4));
    player.playAt(LEAD_SECONDS + 0.5);
    expect(ctx.sources).toHaveLength(1);
    expect(ctx.sources[0].startTime).toBeCloseTo(0.5);
    expect(ctx.sources[0].buffer?.sampleRate).toBe(8000);
    expect(() => player.stop()).not.toThrow();
  });

  it('starts right away, skipping the lead-in already past, when startAt is close', () => {
    const ctx = context();
    Object.assign(ctx, { currentTime: 1 });
    simulatePlayer(ctx, ODE_TO_JOY).playAt(1.2);
    expect(ctx.sources[0].startTime).toBe(1);
  });
});
