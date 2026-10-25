import { DEFAULT_A4, midiToFrequency } from '../notes';
import { secondsPerBeat } from '../../game/song';
import type { Song } from '../../game/types';
import { arrange, type BackingNote } from './arrange';
import { VOICES, dbToGain, type Voice } from './voices';

export interface RenderBackingOptions {
  sampleRate: number;
  /** Output length in samples. */
  length: number;
  /** Signal time of beat 0, in seconds. */
  startSeconds: number;
  a4?: number;
  guide?: boolean;
  /** Bass and chords; off renders the guide alone. */
  accompaniment?: boolean;
  /** Linear master volume. */
  volume?: number;
}

/** The accompaniment as startBacking plays it, rendered offline for tests: same arrangement, voices and envelopes. */
export function renderBacking(song: Song, options: RenderBackingOptions): Float32Array {
  const { sampleRate, length, startSeconds, a4 = DEFAULT_A4, guide = false, accompaniment = true, volume = 1 } = options;
  const out = new Float32Array(length);
  const arrangement = arrange(song);
  const beat = secondsPerBeat(song);
  const voices: [BackingNote[], Voice][] = [];
  if (accompaniment) voices.push([arrangement.bass, VOICES.bass], [arrangement.pad, VOICES.pad]);
  if (guide) voices.push([arrangement.guide, VOICES.guide]);
  for (const [notes, voice] of voices) {
    for (const note of notes) {
      addNote(out, sampleRate, {
        start: startSeconds + note.beat * beat,
        duration: note.beats * beat,
        frequency: midiToFrequency(note.midi, a4),
        gain: dbToGain(voice.gainDb) * volume,
        voice,
      });
    }
  }
  return out;
}

function addNote(
  out: Float32Array,
  sampleRate: number,
  note: { start: number; duration: number; frequency: number; gain: number; voice: Voice },
): void {
  const { start, duration, frequency, gain, voice } = note;
  const first = Math.max(0, Math.ceil(start * sampleRate));
  const last = Math.min(out.length, Math.ceil((start + duration + voice.release) * sampleRate));
  const w = 2 * Math.PI * frequency;
  for (let i = first; i < last; i++) {
    const t = i / sampleRate - start;
    const envelope =
      t < duration
        ? Math.min(1, t / voice.attack)
        : Math.min(1, duration / voice.attack) * Math.max(0, 1 - (t - duration) / voice.release);
    out[i] += gain * envelope * Math.sin(w * t);
  }
}
