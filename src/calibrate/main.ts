import {
  DEFAULT_BEATS,
  loadCompensation,
  saveCompensation,
  startCalibration,
  type BeatResult,
  type CalibrationEvent,
  type CalibrationHandle,
  type CalibrationResult,
} from '../audio/calibration';
import { describeMicError, openMicrophone } from '../audio/microphone';
import { loadA4 } from '../tuner/reference';
import {
  formatMs,
  markerView,
  outputContextTime,
  parseSimulateMs,
  pulsePhase,
  pulseText,
  resultView,
  savedText,
  toCompensation,
} from './present';
import { parseLeak, simulateString, simulatedOnsets } from './simulate';

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const testMode = $<HTMLParagraphElement>('#test-mode');
const pulse = $<HTMLDivElement>('#pulse');
const pulseLabel = $<HTMLSpanElement>('#pulse-label');
const markerList = $<HTMLOListElement>('#markers');
const resultBox = $<HTMLElement>('#result');
const resultDelay = $<HTMLElement>('#result-delay');
const resultSpread = $<HTMLElement>('#result-spread');
const resultSummary = $<HTMLElement>('#result-summary');
const status = $<HTMLParagraphElement>('#status');
const startButton = $<HTMLButtonElement>('#start');
const saveButton = $<HTMLButtonElement>('#save');
const redoButton = $<HTMLButtonElement>('#redo');
const savedOut = $<HTMLParagraphElement>('#saved');

const simulateMs = parseSimulateMs(location.search);
const simulateLeak = simulateMs != null && parseLeak(location.search);
const storage = (() => {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
})();

interface Session {
  handle: CalibrationHandle;
  release(): Promise<void>;
}

let session: Session | null = null;
let result: CalibrationResult | null = null;
let frame = 0;

const markers = Array.from({ length: DEFAULT_BEATS }, () => {
  const li = document.createElement('li');
  markerList.append(li);
  return li;
});

function setStatus(text: string, isError = false): void {
  status.textContent = text;
  status.toggleAttribute('data-error', isError);
}

function renderMarker(index: number, beat: BeatResult | undefined): void {
  const view = markerView(index, beat);
  const li = markers[index];
  if (!li) return;
  li.dataset.state = view.state;
  li.textContent = view.text;
  li.setAttribute('aria-label', view.label);
}

function resetMarkers(): void {
  markers.forEach((_, i) => renderMarker(i, undefined));
}

function renderSaved(): void {
  savedOut.textContent = savedText(loadCompensation(storage));
}

function showIdle(): void {
  pulse.removeAttribute('data-lit');
  delete pulse.dataset.phase;
  pulseLabel.textContent = '♪';
  startButton.hidden = false;
  startButton.textContent = 'Começar';
  saveButton.hidden = true;
  redoButton.hidden = true;
}

function showResult(done: CalibrationResult): void {
  result = done;
  pulse.removeAttribute('data-lit');
  pulse.dataset.phase = 'finished';
  pulseLabel.textContent = pulseText({ kind: 'finished' }, done.beats.length);
  const view = resultView(done);
  resultDelay.textContent = view.delay;
  resultSpread.textContent = view.spread;
  resultSummary.textContent = view.summary;
  resultBox.hidden = false;
  startButton.hidden = true;
  saveButton.hidden = false;
  saveButton.disabled = !view.canSave;
  saveButton.textContent = 'Salvar';
  redoButton.hidden = false;
  setStatus(view.canSave ? 'Confira o resultado e toque em Salvar.' : 'Medição incompleta.', !view.canSave);
  redoButton.focus();
}

function contextOutputTime(context: BaseAudioContext): number {
  const live = context as AudioContext;
  const stamp = typeof live.getOutputTimestamp === 'function' ? live.getOutputTimestamp() : undefined;
  if (stamp?.contextTime != null && stamp.performanceTime) {
    return outputContextTime(performance.now(), { contextTime: stamp.contextTime, performanceTime: stamp.performanceTime });
  }
  return context.currentTime - (live.outputLatency ?? 0) - (live.baseLatency ?? 0);
}

function animate(handle: CalibrationHandle): void {
  const tick = () => {
    const phase = pulsePhase(contextOutputTime(handle.context), handle.schedule);
    pulseLabel.textContent = pulseText(phase, handle.schedule.beats.length);
    pulse.toggleAttribute('data-lit', 'lit' in phase && phase.lit);
    pulse.dataset.phase = phase.kind;
    if (phase.kind !== 'finished') frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
}

function onEvent(event: CalibrationEvent): void {
  if (event.type === 'beat') renderMarker(event.beat.index, event.beat);
}

async function openSimulated(ms: number, a4: number): Promise<Session> {
  // iOS Safari only unlocks audio for a context created and resumed inside the user gesture, i.e. before the first await.
  const context = new AudioContext({ latencyHint: 'interactive' });
  const resumed = context.resume();
  try {
    await resumed;
    if (context.state !== 'running') {
      throw new DOMException(`audio context is ${context.state}`, 'InvalidStateError');
    }
    const string = simulateString(context, a4);
    let handle: CalibrationHandle;
    try {
      // Onsets come from the engine's own schedule: loading the worklet may outlast any fixed startAt margin.
      handle = await startCalibration(string.output, { a4, save: false, onEvent });
    } catch (error) {
      string.stop();
      throw error;
    }
    string.bowAt(simulatedOnsets(handle.schedule.beats, ms));
    if (simulateLeak) string.leakAt([...handle.schedule.countIn, ...handle.schedule.beats]);
    return {
      handle,
      async release() {
        await handle.cancel();
        string.stop();
        await context.close();
      },
    };
  } catch (error) {
    await context.close().catch(() => undefined);
    throw error;
  }
}

async function openMicSession(a4: number): Promise<Session> {
  const mic = await openMicrophone();
  try {
    const handle = await startCalibration(mic.stream, { a4, context: mic.context, save: false, onEvent });
    return {
      handle,
      async release() {
        await handle.cancel();
        await mic.stop();
      },
    };
  } catch (error) {
    await mic.stop().catch(() => undefined);
    throw error;
  }
}

async function start(): Promise<void> {
  result = null;
  resultBox.hidden = true;
  resetMarkers();
  saveButton.hidden = true;
  redoButton.hidden = true;
  startButton.hidden = false;
  startButton.disabled = true;
  setStatus(simulateMs != null ? 'Preparando a simulação…' : 'Pedindo permissão…');
  const a4 = loadA4(storage);
  let current: Session;
  try {
    current = await (simulateMs != null ? openSimulated(simulateMs, a4) : openMicSession(a4));
  } catch (error) {
    console.error(error);
    setStatus(simulateMs != null ? 'Não foi possível iniciar a simulação. Tente de novo.' : describeMicError(error), true);
    showIdle();
    startButton.disabled = false;
    return;
  }
  session = current;
  startButton.textContent = 'Cancelar';
  startButton.disabled = false;
  setStatus('Ouça a contagem e toque o Lá solto junto com cada um dos 8 cliques.');
  if (document.hidden) {
    await stop('Calibração cancelada ao sair da tela.');
    return;
  }
  animate(current.handle);
  let done: CalibrationResult;
  try {
    done = await current.handle.result;
  } catch (error) {
    if (session === current) {
      console.error(error);
      await stop('A calibração falhou. Tente de novo.', true);
    }
    return;
  }
  if (session !== current) return;
  session = null;
  cancelAnimationFrame(frame);
  showResult(done);
  await current.release().catch((error) => console.error(error));
}

async function stop(message: string, isError = false): Promise<void> {
  const current = session;
  if (!current) return;
  session = null;
  cancelAnimationFrame(frame);
  showIdle();
  resetMarkers();
  setStatus(message, isError);
  try {
    await current.release();
  } catch (error) {
    console.error(error);
  }
}

function save(): void {
  if (!result || !resultView(result).canSave) return;
  const compensation = toCompensation(result, new Date());
  if (saveCompensation(compensation, storage)) {
    renderSaved();
    saveButton.disabled = true;
    saveButton.textContent = 'Salvo';
    setStatus(`Atraso de ${formatMs(compensation.delayMs)} salvo. O jogo vai compensar.`);
  } else {
    setStatus('Não foi possível salvar neste navegador.', true);
  }
}

if (simulateMs != null) {
  testMode.hidden = false;
  testMode.textContent = `Modo de teste: Lá sintético ${formatMs(simulateMs)} depois de cada clique, no lugar do microfone${
    simulateLeak ? ', com o clique vazando na entrada' : ''
  }.`;
} else if (!window.isSecureContext) {
  setStatus(describeMicError(new DOMException('', 'SecurityError')), true);
}

$<HTMLAnchorElement>('#home').href = import.meta.env.BASE_URL;
resetMarkers();
renderSaved();
showIdle();
startButton.addEventListener('click', () => void (session ? stop('Calibração cancelada.') : start()));
redoButton.addEventListener('click', () => void start());
saveButton.addEventListener('click', save);

const releaseInBackground = () => void stop('Calibração cancelada ao sair da tela. Toque em Começar para refazer.');
document.addEventListener('visibilitychange', () => {
  if (document.hidden) releaseInBackground();
});
window.addEventListener('pagehide', releaseInBackground);
