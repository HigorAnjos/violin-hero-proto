import { LATENCY_STORAGE_KEY, type Compensation } from './types';

function defaultStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function loadCompensation(storage: Storage | undefined = defaultStorage()): Compensation | null {
  try {
    const raw = storage?.getItem(LATENCY_STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<Compensation>;
    if (typeof value.delayMs !== 'number' || !Number.isFinite(value.delayMs)) return null;
    return {
      delayMs: value.delayMs,
      spreadMs: typeof value.spreadMs === 'number' && Number.isFinite(value.spreadMs) ? value.spreadMs : 0,
      measuredAt: typeof value.measuredAt === 'string' ? value.measuredAt : '',
    };
  } catch {
    return null;
  }
}

/** Returns false when the storage is unavailable or full; the compensation then lives only for this page. */
export function saveCompensation(
  compensation: Compensation,
  storage: Storage | undefined = defaultStorage(),
): boolean {
  try {
    if (!storage) return false;
    storage.setItem(LATENCY_STORAGE_KEY, JSON.stringify(compensation));
    return true;
  } catch {
    return false;
  }
}

export function clearCompensation(storage: Storage | undefined = defaultStorage()): void {
  try {
    storage?.removeItem(LATENCY_STORAGE_KEY);
  } catch {
    // Unavailable storage has nothing to clear.
  }
}

/** Delay to subtract from detected attack times, in seconds; 0 before any calibration. */
export function compensationSeconds(storage: Storage | undefined = defaultStorage()): number {
  return (loadCompensation(storage)?.delayMs ?? 0) / 1000;
}
