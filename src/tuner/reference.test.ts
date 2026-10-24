import { describe, expect, it } from 'vitest';
import { A4_STORAGE_KEY, clampA4, loadA4, parseA4, parseSignalHz, saveA4 } from './reference';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

const throwing = {
  getItem: () => {
    throw new DOMException('blocked', 'SecurityError');
  },
  setItem: () => {
    throw new DOMException('full', 'QuotaExceededError');
  },
};

describe('clampA4', () => {
  it('keeps the reference within 430–450 Hz in whole hertz', () => {
    expect(clampA4(442)).toBe(442);
    expect(clampA4(440.6)).toBe(441);
    expect(clampA4(400)).toBe(430);
    expect(clampA4(500)).toBe(450);
    expect(clampA4(Number.NaN)).toBe(442);
  });
});

describe('parseA4', () => {
  it('falls back to 442 for missing or garbage values', () => {
    expect(parseA4(null)).toBe(442);
    expect(parseA4('')).toBe(442);
    expect(parseA4('abc')).toBe(442);
    expect(parseA4('438')).toBe(438);
    expect(parseA4('999')).toBe(450);
  });
});

describe('loadA4 / saveA4', () => {
  it('round-trips through storage', () => {
    const storage = memoryStorage();
    expect(saveA4(storage, 445)).toBe(true);
    expect(storage.data.get(A4_STORAGE_KEY)).toBe('445');
    expect(loadA4(storage)).toBe(445);
  });

  it('defaults to 442 when nothing is stored', () => {
    expect(loadA4(memoryStorage())).toBe(442);
    expect(loadA4(undefined)).toBe(442);
  });

  it('survives storage that throws', () => {
    expect(loadA4(throwing)).toBe(442);
    expect(saveA4(throwing, 440)).toBe(false);
  });
});

describe('parseSignalHz', () => {
  it('reads ?sinal=<Hz>', () => {
    expect(parseSignalHz('?sinal=293.6')).toBe(293.6);
    expect(parseSignalHz('?foo=1&sinal=442')).toBe(442);
    expect(parseSignalHz('?sinal=293,6')).toBe(293.6);
  });

  it('ignores missing or out-of-range values', () => {
    expect(parseSignalHz('')).toBeNull();
    expect(parseSignalHz('?sinal=')).toBeNull();
    expect(parseSignalHz('?sinal=abc')).toBeNull();
    expect(parseSignalHz('?sinal=5')).toBeNull();
    expect(parseSignalHz('?sinal=99999')).toBeNull();
  });
});
