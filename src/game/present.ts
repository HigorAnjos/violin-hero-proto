import type { Judgment } from './types'

export const COUNTDOWN_SECONDS = 3
export const GO_SECONDS = 0.5
export const FEEDBACK_HOLD_SECONDS = 0.25
export const FEEDBACK_FADE_SECONDS = 0.35
export const END_TAIL_SECONDS = 1.5

export const JUDGMENTS: readonly Judgment[] = ['perfect', 'great', 'good', 'miss']

export const JUDGMENT_LABEL: Record<Judgment, string> = {
  perfect: 'Perfeito',
  great: 'Ótimo',
  good: 'Bom',
  miss: 'Errou',
}

export const JUDGMENT_COLOR: Record<Judgment, number> = {
  perfect: 0xffe066,
  great: 0x4cc38a,
  good: 0x3e9bf4,
  miss: 0xe5484d,
}

export const COUNTDOWN_LABELS = ['3', '2', '1', 'Já!'] as const

/** Index into COUNTDOWN_LABELS for `now` seconds after beat 0 (negative before it), or -1 when nothing is shown. */
export function countdownStep(now: number): number {
  if (now < -COUNTDOWN_SECONDS || now >= GO_SECONDS) return -1
  if (now >= 0) return 3
  return Math.min(2, Math.floor(now + COUNTDOWN_SECONDS))
}

/** Alpha and scale of a judgment label shown `age` seconds ago; alpha 0 means hidden. */
export function feedbackAlpha(age: number): number {
  if (age < 0) return 0
  if (age <= FEEDBACK_HOLD_SECONDS) return 1
  return Math.max(0, 1 - (age - FEEDBACK_HOLD_SECONDS) / FEEDBACK_FADE_SECONDS)
}

export function feedbackScale(age: number): number {
  if (age < 0) return 1
  return 1 + 0.25 * Math.max(0, 1 - age / 0.12)
}

export function isSongOver(now: number, lastNoteTime: number): boolean {
  return now >= lastNoteTime + END_TAIL_SECONDS
}

/** Short solfège name for a note chip, e.g. 'Fá♯' from 'Fá♯ 4'. */
export function chipName(solfege: string): string {
  const space = solfege.lastIndexOf(' ')
  return space > 0 ? solfege.slice(0, space) : solfege
}

export function formatScore(score: number): string {
  return Math.round(score).toLocaleString('pt-BR')
}

export function comboText(combo: number): string {
  return combo >= 2 ? `${combo}× combo` : ''
}
