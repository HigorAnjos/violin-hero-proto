import { DEFAULT_A4, centsBetween } from '../notes';
import { PitchTracker, SlidingWindow } from '../pitch/tracker';
import { BandOnsetDetector } from './onset';
import type { Attack } from './types';

/** How long after an onset the tracker has to confirm the A, in seconds. */
export const CONFIRM_SECONDS = 0.2;
export const A_TOLERANCE_CENTS = 50;

export interface AttackTrackerOptions {
  sampleRate: number;
  a4?: number;
  minClarity?: number;
}

/**
 * Timestamps attacks of the open A: the onset comes from the A-band energy detector (sample precision, no 40 ms window
 * lag), and it only counts once the pitch tracker reads the A within CONFIRM_SECONDS after it. A newer onset replaces an
 * unconfirmed one, so a click leak right before the A yields the A's onset.
 */
export class AttackTracker {
  readonly sampleRate: number;
  readonly a4: number;
  private readonly onsets: BandOnsetDetector;
  private readonly tracker: PitchTracker;
  private readonly stream: SlidingWindow;
  private blockStart = 0;
  private nextOnset = 0;
  private pending = -1;
  private emit: (attack: Attack) => void = () => undefined;
  private readonly onWindow = (window: Float32Array, end: number): void => {
    const time = this.blockStart + end / this.sampleRate;
    this.takeOnsetsUntil(end);
    const reading = this.tracker.analyse(window, time);
    if (!reading || this.pending < 0) return;
    if (time - this.pending > CONFIRM_SECONDS) {
      this.pending = -1;
      return;
    }
    if (Math.abs(centsBetween(reading.hz, this.a4)) <= A_TOLERANCE_CENTS) {
      this.emit({ time: this.pending, hz: reading.hz });
      this.pending = -1;
    }
  };

  constructor(options: AttackTrackerOptions) {
    this.sampleRate = options.sampleRate;
    this.a4 = options.a4 ?? DEFAULT_A4;
    this.onsets = new BandOnsetDetector(this.sampleRate, this.a4);
    this.tracker = new PitchTracker({ sampleRate: this.sampleRate, a4: this.a4, minClarity: options.minClarity });
    this.stream = new SlidingWindow(this.tracker.windowSize, this.tracker.hopSize);
  }

  /** `blockStart` is the AudioContext time of `block[0]`. */
  push(block: Float32Array, blockStart: number, onAttack: (attack: Attack) => void): void {
    this.blockStart = blockStart;
    this.emit = onAttack;
    this.nextOnset = 0;
    this.onsets.push(block);
    this.stream.push(block, this.onWindow);
    this.takeOnsetsUntil(block.length);
    if (this.pending >= 0 && blockStart + block.length / this.sampleRate - this.pending > CONFIRM_SECONDS) {
      this.pending = -1;
    }
  }

  private takeOnsetsUntil(end: number): void {
    const { detected, offsets, count } = this.onsets;
    while (this.nextOnset < count && detected[this.nextOnset] <= end) {
      this.pending = this.blockStart + offsets[this.nextOnset] / this.sampleRate;
      this.nextOnset++;
    }
  }
}
