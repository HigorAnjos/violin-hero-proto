import type { Judgment, JudgeWindows, ScoreState } from './types';

export const DEFAULT_WINDOWS: JudgeWindows = { perfect: 70, great: 130, good: 220 };
export const POINTS: Record<Judgment, number> = { perfect: 100, great: 70, good: 40, miss: 0 };
export const COMBO_STEP = 10;
export const MAX_MULTIPLIER = 4;

/** Judgment for a hit `offsetMs` away from the note; null (never played) is a miss. */
export function judgeOffset(offsetMs: number | null, windows: JudgeWindows = DEFAULT_WINDOWS): Judgment {
  if (offsetMs === null || !Number.isFinite(offsetMs)) return 'miss';
  const distance = Math.abs(offsetMs);
  if (distance <= windows.perfect) return 'perfect';
  if (distance <= windows.great) return 'great';
  if (distance <= windows.good) return 'good';
  return 'miss';
}

/** ×1 for the first 10 hits in a row, ×2 from the 11th, up to ×4. */
export function multiplierFor(combo: number): number {
  return Math.min(MAX_MULTIPLIER, 1 + Math.floor(combo / COMBO_STEP));
}

export function initialScore(): ScoreState {
  return { score: 0, combo: 0, maxCombo: 0, multiplier: 1 };
}

/** Applies one judgment: hits earn points × the current multiplier and grow the combo; a miss zeroes it. */
export function applyJudgment(state: ScoreState, judgment: Judgment): { state: ScoreState; points: number } {
  if (judgment === 'miss') return { state: { ...state, combo: 0, multiplier: 1 }, points: 0 };
  const points = POINTS[judgment] * state.multiplier;
  const combo = state.combo + 1;
  return {
    state: {
      score: state.score + points,
      combo,
      maxCombo: Math.max(state.maxCombo, combo),
      multiplier: multiplierFor(combo),
    },
    points,
  };
}
