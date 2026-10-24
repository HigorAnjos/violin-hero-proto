import { describeMicError, openMicrophone } from '../audio/microphone';
import { startPitch, type PitchHandle, type PitchReading } from '../audio/pitch';
import { STATE_COLORS, formatCents, formatHz, needleFraction, tuneHint, tuneState } from './present';
import { MAX_A4, MIN_A4, clampA4, loadA4, parseSignalHz, saveA4 } from './reference';
import { createTestSignal } from './test-signal';

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const status = $<HTMLParagraphElement>('#status');
const toggle = $<HTMLButtonElement>('#toggle');
const testMode = $<HTMLParagraphElement>('#test-mode');
const solfege = $<HTMLElement>('#solfege');
const detail = $<HTMLElement>('#detail');
const gauge = $<HTMLDivElement>('.gauge');
const needle = $<HTMLDivElement>('#needle');
const centsOut = $<HTMLElement>('#cents');
const hint = $<HTMLElement>('#hint');
const a4Out = $<HTMLOutputElement>('#a4');
const a4Down = $<HTMLButtonElement>('#a4-down');
const a4Up = $<HTMLButtonElement>('#a4-up');

const signalHz = parseSignalHz(location.search);
const storage = (() => {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
})();

let a4 = loadA4(storage);
let session: { handle: PitchHandle; release(): Promise<void> } | null = null;
let latest: PitchReading | null = null;
let dirty = false;
let frame = 0;

function setStatus(text: string, isError = false): void {
  status.textContent = text;
  status.toggleAttribute('data-error', isError);
}

function renderA4(): void {
  a4Out.textContent = `${a4} Hz`;
  a4Down.disabled = a4 <= MIN_A4;
  a4Up.disabled = a4 >= MAX_A4;
}

function setA4(value: number): void {
  a4 = clampA4(value);
  saveA4(storage, a4);
  session?.handle.setA4(a4);
  renderA4();
}

function renderReading(reading: PitchReading | null): void {
  if (!reading) {
    solfege.textContent = '—';
    detail.innerHTML = '&nbsp;';
    needle.hidden = true;
    centsOut.textContent = '–';
    hint.textContent = '';
    gauge.setAttribute('aria-valuenow', '0');
    return;
  }
  const color = STATE_COLORS[tuneState(reading.cents)];
  solfege.textContent = reading.solfege;
  detail.textContent = `${reading.name} · ${formatHz(reading.hz)}`;
  needle.hidden = false;
  needle.style.left = `${needleFraction(reading.cents) * 100}%`;
  needle.style.backgroundColor = color;
  centsOut.textContent = formatCents(reading.cents);
  centsOut.style.color = color;
  hint.textContent = tuneHint(reading.cents);
  hint.style.color = color;
  gauge.setAttribute('aria-valuenow', Math.round(reading.cents).toString());
}

// Readings arrive every ~10 ms; paint at most once per frame.
function onReading(reading: PitchReading | null): void {
  latest = reading;
  if (dirty) return;
  dirty = true;
  frame = requestAnimationFrame(() => {
    dirty = false;
    renderReading(latest);
  });
}

async function openTestSignal(hz: number) {
  // iOS Safari only unlocks audio for a context created and resumed inside the user gesture, i.e. before the first await.
  const context = new AudioContext({ latencyHint: 'interactive' });
  const resumed = context.resume();
  try {
    await resumed;
    const oscillator = createTestSignal(context, hz);
    const handle = await startPitch(oscillator, onReading, { a4 });
    return {
      handle,
      async release() {
        await handle.stop();
        oscillator.stop();
        oscillator.disconnect();
        await context.close();
      },
    };
  } catch (error) {
    await context.close().catch(() => undefined);
    throw error;
  }
}

async function openMicSession() {
  const mic = await openMicrophone();
  try {
    const handle = await startPitch(mic.source, onReading, { a4, context: mic.context });
    return {
      handle,
      async release() {
        await handle.stop();
        await mic.stop();
      },
    };
  } catch (error) {
    await mic.stop().catch(() => undefined);
    throw error;
  }
}

async function start(): Promise<void> {
  toggle.disabled = true;
  setStatus(signalHz ? 'Ligando sinal de teste…' : 'Pedindo permissão…');
  try {
    session = await (signalHz ? openTestSignal(signalHz) : openMicSession());
    setStatus(signalHz ? `Ouvindo o sinal de ${formatHz(signalHz)}.` : 'Ouvindo. Toque uma corda solta.');
    toggle.textContent = 'Desligar';
    if (document.hidden) await stop('Afinador desligado ao sair da tela. Toque em Ligar para voltar.');
  } catch (error) {
    console.error(error);
    setStatus(describeMicError(error), true);
  } finally {
    toggle.disabled = false;
  }
}

async function stop(message = 'Afinador desligado.'): Promise<void> {
  const current = session;
  if (!current) return;
  session = null;
  cancelAnimationFrame(frame);
  dirty = false;
  latest = null;
  renderReading(null);
  toggle.textContent = 'Ligar afinador';
  setStatus(message);
  try {
    await current.release();
  } catch (error) {
    console.error(error);
  }
}

if (signalHz) {
  testMode.hidden = false;
  testMode.textContent = `Modo de teste: sinal sintético de ${formatHz(signalHz)} no lugar do microfone.`;
  setStatus('Toque em Ligar para começar.');
} else if (!window.isSecureContext) {
  setStatus(describeMicError(new DOMException('', 'SecurityError')), true);
}

$<HTMLAnchorElement>('#home').href = import.meta.env.BASE_URL;
renderA4();
a4Down.addEventListener('click', () => setA4(a4 - 1));
a4Up.addEventListener('click', () => setA4(a4 + 1));
toggle.addEventListener('click', () => void (session ? stop() : start()));

const releaseInBackground = () => void stop('Afinador desligado ao sair da tela. Toque em Ligar para voltar.');
document.addEventListener('visibilitychange', () => {
  if (document.hidden) releaseInBackground();
});
window.addEventListener('pagehide', releaseInBackground);
