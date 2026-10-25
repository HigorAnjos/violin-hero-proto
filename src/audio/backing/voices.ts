/**
 * Pure sines with soft linear envelopes. A sine has no overtones: a chord tone of C3 with any 2nd harmonic would put
 * energy right on the melody's C4 for the microphone to hear.
 */
export interface Voice {
  /** Level of each note, in dB relative to full scale before the master volume. */
  gainDb: number;
  attack: number;
  release: number;
}

export const VOICES = {
  bass: { gainDb: -10, attack: 0.02, release: 0.12 },
  pad: { gainDb: -18, attack: 0.08, release: 0.25 },
  guide: { gainDb: -22, attack: 0.02, release: 0.08 },
} as const satisfies Record<string, Voice>;

export type VoiceName = keyof typeof VOICES;

export function dbToGain(db: number): number {
  return 10 ** (db / 20);
}
