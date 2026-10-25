import { Application } from 'pixi.js'
import { describeMicError, openMicrophone } from '../audio/microphone'
import { loadA4 } from '../tuner/reference'
import { AudioClock, fallbackStamp, isUsableStamp } from './clock'
import { FpsMeter, parseFpsFlag } from './fps'
import { ODE_TO_JOY as song, parseSimulate, simulatePlayer, startGame, type GameEvent, type GameHandle, type GameResult } from './index'
import { formatScore, isSongOver, JUDGMENT_LABEL, JUDGMENTS } from './present'
import { GameScene } from './scene'

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!
const host = $<HTMLDivElement>('#app')
const startOverlay = $<HTMLElement>('#start')
const pausedOverlay = $<HTMLElement>('#paused')
const endOverlay = $<HTMLElement>('#end')
const playButton = $<HTMLButtonElement>('#play')
const startError = $<HTMLParagraphElement>('#start-error')
const testMode = $<HTMLParagraphElement>('#test-mode')
const fpsOut = $<HTMLOutputElement>('#fps')

const simulate = parseSimulate(location.search)
const showFps = parseFpsFlag(location.search)
const storage = (() => {
  try {
    return window.localStorage
  } catch {
    return undefined
  }
})()

const RESYNC_MS = 500

interface Session {
  handle: GameHandle
  context: AudioContext
  release(): Promise<void>
}

const app = new Application()
await app.init({
  background: '#1a1024',
  resizeTo: host,
  antialias: false,
  autoDensity: true,
  resolution: Math.min(window.devicePixelRatio || 1, 2),
  powerPreference: 'high-performance',
})
host.appendChild(app.canvas)

const scene = new GameScene(app.renderer, () => void pause())
app.stage.addChild(scene)
const relayout = () => scene.layout(app.screen.width, app.screen.height)
app.renderer.on('resize', relayout)
relayout()

const clock = new AudioClock()
let session: Session | null = null
let result: GameResult | null = null
let lastNoteTime = 0
let lastSync = -Infinity
let pausedAt = 0
let paused = false

function syncClock(context: AudioContext, perfNow: number): void {
  const stamp = typeof context.getOutputTimestamp === 'function' ? context.getOutputTimestamp() : undefined
  clock.sync(isUsableStamp(stamp, perfNow) ? stamp : fallbackStamp(context.currentTime, context.outputLatency, context.baseLatency, perfNow))
  lastSync = perfNow
}

function clockNow(): number {
  if (!session) return 0
  const perfNow = performance.now()
  if (!clock.isSynced || perfNow - lastSync >= RESYNC_MS) syncClock(session.context, perfNow)
  return clock.now(perfNow)
}

const fpsWindow = new FpsMeter(500)
const fpsLog = new FpsMeter(5000)

app.ticker.add((ticker) => {
  if (showFps) {
    const shown = fpsWindow.frame(ticker.deltaMS)
    if (shown) fpsOut.value = `${shown.averageFps.toFixed(0)} fps · pior ${shown.worstMs.toFixed(1)} ms`
    const logged = fpsLog.frame(ticker.deltaMS)
    if (logged) console.info(`[fps] média ${logged.averageFps.toFixed(1)} fps, pior quadro ${logged.worstMs.toFixed(1)} ms (${logged.frames} quadros)`)
  }
  if (!session || paused) return
  const now = clockNow()
  const start = session.handle.startAt
  scene.update(now, start)
  if (result && isSongOver(now - start, lastNoteTime - start)) showEnd(result)
})

let generation = 0

/** Listener bound to one session: a session being released must not paint over the next one. */
function listenerFor(id: number): (event: GameEvent) => void {
  return (event) => {
    if (id === generation) onEvent(event)
  }
}

function onEvent(event: GameEvent): void {
  if (event.type === 'judgment') {
    scene.judge(event.index, event.judgment, clockNow())
    scene.setScore(event.score, event.combo)
  } else {
    result = event.result
  }
}

async function openSimulated(offsetMs: number, errors: number, a4: number, onEvent: (e: GameEvent) => void): Promise<Session> {
  // iOS Safari only unlocks audio for a context created and resumed inside the user gesture, i.e. before the first await.
  const context = new AudioContext({ latencyHint: 'interactive' })
  const resumed = context.resume()
  try {
    await resumed
    const player = simulatePlayer(context, song, { offsetMs, errors, a4 })
    let handle: GameHandle
    try {
      handle = await startGame(player.output, song, { context, a4, compensationSeconds: 0, onEvent })
    } catch (error) {
      player.stop()
      throw error
    }
    player.playAt(handle.startAt)
    return {
      handle,
      context,
      async release() {
        await handle.cancel().catch(() => undefined)
        player.stop()
        await context.close().catch(() => undefined)
      },
    }
  } catch (error) {
    await context.close().catch(() => undefined)
    throw error
  }
}

async function openMicSession(a4: number, onEvent: (e: GameEvent) => void): Promise<Session> {
  const mic = await openMicrophone()
  try {
    const handle = await startGame(mic.stream, song, { context: mic.context, a4, onEvent })
    return {
      handle,
      context: mic.context,
      async release() {
        await handle.cancel().catch(() => undefined)
        await mic.stop().catch(() => undefined)
      },
    }
  } catch (error) {
    await mic.stop().catch(() => undefined)
    throw error
  }
}

async function play(): Promise<void> {
  const id = ++generation
  const listener = listenerFor(id)
  const a4 = loadA4(storage)
  // The new AudioContext must be created synchronously inside the tap (iOS), so open first and release the old one without waiting.
  const opening = simulate ? openSimulated(simulate.offsetMs, simulate.errors, a4, listener) : openMicSession(a4, listener)
  const old = session
  session = null
  if (old) void old.release()

  playButton.disabled = true
  startError.textContent = ''
  result = null
  paused = false
  pausedOverlay.hidden = true
  endOverlay.hidden = true
  app.ticker.start()
  scene.setScore(0, 0)
  let opened: Session
  try {
    opened = await opening
  } catch (error) {
    if (id !== generation) return
    startError.textContent = simulate ? `Não deu para iniciar o modo simulado (${String(error)}).` : describeMicError(error)
    startOverlay.hidden = false
    playButton.disabled = false
    return
  }
  if (id !== generation) {
    void opened.release()
    return
  }
  session = opened
  const notes = session.handle.notes
  lastNoteTime = notes.length ? notes[notes.length - 1].time : session.handle.startAt
  scene.setNotes(notes)
  clock.reset()
  paused = false
  startOverlay.hidden = true
  endOverlay.hidden = true
  pausedOverlay.hidden = true
  playButton.disabled = false
}

async function stopSession(): Promise<void> {
  const current = session
  session = null
  if (current) await current.release()
}

async function pause(): Promise<void> {
  if (!session || paused || !endOverlay.hidden) return
  paused = true
  pausedAt = clockNow()
  pausedOverlay.hidden = false
  app.ticker.stop()
  scene.update(pausedAt, session.handle.startAt)
  app.render()
  await session.context.suspend().catch(() => undefined)
}

async function resume(): Promise<void> {
  if (!session || !paused) return
  await session.context.resume().catch(() => undefined)
  clock.reset()
  paused = false
  pausedOverlay.hidden = true
  app.ticker.start()
}

function showEnd(final: GameResult): void {
  if (!endOverlay.hidden) return
  $('#final-score').textContent = formatScore(final.score)
  $('#final-combo').textContent = `Maior combo: ${final.maxCombo}`
  $('#counts').replaceChildren(
    ...JUDGMENTS.map((j) => {
      const item = document.createElement('div')
      const dt = document.createElement('dt')
      const dd = document.createElement('dd')
      dt.textContent = JUDGMENT_LABEL[j]
      dd.textContent = String(final.counts[j])
      item.append(dt, dd)
      return item
    }),
  )
  endOverlay.hidden = false
  void stopSession()
  $<HTMLButtonElement>('#again').focus()
}

if (simulate) {
  testMode.hidden = false
  testMode.textContent = `Modo de teste: jogador simulado ${simulate.offsetMs} ms${simulate.errors ? `, ${simulate.errors} erros` : ''}.`
}
fpsOut.hidden = !showFps

playButton.addEventListener('click', () => void play())
$('#again').addEventListener('click', () => void play())
$('#resume').addEventListener('click', () => void resume())
$('#restart').addEventListener('click', () => void play())
document.addEventListener('visibilitychange', () => {
  if (document.hidden) void pause()
})
