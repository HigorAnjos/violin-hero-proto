// Stand-in for the Ouvido's song, judge and simulated player until they land; same signatures as types.ts, swap is one import.
import { midiToFrequency } from '../audio/notes'
import type {
  GameEvent,
  GameHandle,
  GameOptions,
  GameResult,
  Judgment,
  NoteJudgment,
  ScoreState,
  SimulatedPlayer,
  SimulateParams,
  Song,
  SongNote,
  StringIndex,
  TimedNote,
} from './types'

const MELODY: [number, number][] = [
  [66, 1], [66, 1], [67, 1], [69, 1], [69, 1], [67, 1], [66, 1], [64, 1],
  [62, 1], [62, 1], [64, 1], [66, 1], [66, 1.5], [64, 0.5], [64, 2],
  [66, 1], [66, 1], [67, 1], [69, 1], [69, 1], [67, 1], [66, 1], [64, 1],
  [62, 1], [62, 1], [64, 1], [66, 1], [64, 1.5], [62, 0.5], [62, 2],
]

function stringFor(midi: number): StringIndex {
  if (midi >= 76) return 3
  if (midi >= 69) return 2
  if (midi >= 62) return 1
  return 0
}

export const ODE_TO_JOY: Song = (() => {
  let beat = 0
  const notes: SongNote[] = MELODY.map(([midi, beats]) => {
    const note = { beat, beats, midi, string: stringFor(midi) }
    beat += beats
    return note
  })
  return { id: 'ode', title: 'Ode à Alegria', composer: 'Beethoven', key: 'D', bpm: 100, beatsPerBar: 4, notes }
})()

const WINDOWS = { perfect: 70, great: 130, good: 220 }
const POINTS: Record<Judgment, number> = { perfect: 100, great: 70, good: 40, miss: 0 }

export function scheduleSong(song: Song, startAt: number, a4 = 442): TimedNote[] {
  const spb = 60 / song.bpm
  return song.notes.map((n, index) => ({
    index,
    time: startAt + n.beat * spb,
    duration: n.beats * spb,
    midi: n.midi,
    string: n.string,
    frequency: midiToFrequency(n.midi, a4),
  }))
}

interface FakePlayer {
  offsetMs: number
  wrong: Set<number>
}

const players = new WeakMap<AudioNode, FakePlayer>()

export function parseSimulate(search: string): SimulateParams | null {
  const params = new URLSearchParams(search)
  const raw = params.get('simular')
  if (raw == null || raw.trim() === '') return null
  const offsetMs = Number(raw.replace(',', '.'))
  if (!Number.isFinite(offsetMs) || Math.abs(offsetMs) > 1000) return null
  const errors = Math.max(0, Math.floor(Number(params.get('erros') ?? 0)) || 0)
  return { offsetMs, errors }
}

export function simulatePlayer(
  context: BaseAudioContext,
  song: Song,
  options: { offsetMs?: number; errors?: number; seed?: number; a4?: number },
): SimulatedPlayer {
  const output = context.createGain()
  const count = Math.min(options.errors ?? 0, song.notes.length)
  const wrong = Array.from({ length: count }, (_, i) => Math.floor(((i + 0.5) * song.notes.length) / count))
  players.set(output, { offsetMs: options.offsetMs ?? 0, wrong: new Set(wrong) })
  return { output, wrong, playAt() {}, stop() {} }
}

function judge(offsetMs: number): Judgment {
  const abs = Math.abs(offsetMs)
  if (abs <= WINDOWS.perfect) return 'perfect'
  if (abs <= WINDOWS.great) return 'great'
  if (abs <= WINDOWS.good) return 'good'
  return 'miss'
}

export async function startGame(source: MediaStream | AudioNode, song: Song, options: GameOptions = {}): Promise<GameHandle> {
  const own = !options.context && !(source instanceof AudioNode)
  const context = options.context ?? (source instanceof AudioNode ? (source.context as AudioContext) : new AudioContext())
  await context.resume()
  const leadIn = options.leadInSeconds ?? (2 * song.beatsPerBar * 60) / song.bpm
  const startAt = options.startAt ?? context.currentTime + leadIn
  const notes = scheduleSong(song, startAt, options.a4)
  const player = source instanceof AudioNode ? players.get(source) : undefined
  const state: ScoreState = { score: 0, combo: 0, maxCombo: 0, multiplier: 1 }
  const judgments: NoteJudgment[] = []
  const counts: Record<Judgment, number> = { perfect: 0, great: 0, good: 0, miss: 0 }
  let next = 0
  let settle!: (r: GameResult) => void
  let fail!: (e: unknown) => void
  const result = new Promise<GameResult>((res, rej) => {
    settle = res
    fail = rej
  })
  result.catch(() => undefined)

  const emit = (event: GameEvent) => options.onEvent?.(event)

  const timer = setInterval(() => {
    const now = context.currentTime
    while (next < notes.length) {
      const note = notes[next]
      const jitter = player ? ((note.index * 37) % 61) - 30 : 0
      const offsetMs = player && !player.wrong.has(note.index) ? player.offsetMs + jitter : null
      const due = offsetMs == null ? note.time + WINDOWS.good / 1000 : note.time + offsetMs / 1000
      if (now < due) break
      const judgment = offsetMs == null ? 'miss' : judge(offsetMs)
      const points = POINTS[judgment] * state.multiplier
      state.score += points
      state.combo = judgment === 'miss' ? 0 : state.combo + 1
      state.maxCombo = Math.max(state.maxCombo, state.combo)
      state.multiplier = Math.min(4, 1 + Math.floor(state.combo / 10))
      counts[judgment]++
      const entry = { index: note.index, judgment, offsetMs, points }
      judgments.push(entry)
      emit({ type: 'judgment', ...entry, ...state })
      next++
    }
    if (next === notes.length) {
      clearInterval(timer)
      const done = { judgments, counts, score: state.score, maxCombo: state.maxCombo }
      emit({ type: 'done', result: done })
      settle(done)
    }
  }, 20)

  return {
    context,
    startAt,
    notes,
    state,
    result,
    async cancel() {
      clearInterval(timer)
      fail(new DOMException('cancelled', 'AbortError'))
      if (own) await context.close().catch(() => undefined)
    },
  }
}
