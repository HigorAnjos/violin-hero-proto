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
    const l = homeLayout(w, h, 2)
    for (const s of l.strings) {
      expect(s.x).toBeGreaterThan(0)
      expect(s.x).toBeLessThan(w)
    }
    for (const b of l.buttons) {
      expect(b.x).toBeGreaterThanOrEqual(0)
      expect(b.x + b.width).toBeLessThanOrEqual(w)
      expect(b.y + b.height).toBeLessThanOrEqual(h)
    }
  })

  it.each(viewports)('stacks title, strings and buttons top to bottom at %ix%i', (w, h) => {
    const l = homeLayout(w, h, 2)
    const s = l.strings[0]
    expect(l.title.y).toBeLessThan(s.top)
    expect(s.top).toBeLessThan(s.bottom)
    expect(s.bottom + l.labelSize).toBeLessThan(l.buttons[0].y)
    expect(l.buttons[0].y + l.buttons[0].height).toBeLessThan(l.buttons[1].y)
  })

  it('lays out one button per action', () => {
    expect(homeLayout(390, 844).buttons).toHaveLength(1)
    expect(homeLayout(390, 844, 2).buttons).toHaveLength(2)
  })

  it('draws the four strings left to right in Sol, Ré, Lá, Mi order, thinning out', () => {
    const l = homeLayout(390, 844)
    expect(l.strings.map((s) => s.name)).toEqual(STRINGS.map((s) => s.name))
    for (let i = 1; i < l.strings.length; i++) {
      expect(l.strings[i].x).toBeGreaterThan(l.strings[i - 1].x)
      expect(l.strings[i].thickness).toBeLessThan(l.strings[i - 1].thickness)
    }
  })

  it('keeps every tap target at least 52px tall', () => {
    for (const b of homeLayout(320, 480, 2).buttons) expect(b.height).toBeGreaterThanOrEqual(52)
  })

  it('caps the content width on wide screens', () => {
    const l = homeLayout(1920, 1080)
    const spread = l.strings[3].x - l.strings[0].x
    expect(spread).toBeLessThanOrEqual(480)
    expect((l.strings[0].x + l.strings[3].x) / 2).toBeCloseTo(960)
  })
})
