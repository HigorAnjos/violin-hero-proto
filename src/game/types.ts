import type { PitchReading } from '../audio/pitch/types';

/** Open strings in first position, low to high: 0 = G (Sol), 1 = D (Ré), 2 = A (Lá), 3 = E (Mi). */
export type StringIndex = 0 | 1 | 2 | 3;
export const OPEN_STRING_MIDI: readonly [number, number, number, number] = [55, 62, 69, 76];
export const STRING_SOLFEGE: readonly [string, string, string, string] = ['Sol', 'Ré', 'Lá', 'Mi'];

/** One note of the song file; times are in beats so the tempo can change without rewriting the melody. */
export interface SongNote {
  /** Start, in beats from the first beat of the song. */
  beat: number;
  /** Length in beats. */
  beats: number;
  midi: number;
  string: StringIndex;
}

/** The song JSON. */
export interface Song {
  id: string;
  title: string;
  composer: string;
  key: string;
  bpm: number;
  beatsPerBar: number;
  notes: SongNote[];
}

/** A song note placed on the AudioContext clock by scheduleSong. */
export interface TimedNote {
  index: number;
  /** AudioContext time, in seconds, when the note should start. */
  time: number;
  /** Length in seconds. */
  duration: number;
  midi: number;
  string: StringIndex;
  /** Target frequency at the current A4. */
  frequency: number;
}

export type Judgment = 'perfect' | 'great' | 'good' | 'miss';

/** Half-widths of the timing windows, in ms; anything beyond `good` (or never played) is a miss. */
export interface JudgeWindows {
  perfect: number;
  great: number;
  good: number;
}

export interface JudgeOptions {
  windows?: JudgeWindows;
  /** A reading matches a note within this many cents of its target. Defaults to 50. */
  toleranceCents?: number;
  /** Seconds subtracted from detected hit times: the F3 latency compensation. Defaults to 0. */
  compensationSeconds?: number;
  a4?: number;
}

export interface ScoreState {
  score: number;
  combo: number;
  maxCombo: number;
  /** Multiplier applied to the next hit. */
  multiplier: number;
}

export interface NoteJudgment {
  index: number;
  judgment: Judgment;
  /** Compensated hit time − note time, in ms (negative = early); null for a note never played. */
  offsetMs: number | null;
  /** Points this note added (already multiplied). */
  points: number;
}

export interface GameResult {
  judgments: NoteJudgment[];
  counts: Record<Judgment, number>;
  score: number;
  maxCombo: number;
}

export type GameEvent =
  | ({ type: 'judgment' } & NoteJudgment & ScoreState)
  | { type: 'done'; result: GameResult };

export type GameListener = (event: GameEvent) => void;

/** Pure, clock-driven judge: feed it every pitch reading and the current time; it emits judgments in note order. */
export interface Judge {
  readonly notes: readonly TimedNote[];
  readonly state: ScoreState;
  /** A reading from startPitch, or null when the signal stops being clear (that ends the current attack). */
  push(reading: PitchReading | null): void;
  /** Expires notes whose window closed before `now` (AudioContext time); call every frame, readings or not. */
  advance(now: number): void;
  /** True once every note has been judged. */
  readonly done: boolean;
  result(): GameResult;
}

export interface GameOptions {
  /** Context used when the source is a MediaStream; a new one is created (and closed on cancel/end) if omitted. */
  context?: AudioContext;
  /** AudioContext time of beat 0. Defaults to currentTime + leadIn after the pitch worklet is loaded. */
  startAt?: number;
  /** Seconds between start and beat 0 when startAt is omitted. Defaults to 2 bars. */
  leadInSeconds?: number;
  a4?: number;
  /** Defaults to the saved F3 compensation (compensationSeconds()). Pass 0 in ?simular mode. */
  compensationSeconds?: number;
  windows?: JudgeWindows;
  onEvent?: GameListener;
}

export interface GameHandle {
  readonly context: BaseAudioContext;
  /** AudioContext time of beat 0. */
  readonly startAt: number;
  readonly notes: readonly TimedNote[];
  /** Live score; also delivered with every judgment event. */
  readonly state: ScoreState;
  /** Resolves when the last note is judged; rejects if cancelled. */
  readonly result: Promise<GameResult>;
  cancel(): Promise<void>;
}

export type StartGame = (source: MediaStream | AudioNode, song: Song, options?: GameOptions) => Promise<GameHandle>;

/** ?simular=<ms>[&erros=N] */
export interface SimulateParams {
  /** Every note is played this many ms late (negative = early). */
  offsetMs: number;
  /** How many notes are played wrong (a whole tone off). */
  errors: number;
}

/** Synthetic violinist; not routed to the speakers. Pattern of the F3 ?simular: start the game first, then play. */
export interface SimulatedPlayer {
  /** Feed this to startGame in place of the microphone. */
  readonly output: AudioNode;
  /** Indices of the notes that will be played wrong. */
  readonly wrong: readonly number[];
  /** Schedules the whole song with beat 0 at `startAt` (use handle.startAt). */
  playAt(startAt: number): void;
  stop(): void;
}
