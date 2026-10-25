import { DEFAULT_A4, midiToFrequency } from '../notes';
import { secondsPerBeat } from '../../game/song';
import { arrange, type BackingNote } from './arrange';
import { DEFAULT_BACKING_VOLUME, type BackingHandle, type StartBacking } from './types';
import { VOICES, type Voice } from './voices';

export * from './types';
export { arrange } from './arrange';

const RAMP_SECONDS = 0.05;

/**
 * −120 dBFS of DC, below one 16-bit step: Chrome flags the page audible on any non-zero output and that silent→audible
 * switch costs the main thread one long frame (33–50 ms at CPU 4×), so it happens during the countdown, not on beat 1.
 */
export const KEEP_AUDIBLE_LEVEL = 1e-6;

const QUIET_LOGGER = { log: () => undefined, warn: () => undefined };

function clampVolume(volume: number): number {
  return Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : DEFAULT_BACKING_VOLUME;
}

/**
 * Plays the arrangement on the game's own AudioContext: every note is scheduled up front at startAt + beat straight on
 * the AudioParams, on the same clock as the cards and the judge, so context.suspend() pauses it too.
 *
 * Deep imports: the tone entry point builds a global Transport, i.e. a second AudioContext and a worker ticker, on
 * import. Each session wraps the game's context in its own Tone Context with the "offline" clock (no ticker), passed to
 * every node and set as Tone's global, and never disposed, since Context.dispose() closes the AudioContext it wraps. Pad voices are mono Synths: PolySynth
 * defers future attacks to the main-thread ticker.
 */
export const startBacking: StartBacking = async (context, song, options) => {
  const [{ Context }, { setContext }, { Gain }, { Synth }, { setLogger }] = await Promise.all([
    import('tone/build/esm/core/context/Context.js'),
    import('tone/build/esm/core/Global.js'),
    import('tone/build/esm/core/context/Gain.js'),
    import('tone/build/esm/instrument/Synth.js'),
    import('tone/build/esm/core/util/Debug.js'),
  ]);
  const raw = context as AudioContext;
  const previousStateHandler = raw.onstatechange;
  const toneContext = new Context({ context: raw, clockSource: 'offline' });
  raw.onstatechange = previousStateHandler;
  // Every node's getDefaults() calls getContext(), which builds a worker-clocked Context on a new AudioContext unless one is set.
  setContext(toneContext);

  const { startAt, a4 = DEFAULT_A4, destination = context.destination, output = 'speaker' } = options;
  const arrangement = arrange(song, output);
  const beat = secondsPerBeat(song);

  const keepAudible = raw.createConstantSource();
  keepAudible.offset.value = KEEP_AUDIBLE_LEVEL;
  keepAudible.connect(destination);
  keepAudible.start();

  const mute = new Gain({ context: toneContext, gain: 1 }).connect(destination);
  const master = new Gain({ context: toneContext, gain: clampVolume(options.volume ?? DEFAULT_BACKING_VOLUME) });
  master.connect(mute);
  const guideGain = new Gain({ context: toneContext, gain: options.guide ? 1 : 0 });
  guideGain.connect(master);

  const synth = (voice: Voice, to: InstanceType<typeof Gain>) =>
    new Synth({
      context: toneContext,
      oscillator: { type: 'sine' },
      envelope: {
        attack: voice.attack,
        decay: 0.01,
        sustain: 1,
        release: voice.release,
        attackCurve: 'linear',
        releaseCurve: 'linear',
      },
      volume: voice.gainDb,
    }).connect(to);
  const bass = synth(VOICES.bass, master);
  const pad = [0, 1, 2].map(() => synth(VOICES.pad, master));
  const guide = synth(VOICES.guide, guideGain);

  const now = context.currentTime;
  const schedule = (voiceFor: (index: number) => InstanceType<typeof Synth>, notes: BackingNote[]) => {
    notes.forEach((note, index) => {
      const time = startAt + note.beat * beat;
      const duration = note.beats * beat;
      if (time + duration <= now) return;
      voiceFor(index).triggerAttackRelease(midiToFrequency(note.midi, a4), duration, Math.max(time, now));
    });
  };
  // Rescheduling while paused (e.g. toggling headphones) warns once per note that the context is suspended; it resumes with the game.
  const suspended = raw.state !== 'running';
  if (suspended) setLogger(QUIET_LOGGER);
  try {
    schedule(() => bass, arrangement.bass);
    schedule((index) => pad[index % 3], arrangement.pad);
    schedule(() => guide, arrangement.guide);
  } finally {
    if (suspended) setLogger(console);
  }

  let stopped = false;
  return {
    startAt,
    setVolume(volume) {
      if (!stopped) master.gain.rampTo(clampVolume(volume), RAMP_SECONDS);
    },
    setEnabled(enabled) {
      if (!stopped) mute.gain.rampTo(enabled ? 1 : 0, RAMP_SECONDS);
    },
    setGuide(enabled) {
      if (!stopped) guideGain.gain.rampTo(enabled ? 1 : 0, RAMP_SECONDS);
    },
    async stop() {
      if (stopped) return;
      stopped = true;
      keepAudible.stop();
      keepAudible.disconnect();
      for (const node of [bass, ...pad, guide, guideGain, master, mute]) node.dispose();
    },
  } satisfies BackingHandle;
};
