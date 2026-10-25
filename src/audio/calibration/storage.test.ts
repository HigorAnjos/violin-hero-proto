import { describe, expect, it } from 'vitest';
import { clearCompensation, compensationSeconds, loadCompensation, saveCompensation } from './storage';
import { LATENCY_STORAGE_KEY } from './types';

class MemoryStorage implements Storage {
  private readonly map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  key(index: number) {
    return [...this.map.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
}

const throwing = {
  getItem() {
    throw new DOMException('denied', 'SecurityError');
  },
  setItem() {
    throw new DOMException('full', 'QuotaExceededError');
  },
  removeItem() {
    throw new DOMException('denied', 'SecurityError');
  },
} as unknown as Storage;

describe('compensation storage', () => {
  it('round-trips the compensation', () => {
    const storage = new MemoryStorage();
    const compensation = { delayMs: 87.5, spreadMs: 6.2, measuredAt: '2026-10-24T12:00:00.000Z' };
    expect(saveCompensation(compensation, storage)).toBe(true);
    expect(loadCompensation(storage)).toEqual(compensation);
    expect(compensationSeconds(storage)).toBeCloseTo(0.0875);
  });

  it('returns null and zero seconds before any calibration', () => {
    const storage = new MemoryStorage();
    expect(loadCompensation(storage)).toBeNull();
    expect(compensationSeconds(storage)).toBe(0);
  });

  it('ignores corrupt values', () => {
    const storage = new MemoryStorage();
    storage.setItem(LATENCY_STORAGE_KEY, '{oops');
    expect(loadCompensation(storage)).toBeNull();
    storage.setItem(LATENCY_STORAGE_KEY, JSON.stringify({ delayMs: 'x' }));
    expect(loadCompensation(storage)).toBeNull();
  });

  it('clears the stored value', () => {
    const storage = new MemoryStorage();
    saveCompensation({ delayMs: 10, spreadMs: 1, measuredAt: '' }, storage);
    clearCompensation(storage);
    expect(loadCompensation(storage)).toBeNull();
  });

  it('survives storage that throws or is missing', () => {
    expect(loadCompensation(throwing)).toBeNull();
    expect(saveCompensation({ delayMs: 10, spreadMs: 1, measuredAt: '' }, throwing)).toBe(false);
    expect(() => clearCompensation(throwing)).not.toThrow();
    expect(saveCompensation({ delayMs: 10, spreadMs: 1, measuredAt: '' }, undefined)).toBe(false);
  });
});
