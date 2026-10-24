export const SILENCE_DB = -100;

export function rms(samples: ArrayLike<number>): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

export function peak(samples: ArrayLike<number>): number {
  let max = 0;
  for (let i = 0; i < samples.length; i++) max = Math.max(max, Math.abs(samples[i]));
  return max;
}

export function toDbfs(amplitude: number): number {
  if (!(amplitude > 0)) return SILENCE_DB;
  return Math.max(SILENCE_DB, 20 * Math.log10(amplitude));
}

export function meterFraction(db: number, minDb = -60): number {
  if (db <= minDb) return 0;
  if (db >= 0) return 1;
  return (db - minDb) / -minDb;
}

export function fallOff(previousDb: number, currentDb: number, dtSec: number, fallDbPerSec = 40): number {
  return Math.max(currentDb, previousDb - fallDbPerSec * dtSec);
}
