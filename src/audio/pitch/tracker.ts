import { PitchDetector } from 'pitchy';
import { DEFAULT_A4, HIGHEST_MIDI, LOWEST_MIDI, hzToNote, midiToFrequency } from '../notes';
import { DEFAULT_MIN_CLARITY, HOP_SECONDS, MEDIAN_WINDOW, type PitchReading } from './types';

const MIN_WINDOW_SECONDS = 0.04;
const MIN_VOLUME_DB = -60;

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

export function median(values: readonly number[]): number {
  if (values.length === 0) throw new RangeError('median of empty list');
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Turns analysis windows into readings: McLeod detection, clarity and range gate, median of the last 5 clear pitches.
 * `analyse` returns a reading, `null` once when the signal stops being clear, or `undefined` when there is nothing new to report.
 */
export class PitchTracker {
  readonly sampleRate: number;
  readonly windowSize: number;
  readonly hopSize: number;
  private readonly minClarity: number;
  private readonly detector: PitchDetector<Float32Array>;
  private readonly recent: number[] = [];
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
    this.minHz = midiToFrequency(LOWEST_MIDI - 0.5, a4);
    this.maxHz = midiToFrequency(HIGHEST_MIDI + 0.5, a4);
    this._a4 = a4;
  }

  analyse(window: Float32Array, time: number): PitchReading | null | undefined {
    if (window.length !== this.windowSize) {
      throw new RangeError(`expected ${this.windowSize} samples, got ${window.length}`);
    }
    const [hz, clarity] = this.detector.findPitch(window, this.sampleRate);
    if (!(clarity >= this.minClarity) || !(hz >= this.minHz && hz <= this.maxHz)) {
      this.recent.length = 0;
      if (this.silent) return undefined;
      this.silent = true;
      return null;
    }

    this.silent = false;
    this.recent.push(hz);
    if (this.recent.length > MEDIAN_WINDOW) this.recent.shift();
    const smoothed = median(this.recent);
    const note = hzToNote(smoothed, this._a4)!;
    return {
      time,
      hz: smoothed,
      midi: note.midi,
      name: note.name,
      solfege: note.solfege,
      cents: note.cents,
      clarity,
    };
  }
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
        this.window.set(this.ring.subarray(this.write));
        this.window.set(this.ring.subarray(0, this.write), this.size - this.write);
        onWindow(this.window, i + 1);
      }
    }
  }
}
