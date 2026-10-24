import { describe, expect, it } from 'vitest'
import { homeLayout, STRINGS } from './layout'

const viewports = [
  [360, 640],
  [390, 844],
  [430, 932],
  [768, 1024],
  [1280, 720],
] as const

describe('homeLayout', () => {
  it.each(viewports)('keeps everything inside a %ix%i viewport', (w, h) => {
    const l = homeLayout(w, h)
    for (const s of l.strings) {
      expect(s.x).toBeGreaterThan(0)
      expect(s.x).toBeLessThan(w)
    }
    expect(l.button.x).toBeGreaterThanOrEqual(0)
    expect(l.button.x + l.button.width).toBeLessThanOrEqual(w)
    expect(l.button.y + l.button.height).toBeLessThanOrEqual(h)
  })

  it.each(viewports)('stacks title, strings and button top to bottom at %ix%i', (w, h) => {
    const l = homeLayout(w, h)
    const s = l.strings[0]
    expect(l.title.y).toBeLessThan(s.top)
    expect(s.top).toBeLessThan(s.bottom)
    expect(s.bottom + l.labelSize).toBeLessThan(l.button.y)
  })

  it('draws the four strings left to right in Sol, Ré, Lá, Mi order, thinning out', () => {
    const l = homeLayout(390, 844)
    expect(l.strings.map((s) => s.name)).toEqual(STRINGS.map((s) => s.name))
    for (let i = 1; i < l.strings.length; i++) {
      expect(l.strings[i].x).toBeGreaterThan(l.strings[i - 1].x)
      expect(l.strings[i].thickness).toBeLessThan(l.strings[i - 1].thickness)
    }
  })

  it('keeps the tap target at least 48px tall', () => {
    expect(homeLayout(320, 480).button.height).toBeGreaterThanOrEqual(48)
  })

  it('caps the content width on wide screens', () => {
    const l = homeLayout(1920, 1080)
    const spread = l.strings[3].x - l.strings[0].x
    expect(spread).toBeLessThanOrEqual(480)
    expect((l.strings[0].x + l.strings[3].x) / 2).toBeCloseTo(960)
  })
})
