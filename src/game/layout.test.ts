import { describe, expect, it } from 'vitest'
import { STRINGS } from '../home/layout'
import { LEAD_SECONDS, lowerBound, maxNotesInWindow, MIN_TAP, noteY, trackLayout } from './layout'

const viewports = [
  [320, 568],
  [360, 640],
  [390, 844],
  [430, 932],
  [768, 1024],
  [1280, 720],
] as const

describe('trackLayout', () => {
  it.each(viewports)('keeps lanes, hit line and pause button inside %ix%i', (w, h) => {
    const l = trackLayout(w, h)
    for (const lane of l.lanes) {
      expect(lane.x - lane.width / 2).toBeGreaterThanOrEqual(0)
      expect(lane.x + lane.width / 2).toBeLessThanOrEqual(w)
    }
    expect(l.hitY).toBeGreaterThan(l.track.top)
    expect(l.hitY + l.note.height / 2).toBeLessThan(h)
    expect(l.pause.x + l.pause.width).toBeLessThanOrEqual(w)
    expect(l.pause.y + l.pause.height).toBeLessThanOrEqual(l.track.top)
  })

  it.each(viewports)('keeps the pause button at least 52px at %ix%i', (w, h) => {
    const { pause } = trackLayout(w, h)
    expect(pause.width).toBeGreaterThanOrEqual(MIN_TAP)
    expect(pause.height).toBeGreaterThanOrEqual(MIN_TAP)
  })

  it('orders the lanes Sol, Ré, Lá, Mi left to right with the home colours', () => {
    const l = trackLayout(390, 844)
    expect(l.lanes.map((lane) => lane.name)).toEqual(STRINGS.map((s) => s.name))
    expect(l.lanes.map((lane) => lane.color)).toEqual(STRINGS.map((s) => s.color))
    for (let i = 1; i < l.lanes.length; i++) expect(l.lanes[i].x).toBeGreaterThan(l.lanes[i - 1].x)
  })

  it.each(viewports)('shows the judgment below the hit line, out of the falling notes, at %ix%i', (w, h) => {
    const l = trackLayout(w, h)
    expect(l.feedbackY - l.feedbackSize / 2).toBeGreaterThan(l.hitY + l.note.height / 2)
    expect(l.feedbackY + l.feedbackSize / 2).toBeLessThanOrEqual(h)
  })

  it('fits a note inside its lane', () => {
    const l = trackLayout(320, 568)
    expect(l.note.width).toBeLessThan(l.lanes[0].width)
  })

  it('caps the track width and centres it on wide screens', () => {
    const l = trackLayout(1920, 1080)
    expect(l.track.width).toBeLessThanOrEqual(480)
    expect(l.track.left + l.track.width / 2).toBeCloseTo(960)
  })
})

describe('noteY', () => {
  const l = trackLayout(390, 844)

  it('puts a note on the hit line exactly at its time', () => {
    expect(noteY(l, 12.5, 12.5)).toBeCloseTo(l.hitY)
  })

  it('enters at the top of the track LEAD_SECONDS early', () => {
    expect(noteY(l, 10, 10 - LEAD_SECONDS)).toBeCloseTo(l.track.top)
  })

  it('keeps falling below the line after its time', () => {
    expect(noteY(l, 10, 10.1)).toBeGreaterThan(l.hitY)
  })

  it('depends only on the clock reading, not on how many frames ran', () => {
    expect(noteY(l, 5, 4.25)).toBeCloseTo(l.hitY - 0.75 * l.speed)
  })
})

describe('lowerBound', () => {
  const times = [0, 0.5, 0.5, 1, 2]

  it.each([
    [-1, 0],
    [0, 0],
    [0.25, 1],
    [0.5, 1],
    [1.5, 4],
    [3, 5],
  ])('finds the first time ≥ %f at %i', (t, i) => {
    expect(lowerBound(times, t)).toBe(i)
  })

  it('handles an empty array', () => {
    expect(lowerBound([], 1)).toBe(0)
  })
})

describe('maxNotesInWindow', () => {
  it('counts the densest stretch', () => {
    expect(maxNotesInWindow([0, 0.1, 0.2, 1, 3, 3.1], 0.5)).toBe(3)
    expect(maxNotesInWindow([0, 1, 2, 3], 2)).toBe(3)
  })

  it('is 0 for no notes', () => {
    expect(maxNotesInWindow([], 2)).toBe(0)
  })
})
