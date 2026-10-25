export const DEFAULT_MIN_CLARITY = 0.9;
export const MEDIAN_WINDOW = 5;
export const HOP_SECONDS = 0.01;
/** A held note changes at once beyond this distance; closer, only when the ~150 ms pitch centre crosses ±50. */
export const SWITCH_NOW_CENTS = 80;
/**
 * Cutoff of the 4th-order high-pass ahead of detection: the accompaniment lives below the violin's G3 (~197 Hz) and
 * its leak through the speaker lowers McLeod clarity under the 0.9 gate; G3 loses ~1 dB.
 */
export const HIGH_PASS_HZ = 170;

export interface PitchReading {
  /** AudioContext time, in seconds, of the last sample of the analysed window. */
  time: number;
  /** Median-smoothed fundamental frequency. */
  hz: number;
  midi: number;
  /** Scientific pitch name with sharps, e.g. "A4", "F#5". */
  name: string;
  /** pt-BR solfège, e.g. "Lá 4". */
  solfege: string;
  /** Deviation from `midi` at the current A4. Usually in [-50, 50]; up to ±80 while hysteresis holds the note. */
  cents: number;
  /** McLeod clarity of the raw detection, in [0, 1]. */
  clarity: number;
  /** RMS of the last hop (~10 ms) in dBFS: follows bow changes far faster than the 40 ms pitch window. */
  level: number;
}

/** Called every hop (~10 ms) with a reading, or with null once when the signal stops being clear. */
export type PitchListener = (reading: PitchReading | null) => void;

export interface PitchOptions {
  /** Reference A4 in Hz. Defaults to 442. */
  a4?: number;
  /** Detections below this clarity are ignored. Defaults to 0.9. */
  minClarity?: number;
  /** Context used when the source is a MediaStream; a new one is created (and closed on stop) if omitted. */
  context?: AudioContext;
}

export interface PitchHandle {
  readonly context: BaseAudioContext;
  readonly a4: number;
  setA4(a4: number): void;
  /** Disconnects the analyser and closes the AudioContext only if startPitch created it. */
  stop(): Promise<void>;
}

export type StartPitch = (
  source: MediaStream | AudioNode,
  onReading: PitchListener,
  options?: PitchOptions,
) => Promise<PitchHandle>;
