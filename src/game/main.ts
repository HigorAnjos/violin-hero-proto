import { Application } from 'pixi.js'
import { startBacking, type BackingHandle, type BackingOptions } from '../audio/backing'
import { loadCompensation } from '../audio/calibration'
import { describeMicError, openMicrophone } from '../audio/microphone'
import { loadA4 } from '../tuner/reference'
import {
  backingOutput,
  guideOn,
  loadBackingSettings,
  saveBackingSettings,
  backingHint,
  volumeLabel,
} from './backing-settings'
import { AudioClock, fallbackStamp, isUsableStamp } from './clock'
import { FpsMeter, parseFpsFlag } from './fps'
import { C_MAJOR_SCALE as song, parseSimulate, simulatePlayer, startGame, type GameEvent, type GameHandle, type GameResult } from './index'
import { formatScore, isSongOver, JUDGMENT_LABEL, JUDGMENTS, startView } from './present'
import { formatPercent, MAX_STARS, resultView, shareText, starText } from './result'
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
  backing: BackingHandle | null
  release(): Promise<void>
}

async function releaseSession(s: Session): Promise<void> {
  const backing = s.backing
  s.backing = null
  await backing?.stop().catch(() => undefined)
  await s.release()
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
      backing: null,
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
      backing: null,
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
  if (old) void releaseSession(old)

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
  void attachBacking(opened, a4)
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

let backingRequest = 0

/**
 * The game runs without the orchestra if it fails to load: the judge only listens to the microphone. Called again
 * when the output changes mid-game; startBacking only schedules notes still ahead, so the arrangement picks up in place.
 */
async function attachBacking(target: Session, a4: number): Promise<void> {
  const request = ++backingRequest
  const previous = target.backing
  target.backing = null
  void previous?.stop().catch(() => undefined)
  const options: BackingOptions = {
    startAt: target.handle.startAt,
    volume: backing.volume,
    guide: guideOn(backing),
    output: backingOutput(backing),
    a4,
  }
  let handle: BackingHandle
  try {
    handle = await startBacking(target.context, song, options)
  } catch (error) {
    console.warn('[orquestra] não iniciou', error)
    return
  }
  if (session !== target || request !== backingRequest) {
    void handle.stop().catch(() => undefined)
    return
  }
  handle.setEnabled(backing.enabled)
  target.backing = handle
}

async function stopSession(): Promise<void> {
  const current = session
  session = null
  if (current) await releaseSession(current)
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
  const view = resultView(final)
  shared = {
    result: final,
    endedAt: new Date(),
    backingVolume: backing.enabled ? backing.volume : null,
    headphones: backing.headphones,
  }
  const stars = $('#stars')
  stars.textContent = starText(view.stars)
  stars.setAttribute('aria-label', `${view.stars} de ${MAX_STARS} estrelas`)
  $('#final-score').textContent = formatScore(final.score)
  $('#final-combo').textContent = `Precisão ${formatPercent(view.accuracy)} · Maior combo: ${final.maxCombo}`
  shareStatus.textContent = ''
  shareFallback.hidden = true
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
  $<HTMLButtonElement>('#share').focus()
}

const shareStatus = $<HTMLParagraphElement>('#share-status')
const shareFallback = $<HTMLTextAreaElement>('#share-fallback')
let shared: { result: GameResult; endedAt: Date; backingVolume: number | null; headphones: boolean } | null = null

async function copyResult(): Promise<void> {
  if (!shared) return
  const text = shareText(shared.result, {
    songTitle: song.title,
    date: shared.endedAt,
    latencyMs: loadCompensation(storage)?.delayMs ?? null,
    a4: loadA4(storage),
    userAgent: navigator.userAgent,
    backingVolume: shared.backingVolume,
    headphones: shared.headphones,
    simulated: simulate ? simulateLabel(simulate.offsetMs, simulate.errors) : undefined,
  })
  try {
    await navigator.clipboard.writeText(text)
    shareStatus.textContent = 'Copiado! Cole numa mensagem e mande para o Anjos.'
    shareFallback.hidden = true
  } catch {
    shareStatus.textContent = 'Não deu para copiar sozinho. Selecione o texto abaixo, copie e mande para o Anjos.'
    shareFallback.value = text
    shareFallback.hidden = false
    shareFallback.focus()
    shareFallback.select()
  }
}

function simulateLabel(offsetMs: number, errors: number): string {
  return `${offsetMs} ms${errors ? `, ${errors} erros` : ''}`
}

const backing = loadBackingSettings(storage)
const backingHints = [...document.querySelectorAll<HTMLElement>('[data-headphones]')]

function toggleButton(label: string, onTap: () => void): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.textContent = label
  button.addEventListener('click', () => {
    onTap()
    saveBackingSettings(storage, backing)
    renderBacking()
  })
  return button
}

const backingControls = [...document.querySelectorAll<HTMLElement>('[data-backing]')].map((host) => {
  const toggle = toggleButton('Orquestra', () => {
    backing.enabled = !backing.enabled
    session?.backing?.setEnabled(backing.enabled)
  })
  const headphones = toggleButton('Estou de fone', () => {
    backing.headphones = !backing.headphones
    if (session) void attachBacking(session, loadA4(storage))
  })
  const guide = toggleButton('Melodia guia', () => {
    backing.guide = !backing.guide
    session?.backing?.setGuide(guideOn(backing))
  })
  const slider = document.createElement('input')
  slider.type = 'range'
  slider.min = '0'
  slider.max = '100'
  slider.step = '5'
  slider.setAttribute('aria-label', 'Volume da orquestra')
  const value = document.createElement('output')
  const row = document.createElement('div')
  row.className = 'backing-row'
  row.append(headphones, guide)
  host.append(toggle, slider, value, row)
  slider.addEventListener('input', () => {
    backing.volume = slider.valueAsNumber / 100
    session?.backing?.setVolume(backing.volume)
    renderBacking()
  })
  slider.addEventListener('change', () => saveBackingSettings(storage, backing))
  return { toggle, slider, value, headphones, guide }
})

function renderBacking(): void {
  for (const { toggle, slider, value, headphones, guide } of backingControls) {
    toggle.setAttribute('aria-pressed', String(backing.enabled))
    slider.value = String(Math.round(backing.volume * 100))
    slider.disabled = !backing.enabled
    value.textContent = volumeLabel(backing.volume)
    value.classList.toggle('off', !backing.enabled)
    headphones.setAttribute('aria-pressed', String(backing.headphones))
    guide.setAttribute('aria-pressed', String(guideOn(backing)))
    guide.disabled = !backing.enabled || !backing.headphones
  }
  const hint = backingHint(backing, simulate != null)
  for (const p of backingHints) {
    p.textContent = hint
    p.hidden = hint === ''
  }
}
renderBacking()

const view = startView(loadCompensation(storage) != null, simulate != null)
const calibrateWarning = $<HTMLParagraphElement>('#calibrate-warning')
calibrateWarning.textContent = view.warning
calibrateWarning.hidden = view.warning === ''
$<HTMLAnchorElement>('#calibrate').hidden = !view.showCalibrate
playButton.textContent = view.playLabel
playButton.classList.toggle('primary', !view.calibratePrimary)

if (simulate) {
  testMode.hidden = false
  testMode.textContent = `Modo de teste: jogador simulado ${simulateLabel(simulate.offsetMs, simulate.errors)}.`
}
fpsOut.hidden = !showFps
$('#start-title').textContent = song.title
document.title = `Violin Hero · ${song.title}`

playButton.addEventListener('click', () => void play())
$('#share').addEventListener('click', () => void copyResult())
$('#again').addEventListener('click', () => void play())
$('#resume').addEventListener('click', () => void resume())
$('#restart').addEventListener('click', () => void play())
document.addEventListener('visibilitychange', () => {
  if (document.hidden) void pause()
})
