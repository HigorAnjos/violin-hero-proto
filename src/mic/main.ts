import { fallOff, meterFraction, peak, rms, toDbfs, SILENCE_DB } from '../audio/level';
import { describeMicError, openMicrophone, type Microphone } from '../audio/microphone';

const status = document.querySelector<HTMLParagraphElement>('#status')!;
const toggle = document.querySelector<HTMLButtonElement>('#toggle')!;
const meter = document.querySelector<HTMLDivElement>('.meter')!;
const bar = document.querySelector<HTMLDivElement>('#bar')!;
const rmsOut = document.querySelector<HTMLElement>('#rms')!;
const peakOut = document.querySelector<HTMLElement>('#peak')!;

let mic: Microphone | null = null;
let frame = 0;

function setStatus(text: string, isError = false): void {
  status.textContent = text;
  status.toggleAttribute('data-error', isError);
}

function render(analyser: AnalyserNode): void {
  const buffer = new Float32Array(analyser.fftSize);
  let shownDb = SILENCE_DB;
  let last = performance.now();

  const tick = (now: number) => {
    analyser.getFloatTimeDomainData(buffer);
    const rmsDb = toDbfs(rms(buffer));
    shownDb = fallOff(shownDb, rmsDb, (now - last) / 1000);
    last = now;

    const fraction = meterFraction(shownDb);
    bar.style.width = `${fraction * 100}%`;
    bar.style.setProperty('--full', fraction > 0 ? `${100 / fraction}%` : '100%');
    meter.setAttribute('aria-valuenow', shownDb.toFixed(0));
    rmsOut.textContent = rmsDb.toFixed(1);
    peakOut.textContent = toDbfs(peak(buffer)).toFixed(1);
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
}

async function start(): Promise<void> {
  toggle.disabled = true;
  setStatus('Pedindo permissão…');
  try {
    mic = await openMicrophone();
    const analyser = mic.context.createAnalyser();
    analyser.fftSize = 2048;
    mic.source.connect(analyser);
    render(analyser);
    setStatus(`Ouvindo${mic.label ? `: ${mic.label}` : ''} · ${mic.context.sampleRate} Hz`);
    toggle.textContent = 'Parar';
  } catch (error) {
    console.error(error);
    setStatus(describeMicError(error), true);
  } finally {
    toggle.disabled = false;
  }
}

async function stop(): Promise<void> {
  cancelAnimationFrame(frame);
  await mic?.stop();
  mic = null;
  bar.style.width = '0';
  rmsOut.textContent = peakOut.textContent = '–';
  toggle.textContent = 'Ativar microfone';
  setStatus('Microfone desligado.');
}

if (!window.isSecureContext) {
  setStatus(describeMicError(new DOMException('', 'SecurityError')), true);
}

toggle.addEventListener('click', () => void (mic ? stop() : start()));
