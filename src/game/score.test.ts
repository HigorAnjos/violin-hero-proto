import { describe, expect, it } from 'vitest';
import { applyJudgment, initialScore, judgeOffset, multiplierFor } from './score';
import type { Judgment, ScoreState } from './types';

describe('judgeOffset', () => {
  it.each([
    [0, 'perfect'],
    [70, 'perfect'],
    [-70, 'perfect'],
    [71, 'great'],
    [-130, 'great'],
    [131, 'good'],
    [-220, 'good'],
    [221, 'miss'],
    [null, 'miss'],
    [Number.NaN, 'miss'],
  ] as const)('%s ms → %s', (offset, expected) => {
    expect(judgeOffset(offset)).toBe(expected);
  });

  it('accepts custom windows', () => {
    expect(judgeOffset(50, { perfect: 30, great: 60, good: 90 })).toBe('great');
  });
});

describe('score and combo', () => {
  function play(judgments: Judgment[]): { state: ScoreState; points: number[] } {
    let state = initialScore();
    const points: number[] = [];
    for (const j of judgments) {
      const next = applyJudgment(state, j);
      state = next.state;
      points.push(next.points);
    }
    return { state, points };
  }

  it('scores each judgment', () => {
    expect(play(['perfect', 'great', 'good', 'miss']).points).toEqual([100, 70, 40, 0]);
  });

  it('raises the multiplier every 10 hits in a row, up to ×4', () => {
    expect([0, 9, 10, 19, 20, 30, 99].map(multiplierFor)).toEqual([1, 1, 2, 2, 3, 4, 4]);
    const { state, points } = play(Array(12).fill('perfect'));
    expect(points.slice(9)).toEqual([100, 200, 200]);
    expect(state).toEqual({ score: 1400, combo: 12, maxCombo: 12, multiplier: 2 });
  });

  it('a miss zeroes the combo and the multiplier but keeps the score and max combo', () => {
    const { state, points } = play([...Array(11).fill('good'), 'miss', 'good']);
    expect(points.at(-1)).toBe(40);
    expect(state).toEqual({ score: 10 * 40 + 80 + 40, combo: 1, maxCombo: 11, multiplier: 1 });
  });

  it('does not mutate the previous state', () => {
    const before = initialScore();
    applyJudgment(before, 'perfect');
    expect(before).toEqual(initialScore());
  });
});
