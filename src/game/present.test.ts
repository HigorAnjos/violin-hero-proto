import { describe, expect, it } from 'vitest'
import {
  chipName,
  comboText,
  COUNTDOWN_LABELS,
  countdownStep,
  END_TAIL_SECONDS,
  feedbackAlpha,
  feedbackScale,
  isSongOver,
  JUDGMENT_LABEL,
} from './present'

describe('countdownStep', () => {
  it.each([
    [-3.5, -1],
    [-3, 0],
    [-2.01, 0],
    [-2, 1],
    [-1, 2],
    [-0.01, 2],
    [0, 3],
    [0.49, 3],
    [0.5, -1],
  ])('at %f s from beat 0 shows step %i', (now, step) => {
    expect(countdownStep(now)).toBe(step)
  })

  it('ends on "Já!" at the downbeat', () => {
    expect(COUNTDOWN_LABELS[countdownStep(0)]).toBe('Já!')
  })
})

describe('feedback', () => {
  it('holds full alpha, then fades out', () => {
    expect(feedbackAlpha(0)).toBe(1)
    expect(feedbackAlpha(0.2)).toBe(1)
    expect(feedbackAlpha(0.4)).toBeGreaterThan(0)
    expect(feedbackAlpha(0.4)).toBeLessThan(1)
    expect(feedbackAlpha(1)).toBe(0)
    expect(feedbackAlpha(-0.1)).toBe(0)
  })

  it('pops bigger and settles at 1', () => {
    expect(feedbackScale(0)).toBeCloseTo(1.25)
    expect(feedbackScale(0.2)).toBe(1)
  })

  it('uses the Portuguese judgment names', () => {
    expect(Object.values(JUDGMENT_LABEL)).toEqual(['Perfeito', 'Ótimo', 'Bom', 'Errou'])
  })
})

describe('isSongOver', () => {
  it('waits a tail after the last note', () => {
    expect(isSongOver(10 + END_TAIL_SECONDS - 0.01, 10)).toBe(false)
    expect(isSongOver(10 + END_TAIL_SECONDS, 10)).toBe(true)
  })
})

describe('text helpers', () => {
  it('drops the octave from the chip name', () => {
    expect(chipName('Fá♯ 4')).toBe('Fá♯')
    expect(chipName('Ré')).toBe('Ré')
  })

  it('shows the combo from 2 on', () => {
    expect(comboText(1)).toBe('')
    expect(comboText(12)).toBe('12× combo')
  })
})
