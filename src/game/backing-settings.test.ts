import { describe, expect, it } from 'vitest'
import { DEFAULT_BACKING_VOLUME } from '../audio/backing/types'
import {
  BACKING_STORAGE_KEY,
  backingOutput,
  clampVolume,
  DEFAULT_BACKING_SETTINGS,
  guideOn,
  loadBackingSettings,
  saveBackingSettings,
  backingHint,
  HEADPHONES_HINT,
  SPEAKER_HINT,
  volumeLabel,
  type BackingSettings,
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

const settings = (patch: Partial<BackingSettings> = {}): BackingSettings => ({ ...DEFAULT_BACKING_SETTINGS, ...patch })
const stored = (json: string) => memoryStorage({ [BACKING_STORAGE_KEY]: json })

describe('loadBackingSettings', () => {
  it('defaults to orchestra on, default volume, speaker and no guide', () => {
    expect(loadBackingSettings(memoryStorage())).toEqual({
      enabled: true,
      volume: DEFAULT_BACKING_VOLUME,
      headphones: false,
      guide: false,
    })
    expect(loadBackingSettings(undefined)).toEqual(DEFAULT_BACKING_SETTINGS)
  })

  it('reads what was saved, except headphones', () => {
    const storage = memoryStorage()
    saveBackingSettings(storage, { enabled: false, volume: 0.3, headphones: true, guide: true })
    expect(loadBackingSettings(storage)).toEqual({ enabled: false, volume: 0.3, headphones: false, guide: true })
  })

  it('always starts without headphones, even if an older version stored them', () => {
    expect(loadBackingSettings(stored('{"enabled":true,"volume":0.5,"headphones":true,"guide":true}')).headphones).toBe(false)
  })

  it('falls back field by field on junk', () => {
    expect(loadBackingSettings(stored('{"enabled":"no","volume":0.2,"headphones":1}'))).toEqual(settings({ volume: 0.2 }))
    expect(loadBackingSettings(stored('{"enabled":false,"volume":7,"guide":true}'))).toEqual(
      settings({ enabled: false, volume: 1, guide: true }),
    )
    expect(loadBackingSettings(stored('not json'))).toEqual(DEFAULT_BACKING_SETTINGS)
    expect(loadBackingSettings(stored('null'))).toEqual(DEFAULT_BACKING_SETTINGS)
  })

  it('reads settings saved before the headphones choice existed', () => {
    expect(loadBackingSettings(stored('{"enabled":false,"volume":0.4}'))).toEqual(settings({ enabled: false, volume: 0.4 }))
  })

  it('survives a storage that throws', () => {
    expect(loadBackingSettings(throwing)).toEqual(DEFAULT_BACKING_SETTINGS)
  })

  it('returns a copy, so callers cannot change the defaults', () => {
    const loaded = loadBackingSettings(undefined)
    loaded.volume = 0
    expect(DEFAULT_BACKING_SETTINGS.volume).toBe(DEFAULT_BACKING_VOLUME)
  })
})

describe('saveBackingSettings', () => {
  it('stores clamped JSON under its own key, without headphones', () => {
    const storage = memoryStorage()
    expect(saveBackingSettings(storage, settings({ volume: -1, headphones: true }))).toBe(true)
    expect(JSON.parse(storage.data.get(BACKING_STORAGE_KEY)!)).toEqual({
      enabled: true,
      volume: 0,
      guide: false,
    })
  })

  it('reports false without storage or when it throws', () => {
    expect(saveBackingSettings(undefined, DEFAULT_BACKING_SETTINGS)).toBe(false)
    expect(saveBackingSettings(throwing, DEFAULT_BACKING_SETTINGS)).toBe(false)
  })
})

describe('output and guide', () => {
  it('routes to headphones only when the player says so', () => {
    expect(backingOutput(settings())).toBe('speaker')
    expect(backingOutput(settings({ headphones: true }))).toBe('headphones')
  })

  it('plays the guide only with headphones on, keeping the choice for later', () => {
    expect(guideOn(settings({ guide: true }))).toBe(false)
    expect(guideOn(settings({ guide: true, headphones: true }))).toBe(true)
    expect(guideOn(settings({ guide: false, headphones: true }))).toBe(false)
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

describe('backingHint', () => {
  it('without headphones, says the speaker plays quietly and headphones are better', () => {
    expect(backingHint(settings(), false)).toBe(SPEAKER_HINT)
  })

  it('in headphones mode, says headphones are required', () => {
    expect(backingHint(settings({ headphones: true }), false)).toBe(HEADPHONES_HINT)
    expect(HEADPHONES_HINT).toMatch(/só com fone/)
  })

  it('says nothing with the orchestra off or a simulated player', () => {
    expect(backingHint(settings({ enabled: false }), false)).toBe('')
    expect(backingHint(settings({ headphones: true }), true)).toBe('')
  })
})
