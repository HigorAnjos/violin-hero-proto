import type { Song } from '../../game/types';

/** Linear 0..1, applied to the whole accompaniment. */
export const DEFAULT_BACKING_VOLUME = 0.5;

/**
 * speaker (default): bass and chords low enough that their leak into the microphone never scores; faint on a phone.
 * headphones: chords around C4–C5, clearly heard, for when the sound does not come out of the speaker.
 */
export type BackingOutput = 'speaker' | 'headphones';

export interface BackingOptions {
  /** AudioContext time of beat 0: the game's GameHandle.startAt, so cards, judge and backing share one clock. */
  startAt: number;
  /** Linear 0..1. Defaults to DEFAULT_BACKING_VOLUME. */
  volume?: number;
  /** Quiet guide melody. Off by default: through the speaker the microphone hears it and scores it. */
  guide?: boolean;
  /** Defaults to 'speaker'. Fixed for the session: changing it means stopping and starting again. */
  output?: BackingOutput;
  /** Reference A4 in Hz. Defaults to 442. */
  a4?: number;
  /** Defaults to context.destination. */
  destination?: AudioNode;
}

export interface BackingHandle {
  readonly startAt: number;
  /** Linear 0..1; ramps in ~50 ms. */
  setVolume(volume: number): void;
  /** Mutes or unmutes the whole accompaniment without unscheduling it. */
  setEnabled(enabled: boolean): void;
  setGuide(enabled: boolean): void;
  /** Silences and disposes every voice; safe to call twice. */
  stop(): Promise<void>;
}

export type StartBacking = (context: BaseAudioContext, song: Song, options: BackingOptions) => Promise<BackingHandle>;
