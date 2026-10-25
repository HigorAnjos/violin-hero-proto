import { DEFAULT_A4, HIGHEST_MIDI, LOWEST_MIDI, midiToFrequency } from '../audio/notes';
import gMajorScaleJson from './songs/g-major-scale.json';
import { OPEN_STRING_MIDI, type Song, type SongNote, type StringIndex, type TimedNote } from './types';

/** First position reaches a perfect fifth above each open string with the 4th finger. */
export const FIRST_POSITION_SPAN = 7;

export function secondsPerBeat(song: Pick<Song, 'bpm'>): number {
  return 60 / song.bpm;
}

export function songDurationBeats(song: Song): number {
  return song.notes.reduce((end, note) => Math.max(end, note.beat + note.beats), 0);
}

export function songDurationSeconds(song: Song): number {
  return songDurationBeats(song) * secondsPerBeat(song);
}

export function stringFits(midi: number, string: StringIndex): boolean {
  const open = OPEN_STRING_MIDI[string];
  return midi >= open && midi <= open + FIRST_POSITION_SPAN;
}

/** Every problem found in the song; empty when it is playable. */
export function songProblems(song: Song): string[] {
  const problems: string[] = [];
  if (!(song.bpm > 0)) problems.push(`bpm must be positive: ${song.bpm}`);
  if (!Number.isInteger(song.beatsPerBar) || song.beatsPerBar <= 0) {
    problems.push(`beatsPerBar must be a positive integer: ${song.beatsPerBar}`);
  }
  if (song.notes.length === 0) problems.push('song has no notes');
  let previousEnd = 0;
  song.notes.forEach((note, i) => {
    const where = `note ${i}`;
    if (!Number.isFinite(note.beat) || note.beat < 0) problems.push(`${where}: invalid beat ${note.beat}`);
    if (!(note.beats > 0)) problems.push(`${where}: invalid length ${note.beats}`);
    if (note.beat < previousEnd - 1e-9) problems.push(`${where}: starts before the previous note ends`);
    if (!Number.isInteger(note.midi) || note.midi < LOWEST_MIDI || note.midi > HIGHEST_MIDI) {
      problems.push(`${where}: midi ${note.midi} outside G3–E6`);
    }
    if (![0, 1, 2, 3].includes(note.string)) problems.push(`${where}: invalid string ${note.string}`);
    else if (!stringFits(note.midi, note.string)) {
      problems.push(`${where}: midi ${note.midi} not playable on string ${note.string} in first position`);
    }
    previousEnd = note.beat + note.beats;
  });
  return problems;
}

/** Validates untrusted JSON and returns it as a Song, or throws with every problem found. */
export function parseSong(json: unknown): Song {
  const value = json as Partial<Song> | null;
  if (!value || typeof value !== 'object' || !Array.isArray(value.notes)) {
    throw new TypeError('song must be an object with a notes array');
  }
  const song: Song = {
    id: String(value.id ?? ''),
    title: String(value.title ?? ''),
    composer: String(value.composer ?? ''),
    key: String(value.key ?? ''),
    bpm: Number(value.bpm),
    beatsPerBar: Number(value.beatsPerBar),
    notes: value.notes.map(
      (note: Partial<SongNote>): SongNote => ({
        beat: Number(note?.beat),
        beats: Number(note?.beats),
        midi: Number(note?.midi),
        string: Number(note?.string) as StringIndex,
      }),
    ),
  };
  const problems = songProblems(song);
  if (problems.length) throw new RangeError(`invalid song "${song.id}": ${problems.join('; ')}`);
  return song;
}

/** Places the notes on the AudioContext clock with beat 0 at `startAt`. */
export function scheduleSong(song: Song, startAt: number, a4: number = DEFAULT_A4): TimedNote[] {
  const beat = secondsPerBeat(song);
  return song.notes.map((note, index) => ({
    index,
    time: startAt + note.beat * beat,
    duration: note.beats * beat,
    midi: note.midi,
    string: note.string,
    frequency: midiToFrequency(note.midi, a4),
  }));
}

/** G major scale over two octaves, G3–G5–G3, in first position: quarter notes at 90 BPM ending on a half note. */
export const G_MAJOR_SCALE: Song = parseSong(gMajorScaleJson);
