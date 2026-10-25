import { DEFAULT_A4, midiToFrequency } from '../notes';
import { secondsPerBeat } from '../../game/song';
import { arrange, type BackingNote } from './arrange';
import { DEFAULT_BACKING_VOLUME, type BackingHandle, type StartBacking } from './types';
import { VOICES, type Voice } from './voices';

export * from './types';
export { arrange } from './arrange';

const RAMP_SECONDS = 0.05;

function clampVolume(volume: number): number {
  return Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : DEFAULT_BACKING_VOLUME;
}

/**
 * Plays the arrangement on the game's own AudioContext: every note is scheduled up front at startAt + beat, on the
 * same clock as the cards and the judge, so pausing with context.suspend() pauses the backing too. Tone is loaded
 * on first use to keep it out of the other pages.
 */
export const startBacking: StartBacking = async (context, song, options) => {
  const Tone = await import('tone');
  Tone.setContext(context as AudioContext);

  const { startAt, a4 = DEFAULT_A4, destination = context.destination } = options;
  const arrangement = arrange(song);
  const beat = secondsPerBeat(song);

  const mute = new Tone.Gain(1).connect(destination);
  const master = new Tone.Gain(clampVolume(options.volume ?? DEFAULT_BACKING_VOLUME)).connect(mute);
  const guideGain = new Tone.Gain(options.guide ? 1 : 0).connect(master);

  const synthOptions = (voice: Voice) => ({
    oscillator: { type: 'sine' as const },
    envelope: {
      attack: voice.attack,
      decay: 0.01,
      sustain: 1,
      release: voice.release,
      attackCurve: 'linear' as const,
      releaseCurve: 'linear' as const,
    },
    volume: voice.gainDb,
  });
  const bass = new Tone.Synth(synthOptions(VOICES.bass)).connect(master);
  const pad = new Tone.PolySynth(Tone.Synth, synthOptions(VOICES.pad)).connect(master);
  const guide = new Tone.Synth(synthOptions(VOICES.guide)).connect(guideGain);

  const now = context.currentTime;
  const schedule = (synth: { triggerAttackRelease(f: number, d: number, t: number): unknown }, notes: BackingNote[]) => {
    for (const note of notes) {
      const time = startAt + note.beat * beat;
      const duration = note.beats * beat;
      if (time + duration <= now) continue;
      synth.triggerAttackRelease(midiToFrequency(note.midi, a4), duration, Math.max(time, now));
    }
  };
  schedule(bass, arrangement.bass);
  schedule(pad, arrangement.pad);
  schedule(guide, arrangement.guide);

  let stopped = false;
  const handle: BackingHandle = {
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
      for (const node of [bass, pad, guide, guideGain, master, mute]) node.dispose();
    },
  };
  return handle;
};
