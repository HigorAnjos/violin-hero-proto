const Q = 4;
/** A Butterworth low-pass at 1.5× the centre adds ~30 dB at the 3520 Hz click on top of the band-pass skirt. */
const LOWPASS_RATIO = 1.5;
const SMOOTH_SECONDS = 0.005;
const REFERENCE_SECONDS = 0.1;
const WARMUP_SECONDS = 0.05;
export const CONTROL_SAMPLES = 16;
export const MIN_LEVEL_DB = -60;
export const RISE_DB = 12;
export const RELEASE_DB = 15;
export const MAX_ONSETS_PER_BLOCK = 8;
/** The rise is traced back to where the level was within this of the idle reference. */
export const START_DB = 3;
const HISTORY = 128;
/** Filter ring-up and envelope smoothing left after the trace-back, measured with step-onset A tones (onset.test.ts). */
export const DETECTOR_LAG_SECONDS = 0.0005;

/**
 * Finds onsets of energy in a narrow band around one frequency (Q 4 band-pass, 5 ms power envelope).
 * Idle, it fires when the band level rises RISE_DB above its recent 100 ms average and above MIN_LEVEL_DB; it re-arms
 * once the level falls RELEASE_DB below the note's peak, so a click leaking into the microphone (out of band, decays in
 * a few ms) neither fires nor masks an A that starts tens of ms later. A re-bowed note with no dip is not an onset.
 */
export class BandOnsetDetector {
  readonly sampleRate: number;
  /** Offsets in the last pushed block, just after the sample where each onset was detected. */
  readonly detected = new Int32Array(MAX_ONSETS_PER_BLOCK);
  /** Offsets where each onset began (may be negative: in an earlier block), already corrected for DETECTOR_LAG. */
  readonly offsets = new Float64Array(MAX_ONSETS_PER_BLOCK);
  count = 0;
  private readonly history = new Float64Array(HISTORY);
  private historyNext = 0;
  private readonly b0: number;
  private readonly a1: number;
  private readonly a2: number;
  private readonly smooth: number;
  private readonly refAlpha: number;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;
  private readonly l0: number;
  private readonly m1: number;
  private readonly m2: number;
  private y1prev = 0;
  private y2prev = 0;
  private z1 = 0;
  private z2 = 0;
  private power = 0;
  private reference = MIN_LEVEL_DB;
  private peak = 0;
  private active = false;
  private warmup: number;
  private sinceControl = 0;

  constructor(sampleRate: number, centerHz: number) {
    if (!(centerHz > 0 && centerHz < sampleRate / 2)) throw new RangeError(`invalid band centre: ${centerHz}`);
    this.sampleRate = sampleRate;
    const w0 = (2 * Math.PI * centerHz) / sampleRate;
    const alpha = Math.sin(w0) / (2 * Q);
    const a0 = 1 + alpha;
    this.b0 = alpha / a0;
    this.a1 = (-2 * Math.cos(w0)) / a0;
    this.a2 = (1 - alpha) / a0;
    const v0 = (2 * Math.PI * Math.min(LOWPASS_RATIO * centerHz, 0.45 * sampleRate)) / sampleRate;
    const beta = Math.sin(v0) / (2 * Math.SQRT1_2);
    const c0 = 1 + beta;
    this.l0 = (1 - Math.cos(v0)) / 2 / c0;
    this.m1 = (-2 * Math.cos(v0)) / c0;
    this.m2 = (1 - beta) / c0;
    this.smooth = 1 - Math.exp(-1 / (SMOOTH_SECONDS * sampleRate));
    this.refAlpha = 1 - Math.exp(-CONTROL_SAMPLES / (REFERENCE_SECONDS * sampleRate));
    this.warmup = Math.round(WARMUP_SECONDS * sampleRate);
  }

  /** Fills `offsets[0..count)` with this block's onsets. */
  push(block: Float32Array): void {
    this.count = 0;
    for (let i = 0; i < block.length; i++) {
      const x = block[i];
      const y = this.b0 * (x - this.x2) - this.a1 * this.y1 - this.a2 * this.y2;
      this.x2 = this.x1;
      this.x1 = x;
      this.y2 = this.y1;
      this.y1 = y;
      const z = this.l0 * (y + 2 * this.y1prev + this.y2prev) - this.m1 * this.z1 - this.m2 * this.z2;
      this.y2prev = this.y1prev;
      this.y1prev = y;
      this.z2 = this.z1;
      this.z1 = z;
      this.power += this.smooth * (z * z - this.power);
      if (++this.sinceControl < CONTROL_SAMPLES) continue;
      this.sinceControl = 0;
      const reference = Math.max(this.reference, MIN_LEVEL_DB);
      if (this.control() && this.count < MAX_ONSETS_PER_BLOCK) {
        this.detected[this.count] = i + 1;
        this.offsets[this.count] = i + 1 - this.risingSteps(reference) * CONTROL_SAMPLES - DETECTOR_LAG_SECONDS * this.sampleRate;
        this.count++;
      }
    }
  }

  /** Control steps back to the last level within START_DB of the idle reference: where the rise began. */
  private risingSteps(reference: number): number {
    let steps = 0;
    let index = this.historyNext;
    while (steps < HISTORY - 1) {
      index = index === 0 ? HISTORY - 1 : index - 1;
      if (this.history[index] <= reference + START_DB) break;
      steps++;
    }
    return steps;
  }

  private control(): boolean {
    const level = 10 * Math.log10(this.power + 1e-20);
    this.history[this.historyNext] = level;
    this.historyNext = (this.historyNext + 1) % HISTORY;
    if (this.warmup > 0) {
      this.warmup -= CONTROL_SAMPLES;
      this.reference = level;
      return false;
    }
    if (this.active) {
      if (level > this.peak) this.peak = level;
      else if (level < this.peak - RELEASE_DB) {
        this.active = false;
        this.reference = level;
      }
      return false;
    }
    if (level > this.reference + RISE_DB && level > MIN_LEVEL_DB) {
      this.active = true;
      this.peak = level;
      return true;
    }
    this.reference += this.refAlpha * (level - this.reference);
    return false;
  }
}
