import { describe, expect, it } from 'vitest'
import { DEFAULT_BACKING_VOLUME } from '../audio/backing/types'
import {
  BACKING_STORAGE_KEY,
  clampVolume,
  DEFAULT_BACKING_SETTINGS,
  headphonesHint,
  HEADPHONES_HINT,
  loadBackingSettings,
  saveBackingSettings,
  volumeLabel,
} from './backing-settings'

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  }
}

const throwing = {
  getItem: () => {
    throw new Error('SecurityError')
  },
  setItem: () => {
    throw new Error('QuotaExceededError')
  },
}

describe('loadBackingSettings', () => {
  it('defaults to on at the backing default volume', () => {
    expect(loadBackingSettings(memoryStorage())).toEqual({ enabled: true, volume: DEFAULT_BACKING_VOLUME })
    expect(loadBackingSettings(undefined)).toEqual(DEFAULT_BACKING_SETTINGS)
  })

  it('reads what was saved', () => {
    const storage = memoryStorage()
    saveBackingSettings(storage, { enabled: false, volume: 0.3 })
    expect(loadBackingSettings(storage)).toEqual({ enabled: false, volume: 0.3 })
  })

  it('falls back field by field on junk', () => {
    expect(loadBackingSettings(memoryStorage({ [BACKING_STORAGE_KEY]: '{"enabled":"no","volume":0.2}' }))).toEqual({
      enabled: true,
      volume: 0.2,
    })
    expect(loadBackingSettings(memoryStorage({ [BACKING_STORAGE_KEY]: '{"enabled":false,"volume":7}' }))).toEqual({
      enabled: false,
      volume: 1,
    })
    expect(loadBackingSettings(memoryStorage({ [BACKING_STORAGE_KEY]: 'not json' }))).toEqual(DEFAULT_BACKING_SETTINGS)
  })

  it('survives a storage that throws', () => {
    expect(loadBackingSettings(throwing)).toEqual(DEFAULT_BACKING_SETTINGS)
  })

  it('returns a copy, so callers cannot change the defaults', () => {
    const settings = loadBackingSettings(undefined)
    settings.volume = 0
    expect(DEFAULT_BACKING_SETTINGS.volume).toBe(DEFAULT_BACKING_VOLUME)
  })
})

describe('saveBackingSettings', () => {
  it('stores clamped JSON under its own key', () => {
    const storage = memoryStorage()
    expect(saveBackingSettings(storage, { enabled: true, volume: -1 })).toBe(true)
    expect(JSON.parse(storage.data.get(BACKING_STORAGE_KEY)!)).toEqual({ enabled: true, volume: 0 })
  })

  it('reports false without storage or when it throws', () => {
    expect(saveBackingSettings(undefined, DEFAULT_BACKING_SETTINGS)).toBe(false)
    expect(saveBackingSettings(throwing, DEFAULT_BACKING_SETTINGS)).toBe(false)
  })
})

describe('volume helpers', () => {
  it('clamps to 0..1 and replaces NaN by the default', () => {
    expect(clampVolume(1.5)).toBe(1)
    expect(clampVolume(-0.1)).toBe(0)
    expect(clampVolume(Number.NaN)).toBe(DEFAULT_BACKING_VOLUME)
  })

  it('labels the volume in percent', () => {
    expect(volumeLabel(0.5)).toBe('50%')
    expect(volumeLabel(0.333)).toBe('33%')
    expect(volumeLabel(2)).toBe('100%')
  })
})

describe('headphonesHint', () => {
  it('suggests headphones only with the backing on and a real microphone', () => {
    expect(headphonesHint({ enabled: true, volume: 0.5 }, false)).toBe(HEADPHONES_HINT)
    expect(headphonesHint({ enabled: false, volume: 0.5 }, false)).toBe('')
    expect(headphonesHint({ enabled: true, volume: 0.5 }, true)).toBe('')
  })
})
