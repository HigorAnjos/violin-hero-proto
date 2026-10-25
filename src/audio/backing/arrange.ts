import type { Song } from '../../game/types';

export type Degree = 'I' | 'IV' | 'V';

/** Semitones from the tonic to each chord's root. */
export const DEGREE_ROOT: Readonly<Record<Degree, number>> = { I: 0, IV: 5, V: 7 };
/** Tie-break order when two chords fit a stretch of melody equally well. */
const PREFERENCE: readonly Degree[] = ['I', 'V', 'IV'];
const MAJOR_TRIAD = [0, 4, 7] as const;

/**
 * Bass E1–D♯2 and chords E2–D♯3, at most ~157 Hz: under the tracker's 170 Hz high-pass and a fourth below the violin's
 * G3, so a leak through the speaker reads as silence. F♯3 chords still read as G3 at 0 dB.
 */
export const BASS_LOWEST_MIDI = 28;
export const CHORD_LOWEST_MIDI = 40;
export const CHORD_HIGHEST_MIDI = CHORD_LOWEST_MIDI + 11;
const DOWNBEAT_BONUS = 0.5;

export interface BackingNote {
  /** Start, in beats from beat 0 of the song. */
  beat: number;
  beats: number;
  midi: number;
}

export interface ChordSpan {
  beat: number;
  beats: number;
  degree: Degree;
  /** Pitch classes of the triad, root first. */
  pitchClasses: number[];
}

export interface Arrangement {
  tonic: number;
  chords: ChordSpan[];
  bass: BackingNote[];
  /** One entry per chord tone. */
  pad: BackingNote[];
  /** The melody itself, for the optional guide voice. */
  guide: BackingNote[];
}

const LETTER_PC: Readonly<Record<string, number>> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** Tonic pitch class of a key such as "C major" or "F# major"; only major keys are arranged. */
export function parseMajorKey(key: string): number {
  const match = /^\s*([A-G])([#♯b♭]?)\s+major\s*$/i.exec(key);
  if (!match) throw new RangeError(`unsupported key "${key}": expected "<note> major"`);
  const accidental = match[2] === '#' || match[2] === '♯' ? 1 : match[2] === 'b' || match[2] === '♭' ? -1 : 0;
  return mod12(LETTER_PC[match[1].toUpperCase()] + accidental);
}

export function triad(tonic: number, degree: Degree): number[] {
  return MAJOR_TRIAD.map((step) => mod12(tonic + DEGREE_ROOT[degree] + step));
}

/** The lowest midi of `pitchClass` at or above `lowest`. */
export function placeAbove(pitchClass: number, lowest: number): number {
  return lowest + mod12(pitchClass - lowest);
}

/**
 * Bass and block chords on I, IV and V of the song's major key, one chord per half bar (per bar in odd meters):
 * the chord holding most of the melody's duration as chord tones, with the downbeat note weighing extra. The last
 * stretch is always I.
 */
export function arrange(song: Song): Arrangement {
  const tonic = parseMajorKey(song.key);
  const span = song.beatsPerBar % 2 === 0 ? song.beatsPerBar / 2 : song.beatsPerBar;
  const end = song.notes.reduce((last, note) => Math.max(last, note.beat + note.beats), 0);
  const chords: ChordSpan[] = [];
  for (let beat = 0; beat < end - 1e-9; beat += span) {
    const beats = Math.min(span, end - beat);
    const isLast = beat + span >= end - 1e-9;
    const degree = isLast ? 'I' : bestDegree(song, tonic, beat, beats);
    chords.push({ beat, beats, degree, pitchClasses: triad(tonic, degree) });
  }

  const bass = chords.map(({ beat, beats, pitchClasses }) => ({
    beat,
    beats,
    midi: placeAbove(pitchClasses[0], BASS_LOWEST_MIDI),
  }));
  const pad = chords.flatMap(({ beat, beats, pitchClasses }) =>
    pitchClasses.map((pc) => ({ beat, beats, midi: placeAbove(pc, CHORD_LOWEST_MIDI) })),
  );
  const guide = song.notes.map(({ beat, beats, midi }) => ({ beat, beats, midi }));
  return { tonic, chords, bass, pad, guide };
}

function bestDegree(song: Song, tonic: number, from: number, beats: number): Degree {
  const to = from + beats;
  let best: Degree = PREFERENCE[0];
  let bestScore = -Infinity;
  for (const degree of PREFERENCE) {
    const tones = new Set(triad(tonic, degree));
    let score = 0;
    for (const note of song.notes) {
      if (!tones.has(mod12(note.midi))) continue;
      score += Math.max(0, Math.min(to, note.beat + note.beats) - Math.max(from, note.beat));
      if (note.beat <= from + 1e-9 && note.beat + note.beats > from + 1e-9) score += DOWNBEAT_BONUS;
    }
    if (score > bestScore + 1e-9) {
      best = degree;
      bestScore = score;
    }
  }
  return best;
}

function mod12(n: number): number {
  return ((n % 12) + 12) % 12;
}
