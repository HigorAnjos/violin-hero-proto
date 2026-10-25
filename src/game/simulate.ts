import { DEFAULT_A4, midiToFrequency } from '../audio/notes';
import { DEFAULT_SAMPLE_RATE, mulberry32, tone, type Vibrato } from '../audio/testing/synth';
import { scheduleSong } from './song';
import type { SimulatedPlayer, SimulateParams, Song } from './types';

export const MAX_SIMULATE_MS = 1000;
/** A wrong note is a whole tone above: far outside the ±50 cent tolerance, never mistaken for a near miss. */
export const WRONG_NOTE_SEMITONES = 2;
export const SIMULATED_VIBRATO: Vibrato = { depthCents: 20, rateHz: 5.5 };
/** Silence before each bow change; enough for the pitch tracker to report the end of the note. */
export const ARTICULATION_SECONDS = 0.04;
const ATTACK_SECONDS = 0.012;
const RELEASE_SECONDS = 0.02;
const PEAK = 0.5;
/** Signal time of beat 0, leaving room for early (negative offset) notes. */
export const LEAD_SECONDS = 1.5;

export interface PerformanceOptions {
  offsetMs?: number;
  errors?: number;
  /** Explicit wrong notes; overrides `errors`. */
  wrong?: readonly number[];
  seed?: number;
  a4?: number;
  sampleRate?: number;
}

export interface Performance {
  /** Starts LEAD_SECONDS before beat 0 and ends 1 s after the last note. */
  signal: Float32Array;
  sampleRate: number;
  /** Indices of the notes played a whole tone off. */
  wrong: number[];
  /** Real onset of each note, in seconds from beat 0. */
  onsets: number[];
}

/** `count` distinct note indices chosen by a seeded generator, sorted. */
export function pickWrongNotes(noteCount: number, count: number, seed = 1): number[] {
  const n = Math.max(0, Math.min(noteCount, Math.floor(count)));
  const indices = Array.from({ length: noteCount }, (_, i) => i);
  const random = mulberry32(seed);
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(random() * (noteCount - i));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return indices.slice(0, n).sort((a, b) => a - b);
}

/** The whole song as a microphone take: violin-like tones with vibrato, every note shifted by offsetMs. */
export function renderPerformance(song: Song, options: PerformanceOptions = {}): Performance {
  const { offsetMs = 0, errors = 0, seed = 1, a4 = DEFAULT_A4, sampleRate = DEFAULT_SAMPLE_RATE } = options;
  const notes = scheduleSong(song, 0, a4);
  const wrong = options.wrong ? [...options.wrong] : pickWrongNotes(notes.length, errors, seed);
  const wrongSet = new Set(wrong);
  const last = notes.at(-1);
  const end = last ? last.time + last.duration : 0;
  const signal = new Float32Array(Math.round((LEAD_SECONDS + end + Math.max(0, offsetMs / 1000) + 1) * sampleRate));
  const onsets: number[] = [];

  for (const note of notes) {
    const onset = note.time + offsetMs / 1000;
    onsets.push(onset);
    const midi = wrongSet.has(note.index) ? note.midi + WRONG_NOTE_SEMITONES : note.midi;
    const durationSec = Math.max(0.05, note.duration - ARTICULATION_SECONDS);
    const samples = tone({
      frequency: midiToFrequency(midi, a4),
      durationSec,
      sampleRate,
      vibrato: SIMULATED_VIBRATO,
      peak: PEAK,
    });
    applyEnvelope(samples, sampleRate);
    const start = Math.round((LEAD_SECONDS + onset) * sampleRate);
    for (let i = 0; i < samples.length; i++) {
      const at = start + i;
      if (at >= 0 && at < signal.length) signal[at] += samples[i];
    }
  }
  return { signal, sampleRate, wrong, onsets };
}

function applyEnvelope(samples: Float32Array, sampleRate: number): void {
  const attack = Math.round(ATTACK_SECONDS * sampleRate);
  const release = Math.round(RELEASE_SECONDS * sampleRate);
  for (let i = 0; i < samples.length; i++) {
    const fromEnd = samples.length - 1 - i;
    samples[i] *= Math.min(1, i / attack, fromEnd / release);
  }
}

export interface SimulatePlayerOptions {
  offsetMs?: number;
  errors?: number;
  seed?: number;
  a4?: number;
}

/** Renders the take up front (~0.2 s for this song) so playAt only schedules a buffer. */
export function simulatePlayer(
  context: BaseAudioContext,
  song: Song,
  options: SimulatePlayerOptions = {},
): SimulatedPlayer {
  const take = renderPerformance(song, { ...options, sampleRate: context.sampleRate });
  const buffer = context.createBuffer(1, take.signal.length, take.sampleRate);
  buffer.getChannelData(0).set(take.signal);
  const output = context.createGain();
  let source: AudioBufferSourceNode | undefined;
  return {
    output,
    wrong: take.wrong,
    playAt(startAt: number) {
      source?.disconnect();
      source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(output);
      const begin = startAt - LEAD_SECONDS;
      const now = context.currentTime;
      if (begin >= now) source.start(begin);
      else source.start(now, now - begin);
    },
    stop() {
      try {
        source?.stop();
      } catch {
        // Never started.
      }
      source?.disconnect();
      output.disconnect();
    },
  };
}

/** ?simular=<ms>[&erros=N]: ms in ±1000 (comma or dot), N a non-negative integer; null when absent or invalid. */
export function parseSimulate(search: string): SimulateParams | null {
  const params = new URLSearchParams(search);
  const raw = params.get('simular');
  if (raw == null || raw.trim() === '') return null;
  const offsetMs = Number(raw.trim().replace(',', '.'));
  if (!Number.isFinite(offsetMs) || Math.abs(offsetMs) > MAX_SIMULATE_MS) return null;
  const rawErrors = params.get('erros');
  const errors = rawErrors == null || rawErrors.trim() === '' ? 0 : Number(rawErrors.trim());
  if (!Number.isInteger(errors) || errors < 0) return null;
  return { offsetMs, errors };
}
