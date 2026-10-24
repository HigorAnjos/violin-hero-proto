import { describe, expect, it } from 'vitest';
import {
  DEFAULT_A4,
  HIGHEST_MIDI,
  LOWEST_MIDI,
  buildNoteTable,
  centsBetween,
  frequencyToMidi,
  hzToNote,
  midiToFrequency,
  noteName,
  solfegeName,
} from './notes';

describe('note table', () => {
  it('defaults to A4 = 442 Hz', () => {
    expect(DEFAULT_A4).toBe(442);
    expect(midiToFrequency(69)).toBe(442);
  });

  it('covers G3 to E6, chromatically', () => {
    const table = buildNoteTable();
    expect(table).toHaveLength(HIGHEST_MIDI - LOWEST_MIDI + 1);
    expect(table[0].name).toBe('G3');
    expect(table[0].solfege).toBe('Sol 3');
    expect(table.at(-1)?.name).toBe('E6');
    expect(table.at(-1)?.solfege).toBe('Mi 6');
    for (let i = 1; i < table.length; i++) {
      expect(table[i].frequency / table[i - 1].frequency).toBeCloseTo(2 ** (1 / 12), 10);
    }
  });

  it('matches the open strings from the briefing at 442 Hz', () => {
    const byName = new Map(buildNoteTable().map((n) => [n.name, n.frequency]));
    expect(byName.get('G3')).toBeCloseTo(196.9, 1);
    expect(byName.get('D4')).toBeCloseTo(295.0, 1);
    expect(byName.get('A4')).toBe(442);
    expect(byName.get('E5')).toBeCloseTo(662.25, 2);
  });

  it('follows a configurable reference', () => {
    const table = buildNoteTable(440);
    expect(table.find((n) => n.name === 'A4')?.frequency).toBe(440);
    expect(table[0].frequency).toBeCloseTo(196.0, 1);
  });

  it('names sharps and octaves around C', () => {
    expect(noteName(60)).toBe('C4');
    expect(noteName(59)).toBe('B3');
    expect(noteName(66)).toBe('F#4');
    expect(solfegeName(73)).toBe('Dó♯ 5');
  });

  it('rejects an invalid reference', () => {
    expect(() => buildNoteTable(0)).toThrow(RangeError);
    expect(() => midiToFrequency(69, Number.NaN)).toThrow(RangeError);
  });
});

describe('hzToNote', () => {
  it('round-trips every note in range with offsets up to ±49 cents', () => {
    for (const a4 of [440, 442, 445]) {
      for (const note of buildNoteTable(a4)) {
        for (const offset of [-49, -30, -10, 0, 10, 30, 49]) {
          const hz = note.frequency * 2 ** (offset / 1200);
          const reading = hzToNote(hz, a4);
          expect(reading?.midi).toBe(note.midi);
          expect(reading?.name).toBe(note.name);
          expect(reading?.cents).toBeCloseTo(offset, 6);
          expect(reading?.inRange).toBe(true);
          expect(reading?.hz).toBe(hz);
        }
      }
    }
  });

  it('snaps to the upper note past +50 cents', () => {
    const hz = midiToFrequency(69) * 2 ** (51 / 1200);
    const reading = hzToNote(hz);
    expect(reading?.name).toBe('A#4');
    expect(reading?.cents).toBeCloseTo(-49, 6);
  });

  it('flags notes outside the violin range', () => {
    expect(hzToNote(100)?.inRange).toBe(false);
    expect(hzToNote(2000)?.inRange).toBe(false);
  });

  it('returns null for unusable input', () => {
    expect(hzToNote(0)).toBeNull();
    expect(hzToNote(-1)).toBeNull();
    expect(hzToNote(Number.NaN)).toBeNull();
    expect(hzToNote(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('agrees with frequencyToMidi and centsBetween', () => {
    expect(frequencyToMidi(884)).toBeCloseTo(81, 10);
    expect(centsBetween(884, 442)).toBeCloseTo(1200, 10);
  });
});
