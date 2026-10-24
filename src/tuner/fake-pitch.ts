import { DEFAULT_A4, hzToNote } from '../audio/notes';
import { DEFAULT_MIN_CLARITY, type PitchHandle, type StartPitch } from '../audio/pitch/types';

const TICK_MS = 50;
const DRIFT_PERIOD_SEC = 6;

// Stand-in until src/audio/pitch/index.ts lands: echoes an oscillator's frequency, or drifts around Ré 4 for the mic.
export const startFakePitch: StartPitch = async (source, onReading, options = {}) => {
  let a4 = options.a4 ?? DEFAULT_A4;
  const minClarity = options.minClarity ?? DEFAULT_MIN_CLARITY;
  const fixedHz = 'frequency' in source ? (source as OscillatorNode).frequency.value : null;
  const context = 'context' in source ? source.context : options.context;
  const started = performance.now();

  const timer = setInterval(() => {
    const t = (performance.now() - started) / 1000;
    const hz = fixedHz ?? a4 * 2 ** (-7 / 12) * 2 ** ((40 * Math.sin((2 * Math.PI * t) / DRIFT_PERIOD_SEC)) / 1200);
    const note = hzToNote(hz, a4);
    if (!note) return onReading(null);
    onReading({
      time: t,
      hz,
      midi: note.midi,
      name: note.name,
      solfege: note.solfege,
      cents: note.cents,
      clarity: Math.max(minClarity, 0.97),
    });
  }, TICK_MS);

  const handle: PitchHandle = {
    context: context as BaseAudioContext,
    get a4() {
      return a4;
    },
    setA4(value: number) {
      a4 = value;
    },
    async stop() {
      clearInterval(timer);
    },
  };
  return handle;
};
