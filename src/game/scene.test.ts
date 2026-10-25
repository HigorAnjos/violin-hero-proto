import { describe, expect, it, vi } from 'vitest'

// Pixi sniffs the user agent at import time; node has no navigator.
vi.hoisted(() => {
  if (!('navigator' in globalThis)) Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'node' }, configurable: true })
})

import { Texture, TextureSource, type Renderer } from 'pixi.js'
import { GameScene } from './scene'
import type { TimedNote } from './types'

function fakeRenderer(): Renderer {
  return {
    resolution: 1,
    generateTexture: () => new Texture({ source: new TextureSource({ width: 8, height: 8 }) }),
  } as unknown as Renderer
}

const notes: TimedNote[] = Array.from({ length: 12 }, (_, i) => ({
  index: i,
  time: 10 + i * 0.4,
  duration: 0.4,
  midi: 62 + (i % 8),
  string: ((i % 4) as TimedNote['string']),
  frequency: 440,
}))

describe('GameScene', () => {
  it('never leaves a sprite pointing at a destroyed texture across relayouts', () => {
    const scene = new GameScene(fakeRenderer(), () => undefined)
    scene.layout(390, 844)
    scene.setNotes(notes)
    scene.update(9, 10)
    scene.judge(0, 'perfect', 10.02)
    scene.update(10.05, 10)

    const before = scene.liveTextures()
    expect(before.some((t) => t !== Texture.EMPTY)).toBe(true)

    scene.layout(844, 390)
    scene.layout(390, 844)
    for (const t of scene.liveTextures()) expect(t.destroyed).toBe(false)
    expect(before.some((t) => t !== Texture.EMPTY && t.destroyed)).toBe(true)
  })

  it('redraws the last frame at the new size, so a paused game is not left empty', () => {
    const scene = new GameScene(fakeRenderer(), () => undefined)
    scene.layout(390, 844)
    scene.setNotes(notes)
    scene.update(10.5, 10)
    const shown = scene.liveTextures().filter((t) => t !== Texture.EMPTY).length
    scene.layout(844, 390)
    expect(scene.liveTextures().filter((t) => t !== Texture.EMPTY).length).toBeGreaterThan(0)
    expect(shown).toBeGreaterThan(0)
  })
})
