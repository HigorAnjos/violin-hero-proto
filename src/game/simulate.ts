import { DEFAULT_A4, midiToFrequency } from '../audio/notes';
import { DEFAULT_SAMPLE_RATE, VIOLIN_HARMONICS, mulberry32, whiteNoise, type Vibrato } from '../audio/testing/synth';
import { scheduleSong } from './song';
import type { SimulatedPlayer, SimulateParams, Song } from './types';

export const MAX_SIMULATE_MS = 1000;
/** A wrong note is a whole tone above: far outside the ±50 cent tolerance, never mistaken for a near miss. */
export const WRONG_NOTE_SEMITONES = 2;
export const SIMULATED_VIBRATO: Vibrato = { depthCents: 20, rateHz: 5.5 };
/** Bow change before every note: the level dips this much for this long, with no silence and no phase reset. */
export const BOW_CHANGE = { depthDb: 15, seconds: 0.03 };
const EDGE_SECONDS = 0.005;
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
  vibrato?: Vibrato;
  /** Level dip of each bow change, ending at every note onset after the first. */
  bowChange?: { depthDb: number; seconds: number };
  /** Bow tremor: slow level wobble of ±depthDb. */
  tremor?: { depthDb: number; rateHz: number };
  /** White noise amplitude added on top (bow scratch, room). */
  noise?: number;
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

/**
 * The whole song as one legato bow stroke sequence: a single phase-continuous violin-like voice with vibrato, a level
 * dip before each note as the bow changes, every note shifted by offsetMs. Repeated notes are therefore told apart by
 * level alone, the hard case for the judge.
 */
export function renderPerformance(song: Song, options: PerformanceOptions = {}): Performance {
  const {
    offsetMs = 0,
    errors = 0,
    seed = 1,
    a4 = DEFAULT_A4,
    sampleRate = DEFAULT_SAMPLE_RATE,
    vibrato = SIMULATED_VIBRATO,
    bowChange = BOW_CHANGE,
    tremor,
    noise = 0,
  } = options;
  const notes = scheduleSong(song, 0, a4);
  const wrong = options.wrong ? [...options.wrong] : pickWrongNotes(notes.length, errors, seed);
  const wrongSet = new Set(wrong);
  const shift = offsetMs / 1000;
  const onsets = notes.map((note) => note.time + shift);
  const last = notes.at(-1);
  const end = last ? last.time + last.duration + shift : 0;
  const signal = new Float32Array(Math.round((LEAD_SECONDS + Math.max(0, end) + 1) * sampleRate));
  const frequencies = notes.map((note) =>
    midiToFrequency(wrongSet.has(note.index) ? note.midi + WRONG_NOTE_SEMITONES : note.midi, a4),
  );
  const dipGain = 10 ** (-bowChange.depthDb / 20);
  const scale = PEAK / VIOLIN_HARMONICS.reduce((sum, h) => sum + h, 0);
  const nyquist = sampleRate / 2;

  let current = 0;
  let phase = 0;
  for (let i = 0; i < signal.length && notes.length; i++) {
    const t = i / sampleRate - LEAD_SECONDS;
    if (t < onsets[0]) continue;
    if (t > end + RELEASE_SECONDS) break;
    while (current + 1 < notes.length && t >= onsets[current + 1]) current++;

    let gain = Math.min(1, (t - onsets[0]) / ATTACK_SECONDS, (end + RELEASE_SECONDS - t) / RELEASE_SECONDS);
    if (current + 1 < notes.length) gain *= dipEnvelope(onsets[current + 1] - t, bowChange.seconds, dipGain);
    if (tremor) gain *= 10 ** ((tremor.depthDb * Math.sin(2 * Math.PI * tremor.rateHz * t)) / 20);

    const f = frequencies[current] * 2 ** ((vibrato.depthCents * Math.sin(2 * Math.PI * vibrato.rateHz * t)) / 1200);
    let sample = 0;
    for (let k = 0; k < VIOLIN_HARMONICS.length && (k + 1) * f < nyquist; k++) {
      sample += VIOLIN_HARMONICS[k] * Math.sin((k + 1) * phase);
    }
    signal[i] = sample * gain * scale;
    phase += (2 * Math.PI * f) / sampleRate;
  }
  if (noise > 0) {
    const hiss = whiteNoise(signal.length, noise, seed);
    for (let i = 0; i < signal.length; i++) signal[i] += hiss[i];
  }
  return { signal, sampleRate, wrong, onsets };
}

/** Gain `before` seconds ahead of a bow change's end: dipped for `seconds`, with short linear edges; 1 elsewhere. */
function dipEnvelope(before: number, seconds: number, dipGain: number): number {
  if (before < 0 || before > seconds + EDGE_SECONDS) return 1;
  if (before > seconds) return 1 - ((seconds + EDGE_SECONDS - before) / EDGE_SECONDS) * (1 - dipGain);
  if (before < EDGE_SECONDS) return dipGain + ((EDGE_SECONDS - before) / EDGE_SECONDS) * (1 - dipGain);
  return dipGain;
}

export interface SimulatePlayerOptions {
  offsetMs?: number;
  errors?: number;
  seed?: number;
  a4?: number;
}

/** Renders the take up front (~0.3 s for this song) so playAt only schedules a buffer. */
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
