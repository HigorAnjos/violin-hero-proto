import { DEFAULT_BACKING_VOLUME, type BackingOutput } from '../audio/backing/types'

export const BACKING_STORAGE_KEY = 'violin-hero:backing'

export interface BackingSettings {
  enabled: boolean
  /** Linear 0..1. */
  volume: number
  /** "Estou de fone": the microphone cannot hear the orchestra, so it may play louder and with the guide melody. */
  headphones: boolean
  /** Guide melody as chosen by the player; only plays with headphones (see guideOn). */
  guide: boolean
}

export const DEFAULT_BACKING_SETTINGS: BackingSettings = {
  enabled: true,
  volume: DEFAULT_BACKING_VOLUME,
  headphones: false,
  guide: false,
}

export function clampVolume(volume: number): number {
  if (!Number.isFinite(volume)) return DEFAULT_BACKING_VOLUME
  return Math.max(0, Math.min(1, volume))
}

const bool = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback)

export function loadBackingSettings(storage: Pick<Storage, 'getItem'> | undefined): BackingSettings {
  try {
    const raw = storage?.getItem(BACKING_STORAGE_KEY)
    if (!raw) return { ...DEFAULT_BACKING_SETTINGS }
    const value = JSON.parse(raw) as Partial<Record<keyof BackingSettings, unknown>>
    return {
      enabled: bool(value.enabled, DEFAULT_BACKING_SETTINGS.enabled),
      volume: typeof value.volume === 'number' ? clampVolume(value.volume) : DEFAULT_BACKING_SETTINGS.volume,
      headphones: bool(value.headphones, DEFAULT_BACKING_SETTINGS.headphones),
      guide: bool(value.guide, DEFAULT_BACKING_SETTINGS.guide),
    }
  } catch {
    return { ...DEFAULT_BACKING_SETTINGS }
  }
}

/** Returns false when the storage is unavailable or full; the setting then lives only for this page. */
export function saveBackingSettings(storage: Pick<Storage, 'setItem'> | undefined, settings: BackingSettings): boolean {
  try {
    if (!storage) return false
    const { enabled, headphones, guide } = settings
    storage.setItem(BACKING_STORAGE_KEY, JSON.stringify({ enabled, volume: clampVolume(settings.volume), headphones, guide }))
    return true
  } catch {
    return false
  }
}

export function backingOutput(settings: BackingSettings): BackingOutput {
  return settings.headphones ? 'headphones' : 'speaker'
}

/** The guide melody through a speaker would reach the microphone and score notes the player never played. */
export function guideOn(settings: BackingSettings): boolean {
  return settings.headphones && settings.guide
}

export function volumeLabel(volume: number): string {
  return `${Math.round(clampVolume(volume) * 100)}%`
}

export const SPEAKER_HINT = 'Sem fone, a orquestra toca baixinho no alto-falante. De fone fica melhor.'
export const HEADPHONES_HINT =
  'Modo fone: só com fone de ouvido. Pela caixa de som, a orquestra toca perto da melodia e o jogo contaria notas que você não tocou.'

/** Only a real microphone next to the orchestra needs a hint. */
export function backingHint(settings: BackingSettings, simulated: boolean): string {
  if (!settings.enabled || simulated) return ''
  return settings.headphones ? HEADPHONES_HINT : SPEAKER_HINT
}
