import { describe, expect, it } from 'vitest';
import { HIGHEST_MIDI, LOWEST_MIDI, midiToFrequency } from '../audio/notes';
import { ODE_TO_JOY, parseSong, scheduleSong, songDurationBeats, songDurationSeconds, songProblems, stringFits } from './song';
import type { Song } from './types';

const D_MAJOR = new Set([2, 4, 6, 7, 9, 11, 1]);

describe('Ode to Joy', () => {
  const song = ODE_TO_JOY;

  it('is valid', () => {
    expect(songProblems(song)).toEqual([]);
  });

  it('has 16 bars of 4/4 at about 90 BPM', () => {
    expect(song.beatsPerBar).toBe(4);
    expect(song.bpm).toBe(90);
    expect(songDurationBeats(song)).toBe(64);
    expect(songDurationSeconds(song)).toBeCloseTo(64 * (60 / 90));
  });

  it('is ordered without overlaps and fills every bar', () => {
    for (let i = 1; i < song.notes.length; i++) {
      const prev = song.notes[i - 1];
      expect(song.notes[i].beat).toBeCloseTo(prev.beat + prev.beats);
    }
    expect(song.notes[0].beat).toBe(0);
  });

  it('stays in D major and in the violin range G3–E6', () => {
    for (const note of song.notes) {
      expect(D_MAJOR.has(note.midi % 12)).toBe(true);
      expect(note.midi).toBeGreaterThanOrEqual(LOWEST_MIDI);
      expect(note.midi).toBeLessThanOrEqual(HIGHEST_MIDI);
    }
  });

  it('puts every note on a string that reaches it in first position', () => {
    for (const note of song.notes) expect(stringFits(note.midi, note.string)).toBe(true);
    expect(song.notes.find((n) => n.midi === 57)?.string).toBe(0);
    expect(song.notes.filter((n) => n.midi === 69).every((n) => n.string === 2)).toBe(true);
  });

  it('opens with the theme F♯ F♯ G A A G F♯ E and ends on D', () => {
    expect(song.notes.slice(0, 8).map((n) => n.midi)).toEqual([66, 66, 67, 69, 69, 67, 66, 64]);
    expect(song.notes.at(-1)?.midi).toBe(62);
  });
});

describe('scheduleSong', () => {
  it('converts beats to AudioContext seconds from startAt', () => {
    const notes = scheduleSong(ODE_TO_JOY, 10, 440);
    expect(notes[0]).toMatchObject({ index: 0, time: 10, midi: 66, string: 1 });
    expect(notes[0].duration).toBeCloseTo(2 / 3);
    expect(notes[13].time).toBeCloseTo(10 + 13.5 * (2 / 3));
    expect(notes[3].frequency).toBeCloseTo(midiToFrequency(69, 440));
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
