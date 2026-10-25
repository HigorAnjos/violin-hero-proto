import { PitchDetector } from 'pitchy';
import { DEFAULT_A4, HIGHEST_MIDI, LOWEST_MIDI, frequencyToMidi, midiToFrequency, noteFromMidi } from '../notes';
import { DEFAULT_MIN_CLARITY, HOP_SECONDS, MEDIAN_WINDOW, SWITCH_NOW_CENTS, type PitchReading } from './types';

const MIN_WINDOW_SECONDS = 0.04;
const MIN_VOLUME_DB = -60;
// A 150 ms time constant leaves ~6 cents of ripple from a 5 Hz, ±30 cent vibrato, so its centre never crosses ±50.
const CENTER_ALPHA = 1 - Math.exp(-HOP_SECONDS / 0.15);

export interface TrackerOptions {
  sampleRate: number;
  a4?: number;
  minClarity?: number;
  windowSize?: number;
}

export function windowSizeFor(sampleRate: number): number {
  return 2 ** Math.ceil(Math.log2(sampleRate * MIN_WINDOW_SECONDS));
}

export function hopSizeFor(sampleRate: number): number {
  return Math.round(sampleRate * HOP_SECONDS);
}

/** Median of the first `length` values, sorted into `scratch` so nothing is allocated. */
export function median(
  values: ArrayLike<number>,
  length: number = values.length,
  scratch: Float64Array = new Float64Array(length),
): number {
  if (length === 0) throw new RangeError('median of empty list');
  for (let i = 0; i < length; i++) {
    const v = values[i];
    let j = i;
    while (j > 0 && scratch[j - 1] > v) {
      scratch[j] = scratch[j - 1];
      j--;
    }
    scratch[j] = v;
  }
  const mid = length >> 1;
  return length % 2 ? scratch[mid] : (scratch[mid - 1] + scratch[mid]) / 2;
}

/**
 * Turns analysis windows into readings: McLeod detection, clarity and range gate, median of the last 5 clear pitches,
 * and note hysteresis: the note follows a slow centre of the pitch, or jumps at once when the pitch is more than
 * SWITCH_NOW_CENTS away, so vibrato around a note played near ±50 cents does not flip it.
 * `analyse` returns a reading, `null` once when the signal stops being clear, or `undefined` when there is nothing new to report.
 */
export class PitchTracker {
  readonly sampleRate: number;
  readonly windowSize: number;
  readonly hopSize: number;
  private readonly minClarity: number;
  private readonly detector: PitchDetector<Float32Array>;
  private readonly recent = new Float64Array(MEDIAN_WINDOW);
  private readonly scratch = new Float64Array(MEDIAN_WINDOW);
  private recentCount = 0;
  private recentNext = 0;
  private heldMidi = -1;
  private center = 0;
  private silent = true;
  private _a4 = DEFAULT_A4;
  private minHz = 0;
  private maxHz = 0;

  constructor(options: TrackerOptions) {
    this.sampleRate = options.sampleRate;
    this.windowSize = options.windowSize ?? windowSizeFor(options.sampleRate);
    this.hopSize = hopSizeFor(options.sampleRate);
    this.minClarity = options.minClarity ?? DEFAULT_MIN_CLARITY;
    this.detector = PitchDetector.forFloat32Array(this.windowSize);
    this.detector.minVolumeDecibels = MIN_VOLUME_DB;
    this.setA4(options.a4 ?? DEFAULT_A4);
  }

  get a4(): number {
    return this._a4;
  }

  setA4(a4: number): void {
    this.minHz = midiToFrequency(LOWEST_MIDI - SWITCH_NOW_CENTS / 100, a4);
    this.maxHz = midiToFrequency(HIGHEST_MIDI + SWITCH_NOW_CENTS / 100, a4);
    this._a4 = a4;
  }

  analyse(window: Float32Array, time: number): PitchReading | null | undefined {
    if (window.length !== this.windowSize) {
      throw new RangeError(`expected ${this.windowSize} samples, got ${window.length}`);
    }
    const [hz, clarity] = this.detector.findPitch(window, this.sampleRate);
    if (!(clarity >= this.minClarity) || !(hz >= this.minHz && hz <= this.maxHz)) {
      this.recentCount = 0;
      this.recentNext = 0;
      this.heldMidi = -1;
      if (this.silent) return undefined;
      this.silent = true;
      return null;
    }

    this.silent = false;
    this.recent[this.recentNext] = hz;
    this.recentNext = (this.recentNext + 1) % MEDIAN_WINDOW;
    if (this.recentCount < MEDIAN_WINDOW) this.recentCount++;
    const smoothed = median(this.recent, this.recentCount, this.scratch);
    const exact = frequencyToMidi(smoothed, this._a4);
    const midi = this.holdNote(exact);
    const note = noteFromMidi(midi, this._a4);
    return {
      time,
      hz: smoothed,
      midi,
      name: note.name,
      solfege: note.solfege,
      cents: (exact - midi) * 100,
      clarity,
      level: this.lastHopLevel(window),
    };
  }

  private lastHopLevel(window: Float32Array): number {
    let sum = 0;
    for (let i = window.length - this.hopSize; i < window.length; i++) sum += window[i] * window[i];
    return 10 * Math.log10(sum / this.hopSize + 1e-12);
  }

  private holdNote(exact: number): number {
    if (this.heldMidi < 0 || Math.abs(exact - this.heldMidi) * 100 > SWITCH_NOW_CENTS) {
      this.center = exact;
      this.heldMidi = clampMidi(Math.round(exact));
      return this.heldMidi;
    }
    this.center += CENTER_ALPHA * (exact - this.center);
    if (Math.abs(this.center - this.heldMidi) > 0.5) this.heldMidi = clampMidi(Math.round(this.center));
    return this.heldMidi;
  }
}

function clampMidi(midi: number): number {
  return Math.min(HIGHEST_MIDI, Math.max(LOWEST_MIDI, midi));
}

/** Accumulates render quanta and hands out the latest `size` samples every `hop` samples. */
export class SlidingWindow {
  private readonly ring: Float32Array;
  private readonly window: Float32Array;
  private write = 0;
  private filled = 0;
  private sinceHop = 0;

  constructor(
    readonly size: number,
    readonly hop: number,
  ) {
    this.ring = new Float32Array(size);
    this.window = new Float32Array(size);
  }

  /** `endOffset` is the index in `block` just after the window's last sample. The window is reused between calls. */
  push(block: Float32Array, onWindow: (window: Float32Array, endOffset: number) => void): void {
    for (let i = 0; i < block.length; i++) {
      this.ring[this.write] = block[i];
      this.write = (this.write + 1) % this.size;
      if (this.filled < this.size) this.filled++;
      if (++this.sinceHop >= this.hop && this.filled === this.size) {
        this.sinceHop = 0;
        for (let k = 0, r = this.write; k < this.size; k++, r = r + 1 === this.size ? 0 : r + 1) {
          this.window[k] = this.ring[r];
        }
        onWindow(this.window, i + 1);
      }
    }
  }
}
