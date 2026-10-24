export const DEFAULT_A4 = 442;
export const A4_MIDI = 69;
export const LOWEST_MIDI = 55;
export const HIGHEST_MIDI = 88;

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;
const SOLFEGE = ['Dó', 'Dó♯', 'Ré', 'Ré♯', 'Mi', 'Fá', 'Fá♯', 'Sol', 'Sol♯', 'Lá', 'Lá♯', 'Si'] as const;

export interface Note {
  midi: number;
  name: string;
  solfege: string;
  frequency: number;
}

export interface NoteReading extends Note {
  hz: number;
  cents: number;
  inRange: boolean;
}

function assertA4(a4: number): void {
  if (!Number.isFinite(a4) || a4 <= 0) {
    throw new RangeError(`invalid reference A4: ${a4}`);
  }
}

export function midiToFrequency(midi: number, a4: number = DEFAULT_A4): number {
  assertA4(a4);
  return a4 * 2 ** ((midi - A4_MIDI) / 12);
}

export function frequencyToMidi(hz: number, a4: number = DEFAULT_A4): number {
  assertA4(a4);
  return A4_MIDI + 12 * Math.log2(hz / a4);
}

export function noteName(midi: number): string {
  return `${NAMES[mod12(midi)]}${octave(midi)}`;
}

export function solfegeName(midi: number): string {
  return `${SOLFEGE[mod12(midi)]} ${octave(midi)}`;
}

export function noteFromMidi(midi: number, a4: number = DEFAULT_A4): Note {
  return {
    midi,
    name: noteName(midi),
    solfege: solfegeName(midi),
    frequency: midiToFrequency(midi, a4),
  };
}

export function buildNoteTable(a4: number = DEFAULT_A4): Note[] {
  const table: Note[] = [];
  for (let midi = LOWEST_MIDI; midi <= HIGHEST_MIDI; midi++) {
    table.push(noteFromMidi(midi, a4));
  }
  return table;
}

export function hzToNote(hz: number, a4: number = DEFAULT_A4): NoteReading | null {
  if (!Number.isFinite(hz) || hz <= 0) return null;
  const exact = frequencyToMidi(hz, a4);
  const midi = Math.round(exact);
  return {
    ...noteFromMidi(midi, a4),
    hz,
    cents: (exact - midi) * 100,
    inRange: midi >= LOWEST_MIDI && midi <= HIGHEST_MIDI,
  };
}

export function centsBetween(hz: number, targetHz: number): number {
  return 1200 * Math.log2(hz / targetHz);
}

function mod12(midi: number): number {
  return ((midi % 12) + 12) % 12;
}

function octave(midi: number): number {
  return Math.floor(midi / 12) - 1;
}
