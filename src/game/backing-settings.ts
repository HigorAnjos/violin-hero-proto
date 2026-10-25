import { DEFAULT_BACKING_VOLUME } from '../audio/backing/types'

export const BACKING_STORAGE_KEY = 'violin-hero:backing'

export interface BackingSettings {
  enabled: boolean
  /** Linear 0..1. */
  volume: number
}

export const DEFAULT_BACKING_SETTINGS: BackingSettings = { enabled: true, volume: DEFAULT_BACKING_VOLUME }

export function clampVolume(volume: number): number {
  if (!Number.isFinite(volume)) return DEFAULT_BACKING_VOLUME
  return Math.max(0, Math.min(1, volume))
}

export function loadBackingSettings(storage: Pick<Storage, 'getItem'> | undefined): BackingSettings {
  try {
    const raw = storage?.getItem(BACKING_STORAGE_KEY)
    if (!raw) return { ...DEFAULT_BACKING_SETTINGS }
    const value = JSON.parse(raw) as Partial<BackingSettings>
    return {
      enabled: typeof value.enabled === 'boolean' ? value.enabled : DEFAULT_BACKING_SETTINGS.enabled,
      volume: typeof value.volume === 'number' ? clampVolume(value.volume) : DEFAULT_BACKING_SETTINGS.volume,
    }
  } catch {
    return { ...DEFAULT_BACKING_SETTINGS }
  }
}

/** Returns false when the storage is unavailable or full; the setting then lives only for this page. */
export function saveBackingSettings(storage: Pick<Storage, 'setItem'> | undefined, settings: BackingSettings): boolean {
  try {
    if (!storage) return false
    storage.setItem(BACKING_STORAGE_KEY, JSON.stringify({ enabled: settings.enabled, volume: clampVolume(settings.volume) }))
    return true
  } catch {
    return false
  }
}

export function volumeLabel(volume: number): string {
  return `${Math.round(clampVolume(volume) * 100)}%`
}

export const HEADPHONES_HINT = 'Use fone de ouvido: o microfone também escuta o acompanhamento.'

/** The hint only matters when a speaker could leak into a real microphone. */
export function headphonesHint(settings: BackingSettings, simulated: boolean): string {
  return settings.enabled && !simulated ? HEADPHONES_HINT : ''
}
