import { DEFAULT_A4 } from '../audio/notes';

export const MIN_A4 = 430;
export const MAX_A4 = 450;
export const A4_STORAGE_KEY = 'violin-hero:a4';

export const MIN_SIGNAL_HZ = 20;
export const MAX_SIGNAL_HZ = 5000;

export function clampA4(a4: number): number {
  if (!Number.isFinite(a4)) return DEFAULT_A4;
  return Math.max(MIN_A4, Math.min(MAX_A4, Math.round(a4)));
}

export function parseA4(raw: string | null | undefined): number {
  if (raw == null || raw.trim() === '') return DEFAULT_A4;
  const value = Number(raw);
  return Number.isFinite(value) ? clampA4(value) : DEFAULT_A4;
}

export function loadA4(storage: Pick<Storage, 'getItem'> | undefined): number {
  try {
    return parseA4(storage?.getItem(A4_STORAGE_KEY));
  } catch {
    return DEFAULT_A4;
  }
}

export function saveA4(storage: Pick<Storage, 'setItem'> | undefined, a4: number): boolean {
  try {
    storage?.setItem(A4_STORAGE_KEY, String(clampA4(a4)));
    return storage != null;
  } catch {
    return false;
  }
}

export function parseSignalHz(search: string): number | null {
  const raw = new URLSearchParams(search).get('sinal');
  if (raw == null) return null;
  const value = Number(raw.trim().replace(',', '.'));
  if (!Number.isFinite(value) || value < MIN_SIGNAL_HZ || value > MAX_SIGNAL_HZ) return null;
  return value;
}
