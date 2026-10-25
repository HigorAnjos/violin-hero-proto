import { describe, expect, it } from 'vitest';
import { LOWEST_MIDI } from '../notes';
import { C_MAJOR_SCALE } from '../../game/song';
import type { Song } from '../../game/types';
import { REGISTERS, arrange, parseMajorKey, placeAbove, triad } from './arrange';

const C = 0;
const F = 5;
const G = 7;

describe('parseMajorKey', () => {
  it.each([
    ['C major', 0],
    ['D major', 2],
    ['F# major', 6],
    ['B♭ major', 10],
    [' g Major ', 7],
  ])('%s → %s', (key, tonic) => {
    expect(parseMajorKey(key)).toBe(tonic);
  });

  it.each(['A minor', 'C', 'H major', ''])('rejects "%s"', (key) => {
    expect(() => parseMajorKey(key)).toThrow(RangeError);
  });
});

describe('triad and placeAbove', () => {
  it('builds I, IV and V of C major as C, F and G major', () => {
    expect(triad(C, 'I')).toEqual([0, 4, 7]);
    expect(triad(C, 'IV')).toEqual([5, 9, 0]);
    expect(triad(C, 'V')).toEqual([7, 11, 2]);
  });

  it('places a pitch class in the octave starting at the given midi', () => {
    expect(placeAbove(0, 40)).toBe(48);
    expect(placeAbove(4, 40)).toBe(40);
    expect(placeAbove(3, 40)).toBe(51);
  });
});

describe('arrange the C major scale', () => {
  const song = C_MAJOR_SCALE;
  const arrangement = arrange(song);

  it('is in C major with one chord per half bar covering the 16 beats', () => {
    expect(arrangement.tonic).toBe(C);
    expect(arrangement.chords).toHaveLength(8);
    arrangement.chords.forEach((chord, i) => expect(chord).toMatchObject({ beat: i * 2, beats: 2 }));
  });

  it('uses only I, IV and V (C, F, G) and ends on I', () => {
    for (const chord of arrangement.chords) expect([C, F, G]).toContain(chord.pitchClasses[0]);
    expect(arrangement.chords.at(-1)?.degree).toBe('I');
    expect(arrangement.chords.map((c) => c.degree)).toEqual(['I', 'I', 'I', 'V', 'V', 'I', 'I', 'I']);
  });

  it('every melody note on a chord downbeat is a chord tone', () => {
    for (const chord of arrangement.chords) {
      const downbeat = song.notes.find((n) => n.beat === chord.beat)!;
      expect(chord.pitchClasses).toContain(downbeat.midi % 12);
    }
  });

  it('bass plays each chord root, in time with the chords', () => {
    expect(arrangement.bass).toHaveLength(arrangement.chords.length);
    arrangement.bass.forEach((note, i) => {
      const chord = arrangement.chords[i];
      expect(note).toMatchObject({ beat: chord.beat, beats: chord.beats });
      expect(note.midi % 12).toBe(chord.pitchClasses[0]);
    });
  });

  it('pad plays the three chord tones of every chord', () => {
    expect(arrangement.pad).toHaveLength(arrangement.chords.length * 3);
    for (const chord of arrangement.chords) {
      const tones = arrangement.pad.filter((n) => n.beat === chord.beat).map((n) => n.midi % 12);
      expect(tones.sort()).toEqual([...chord.pitchClasses].sort());
    }
  });

  it('keeps bass and chords far below the violin: under E♭3, a fourth under G3', () => {
    for (const note of [...arrangement.bass, ...arrangement.pad]) {
      expect(note.midi).toBeLessThanOrEqual(LOWEST_MIDI - 4);
    }
    for (const note of arrangement.bass) expect(note.midi).toBeGreaterThanOrEqual(REGISTERS.speaker.bass);
    for (const note of arrangement.pad) expect(note.midi).toBeGreaterThanOrEqual(REGISTERS.speaker.chords);
  });

  it('for headphones: the same chords and timing, chords in C4–B4 and bass in C2–B2', () => {
    const headphones = arrange(song, 'headphones');
    expect(headphones.chords).toEqual(arrangement.chords);
    expect(headphones.guide).toEqual(arrangement.guide);
    for (const note of headphones.pad) {
      expect(note.midi).toBeGreaterThanOrEqual(60);
      expect(note.midi).toBeLessThanOrEqual(71);
    }
    for (const note of headphones.bass) {
      expect(note.midi).toBeGreaterThanOrEqual(36);
      expect(note.midi).toBeLessThanOrEqual(47);
    }
    expect(headphones.pad.map((n) => [n.beat, n.beats, n.midi % 12])).toEqual(
      arrangement.pad.map((n) => [n.beat, n.beats, n.midi % 12]),
    );
    expect(headphones.bass.map((n) => n.midi)).toEqual([36, 36, 36, 43, 43, 36, 36, 36]);
  });

  it('guide is the melody itself', () => {
    expect(arrangement.guide).toEqual(song.notes.map(({ beat, beats, midi }) => ({ beat, beats, midi })));
  });
});

describe('arrange other songs', () => {
  it('harmonises in the song key: D major gives D, G and A chords', () => {
    const song: Song = {
      ...C_MAJOR_SCALE,
      key: 'D major',
      notes: [
        { beat: 0, beats: 2, midi: 66, string: 1 },
        { beat: 2, beats: 2, midi: 67, string: 1 },
        { beat: 4, beats: 2, midi: 69, string: 2 },
        { beat: 6, beats: 2, midi: 62, string: 1 },
      ],
    };
    expect(arrange(song).chords.map((c) => c.degree)).toEqual(['I', 'IV', 'I', 'I']);
    expect(arrange(song).chords[1].pitchClasses).toEqual([7, 11, 2]);
  });

  it('uses whole-bar chords in 3/4 and cuts the last one at the end of the song', () => {
    const song: Song = {
      ...C_MAJOR_SCALE,
      beatsPerBar: 3,
      notes: [
        { beat: 0, beats: 3, midi: 67, string: 1 },
        { beat: 3, beats: 1, midi: 60, string: 0 },
      ],
    };
    expect(arrange(song).chords).toEqual([
      expect.objectContaining({ beat: 0, beats: 3 }),
      expect.objectContaining({ beat: 3, beats: 1, degree: 'I' }),
    ]);
  });
});
