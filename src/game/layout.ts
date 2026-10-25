import { STRINGS, type Box } from '../home/layout'

export const MIN_TAP = 52
export const LEAD_SECONDS = 2
export const MISS_TAIL_SECONDS = 0.6
const MAX_TRACK_WIDTH = 480
const SIDE_GUTTER = 16

export interface Lane {
  name: string
  color: number
  x: number
  width: number
}

export interface TrackLayout {
  width: number
  height: number
  hud: { top: number; height: number; scoreX: number; comboX: number; fontSize: number }
  pause: Box
  track: { left: number; width: number; top: number; bottom: number }
  lanes: Lane[]
  hitY: number
  note: { width: number; height: number }
  labelSize: number
  feedbackY: number
  feedbackSize: number
  /** Pixels per second of song time. */
  speed: number
}

export function trackLayout(width: number, height: number): TrackLayout {
  const trackWidth = Math.min(width - SIDE_GUTTER * 2, MAX_TRACK_WIDTH)
  const left = (width - trackWidth) / 2
  const laneWidth = trackWidth / STRINGS.length

  const pauseSize = Math.max(MIN_TAP, Math.min(64, height * 0.07))
  const hudTop = 8
  const hudHeight = pauseSize
  const fontSize = Math.round(Math.max(18, Math.min(30, hudHeight * 0.45)))

  const top = hudTop + hudHeight + 8
  const bottom = height
  const hitY = Math.round(top + (bottom - top) * 0.82)

  const noteWidth = Math.round(laneWidth * 0.78)
  const noteHeight = Math.round(Math.max(36, Math.min(60, noteWidth * 0.55)))

  const feedbackSize = Math.round(Math.max(18, Math.min(30, laneWidth * 0.24)))

  return {
    width,
    height,
    hud: { top: hudTop, height: hudHeight, scoreX: left, comboX: width / 2, fontSize },
    pause: { x: width - SIDE_GUTTER - pauseSize, y: hudTop, width: pauseSize, height: pauseSize },
    track: { left, width: trackWidth, top, bottom },
    lanes: STRINGS.map((s, i) => ({ name: s.name, color: s.color, x: left + laneWidth * (i + 0.5), width: laneWidth })),
    hitY,
    note: { width: noteWidth, height: noteHeight },
    labelSize: Math.round(noteHeight * 0.48),
    feedbackY: Math.round(hitY + noteHeight / 2 + feedbackSize),
    feedbackSize,
    speed: (hitY - top) / LEAD_SECONDS,
  }
}

/** Centre y of a note due at noteTime when the clock reads now (same clock); reaches hitY exactly on time. */
export function noteY(layout: TrackLayout, noteTime: number, now: number): number {
  return layout.hitY - (noteTime - now) * layout.speed
}

/** How long before its time a note is drawn: from fully inside the top of the track, never over the HUD. */
export function enterSeconds(layout: TrackLayout): number {
  return (layout.hitY - layout.track.top - layout.note.height / 2) / layout.speed
}

/** Fades a chip in over its own height after it enters, so it does not pop in at the top of the track. */
export function entryAlpha(layout: TrackLayout, y: number): number {
  const entry = layout.track.top + layout.note.height / 2
  return Math.max(0, Math.min(1, (y - entry) / layout.note.height))
}

/** First index whose time is ≥ t in an ascending array (binary search, no allocation). */
export function lowerBound(times: ArrayLike<number>, t: number): number {
  let lo = 0
  let hi = times.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (times[mid] < t) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** Largest number of notes whose times fit in any window of the given length: the sprite pool size. */
export function maxNotesInWindow(times: ArrayLike<number>, window: number): number {
  let best = 0
  let start = 0
  for (let end = 0; end < times.length; end++) {
    while (times[end] - times[start] > window) start++
    best = Math.max(best, end - start + 1)
  }
  return best
}
