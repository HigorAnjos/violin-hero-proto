import { JUDGMENT_LABEL, JUDGMENTS } from './present'
import { POINTS } from './score'
import type { GameResult, Judgment } from './types'

export const MAX_STARS = 5
/** Minimum accuracy, in %, for 1..5 stars. */
export const STAR_THRESHOLDS: readonly number[] = [30, 50, 70, 85, 95]

/** Points earned without multiplier over the points of an all-Perfeito run, in % (0 for an empty song). */
export function accuracyPercent(counts: Record<Judgment, number>): number {
  let earned = 0
  let total = 0
  for (const j of JUDGMENTS) {
    earned += counts[j] * POINTS[j]
    total += counts[j] * POINTS.perfect
  }
  return total > 0 ? (100 * earned) / total : 0
}

export function starsFor(accuracy: number): number {
  let stars = 0
  for (const threshold of STAR_THRESHOLDS) if (accuracy >= threshold) stars++
  return stars
}

export function starText(stars: number): string {
  return '★'.repeat(stars) + '☆'.repeat(MAX_STARS - stars)
}

export function formatPercent(accuracy: number): string {
  return `${Math.floor(accuracy)}%`
}

/** Mean signed offset of the played notes in ms (negative = early), or null when nothing was hit. */
export function meanOffsetMs(result: GameResult): number | null {
  let sum = 0
  let n = 0
  for (const j of result.judgments) {
    if (j.offsetMs === null || j.judgment === 'miss') continue
    sum += j.offsetMs
    n++
  }
  return n > 0 ? sum / n : null
}

export function formatSignedMs(ms: number): string {
  const rounded = Math.round(ms)
  return `${rounded > 0 ? '+' : rounded < 0 ? '−' : ''}${Math.abs(rounded)} ms`
}

const pad = (n: number) => String(n).padStart(2, '0')

/** Local date and time as '2026-10-25 14:05'. */
export function formatDateTime(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function majorVersion(ua: string, pattern: RegExp): string {
  const match = ua.match(pattern)
  return match ? ` ${match[1]}` : ''
}

function osOf(ua: string): string {
  if (/iPhone/.test(ua)) return `iPhone iOS${majorVersion(ua, /OS (\d+)[_\d]* like Mac/)}`
  if (/iPad/.test(ua)) return `iPad iOS${majorVersion(ua, /OS (\d+)[_\d]* like Mac/)}`
  if (/Android/.test(ua)) return `Android${majorVersion(ua, /Android (\d+)/)}`
  if (/Windows/.test(ua)) return 'Windows'
  if (/Mac OS X|Macintosh/.test(ua)) return 'macOS'
  if (/CrOS/.test(ua)) return 'ChromeOS'
  if (/Linux/.test(ua)) return 'Linux'
  return 'sistema desconhecido'
}

function browserOf(ua: string): string {
  if (/SamsungBrowser\//.test(ua)) return `Samsung Internet${majorVersion(ua, /SamsungBrowser\/(\d+)/)}`
  if (/Edg(A|iOS)?\//.test(ua)) return `Edge${majorVersion(ua, /Edg(?:A|iOS)?\/(\d+)/)}`
  if (/OPR\//.test(ua)) return `Opera${majorVersion(ua, /OPR\/(\d+)/)}`
  if (/FxiOS\//.test(ua)) return `Firefox${majorVersion(ua, /FxiOS\/(\d+)/)}`
  if (/Firefox\//.test(ua)) return `Firefox${majorVersion(ua, /Firefox\/(\d+)/)}`
  if (/CriOS\//.test(ua)) return `Chrome${majorVersion(ua, /CriOS\/(\d+)/)}`
  if (/Chrome\//.test(ua)) return `Chrome${majorVersion(ua, /Chrome\/(\d+)/)}`
  if (/Safari\//.test(ua)) return `Safari${majorVersion(ua, /Version\/(\d+)/)}`
  return 'navegador desconhecido'
}

/** 'Android 14 · Chrome 130' from a user agent; iOS browsers all run WebKit, so the OS version matters more there. */
export function deviceSummary(userAgent: string): string {
  return `${osOf(userAgent)} · ${browserOf(userAgent)}`
}

export interface ResultView {
  score: number
  accuracy: number
  stars: number
  counts: Record<Judgment, number>
  maxCombo: number
}

export function resultView(result: GameResult): ResultView {
  const accuracy = accuracyPercent(result.counts)
  return { score: result.score, accuracy, stars: starsFor(accuracy), counts: result.counts, maxCombo: result.maxCombo }
}

export interface ShareContext {
  songTitle: string
  date: Date
  /** Saved F3 delay in ms, or null when this device was never calibrated. */
  latencyMs: number | null
  a4: number
  userAgent: string
  /** Accompaniment volume 0..1, or null when it is off. */
  backingVolume: number | null
  headphones: boolean
  /** Set in ?simular mode so a test run is never mistaken for a real one. */
  simulated?: string
}

/** Short plain text the tester pastes back to the Anjos. */
export function shareText(result: GameResult, context: ShareContext): string {
  const view = resultView(result)
  const offset = meanOffsetMs(result)
  const counts = JUDGMENTS.map((j) => `${JUDGMENT_LABEL[j]} ${view.counts[j]}`).join(' · ')
  const lines = [
    `Violin Hero · ${context.songTitle}`,
    formatDateTime(context.date),
    `Pontos: ${Math.round(view.score).toLocaleString('pt-BR')} · ${starText(view.stars)} ${formatPercent(view.accuracy)}`,
    counts,
    `Maior combo: ${view.maxCombo}`,
    `Atraso calibrado: ${context.latencyMs === null ? 'não calibrado' : `${Math.round(context.latencyMs)} ms`}`,
    `Média das notas: ${offset === null ? '—' : formatSignedMs(offset)}`,
    `Orquestra: ${context.backingVolume === null ? 'desligada' : `${Math.round(context.backingVolume * 100)}%`} · ${context.headphones ? 'de fone' : 'sem fone'} · Lá ${context.a4} Hz`,
    `Aparelho: ${deviceSummary(context.userAgent)}`,
  ]
  if (context.simulated) lines.push(`Teste simulado: ${context.simulated}`)
  return lines.join('\n')
}
