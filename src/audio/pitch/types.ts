export const DEFAULT_MIN_CLARITY = 0.9;
export const MEDIAN_WINDOW = 5;
export const HOP_SECONDS = 0.01;

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
  /** Deviation from the nearest equal-tempered note at the current A4, in [-50, 50]. */
  cents: number;
  /** McLeod clarity of the raw detection, in [0, 1]. */
  clarity: number;
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
