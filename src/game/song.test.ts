import { describe, expect, it } from 'vitest';
import { HIGHEST_MIDI, LOWEST_MIDI, midiToFrequency } from '../audio/notes';
import { G_MAJOR_SCALE, parseSong, scheduleSong, songDurationBeats, songDurationSeconds, songProblems, stringFits } from './song';
import type { Song } from './types';

const G_MAJOR = new Set([7, 9, 11, 0, 2, 4, 6]);
const UP = [55, 57, 59, 60, 62, 64, 66, 67, 69, 71, 72, 74, 76, 78, 79];

describe('G major scale', () => {
  const song = G_MAJOR_SCALE;

  it('is valid', () => {
    expect(songProblems(song)).toEqual([]);
  });

  it('is G3 up to G5 and back down over two octaves: 29 notes', () => {
    expect(song.notes.map((n) => n.midi)).toEqual([...UP, ...UP.slice(0, -1).reverse()]);
    expect(song.notes).toHaveLength(29);
    expect(song.key).toBe('G major');
  });

  it('starts and ends on the lowest note of the violin, which passes the 170 Hz high-pass', () => {
    expect(song.notes[0].midi).toBe(LOWEST_MIDI);
    expect(song.notes.at(-1)?.midi).toBe(LOWEST_MIDI);
    expect(midiToFrequency(LOWEST_MIDI, 442)).toBeCloseTo(196.9, 1);
  });

  it('is quarter notes at 90 BPM ending on a half note: 30 beats', () => {
    expect(song.beatsPerBar).toBe(4);
    expect(song.bpm).toBe(90);
    expect(song.notes.slice(0, -1).every((n) => n.beats === 1)).toBe(true);
    expect(song.notes.at(-1)?.beats).toBe(2);
    expect(songDurationBeats(song)).toBe(30);
    expect(songDurationSeconds(song)).toBeCloseTo(30 * (60 / 90));
  });

  it('is ordered without overlaps from beat 0', () => {
    for (let i = 1; i < song.notes.length; i++) {
      const prev = song.notes[i - 1];
      expect(song.notes[i].beat).toBeCloseTo(prev.beat + prev.beats);
    }
    expect(song.notes[0].beat).toBe(0);
  });

  it('stays in G major (F♯, no F) and in the violin range G3–E6', () => {
    for (const note of song.notes) {
      expect(G_MAJOR.has(note.midi % 12)).toBe(true);
      expect(note.midi).toBeGreaterThanOrEqual(LOWEST_MIDI);
      expect(note.midi).toBeLessThanOrEqual(HIGHEST_MIDI);
    }
  });

  it('uses first-position strings: G3–C4 on G, D4–G4 on D, A4–D5 on A, E5–G5 on E', () => {
    for (const note of song.notes) expect(stringFits(note.midi, note.string)).toBe(true);
    const stringOf = (midi: number) => [...new Set(song.notes.filter((n) => n.midi === midi).map((n) => n.string))];
    for (const midi of [55, 57, 59, 60]) expect(stringOf(midi)).toEqual([0]);
    for (const midi of [62, 64, 66, 67]) expect(stringOf(midi)).toEqual([1]);
    for (const midi of [69, 71, 72, 74]) expect(stringOf(midi)).toEqual([2]);
    for (const midi of [76, 78, 79]) expect(stringOf(midi)).toEqual([3]);
  });
});

describe('scheduleSong', () => {
  it('converts beats to AudioContext seconds from startAt', () => {
    const notes = scheduleSong(G_MAJOR_SCALE, 10, 440);
    expect(notes[0]).toMatchObject({ index: 0, time: 10, midi: 55, string: 0 });
    expect(notes[0].duration).toBeCloseTo(2 / 3);
    expect(notes[28].time).toBeCloseTo(10 + 28 * (2 / 3));
    expect(notes[28].duration).toBeCloseTo(4 / 3);
    expect(notes[8].frequency).toBeCloseTo(midiToFrequency(69, 440));
  });
});

describe('parseSong', () => {
  const base: Song = { id: 't', title: 'T', composer: 'X', key: 'D', bpm: 60, beatsPerBar: 4, notes: [] };

  it('rejects non-songs', () => {
    expect(() => parseSong(null)).toThrow(TypeError);
    expect(() => parseSong({ notes: 'x' })).toThrow(TypeError);
  });

  it('reports every problem', () => {
    const bad = {
      ...base,
      bpm: 0,
      notes: [
        { beat: 0, beats: 2, midi: 62, string: 1 },
        { beat: 1, beats: 1, midi: 62, string: 1 },
        { beat: 2, beats: 1, midi: 50, string: 0 },
        { beat: 3, beats: 1, midi: 71, string: 1 },
        { beat: 4, beats: 0, midi: 76, string: 7 },
      ],
    };
    expect(songProblems(bad as Song)).toEqual([
      'bpm must be positive: 0',
      'note 1: starts before the previous note ends',
      'note 2: midi 50 outside G3–E6',
      'note 2: midi 50 not playable on string 0 in first position',
      'note 3: midi 71 not playable on string 1 in first position',
      'note 4: invalid length 0',
      'note 4: invalid string 7',
    ]);
    expect(() => parseSong(bad)).toThrow(/invalid song "t"/);
  });

  it('rejects an empty song', () => {
    expect(() => parseSong(base)).toThrow(/no notes/);
  });
});
