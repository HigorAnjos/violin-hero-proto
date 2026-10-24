export const DEFAULT_BPM = 60;
export const DEFAULT_BEATS = 8;
export const DEFAULT_COUNT_IN = 4;
/** A beat whose attack lands farther than this from its click is discarded. */
export const MAX_DELAY_MS = 250;
/** Fewer kept beats than this and the session is not trusted (result.ok = false, nothing saved). */
export const MIN_BEATS = 5;
export const LATENCY_STORAGE_KEY = 'violin-hero:latency-ms';

export interface ClickSchedule {
  /** AudioContext times of the count-in clicks, not measured. */
  countIn: number[];
  /** AudioContext times of the measured clicks, one per beat. */
  beats: number[];
}

export type BeatStatus = 'hit' | 'missed' | 'outlier';

export interface BeatResult {
  index: number;
  clickTime: number;
  /** AudioContext time of the attack assigned to this click, or null when missed. */
  attackTime: number | null;
  /** attackTime − clickTime in ms; null when missed. Set for outliers too, which are not used in the result. */
  delayMs: number | null;
  status: BeatStatus;
}

export interface CalibrationResult {
  /** Robust delay (20% trimmed mean of kept beats), in ms. NaN when no beat was kept. */
  delayMs: number;
  /** Standard deviation of the trimmed beats, in ms. */
  spreadMs: number;
  beatsUsed: number;
  beats: BeatResult[];
  /** beatsUsed ≥ MIN_BEATS; only then the compensation is saved. */
  ok: boolean;
}

/** An attack confirmed as the A string by the pitch tracker. */
export interface Attack {
  time: number;
  hz: number;
}

export type CalibrationEvent =
  | { type: 'scheduled'; schedule: ClickSchedule }
  | { type: 'click'; index: number; time: number; countIn: boolean }
  | { type: 'attack'; attack: Attack }
  | { type: 'beat'; beat: BeatResult }
  | { type: 'done'; result: CalibrationResult };

export type CalibrationListener = (event: CalibrationEvent) => void;

export interface CalibrationOptions {
  bpm?: number;
  beats?: number;
  countIn?: number;
  /** Reference A4 in Hz; the attack must be within ±50 cents of it. Defaults to 442. */
  a4?: number;
  /** Context used when the source is a MediaStream; a new one is created (and closed on stop) if omitted. */
  context?: AudioContext;
  /** AudioContext time of the first count-in click. Defaults to currentTime + 0.5 s. */
  startAt?: number;
  /** Persist the compensation when the result is ok. Defaults to true. */
  save?: boolean;
  onEvent?: CalibrationListener;
}

export interface CalibrationHandle {
  readonly context: BaseAudioContext;
  readonly schedule: ClickSchedule;
  /** Resolves after the last beat window closes; rejects if cancelled. */
  readonly result: Promise<CalibrationResult>;
  cancel(): Promise<void>;
}

export type StartCalibration = (
  source: MediaStream | AudioNode,
  options?: CalibrationOptions,
) => Promise<CalibrationHandle>;

export interface Compensation {
  delayMs: number;
  spreadMs: number;
  /** ISO 8601. */
  measuredAt: string;
}
