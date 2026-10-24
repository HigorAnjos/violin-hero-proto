import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PitchReading } from '../audio/pitch/types';
import { startFakePitch } from './fake-pitch';

describe('startFakePitch', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('echoes an oscillator frequency as a reading until stopped', async () => {
    const readings: (PitchReading | null)[] = [];
    const oscillator = { frequency: { value: 295 }, context: {} } as unknown as AudioNode;
    const handle = await startFakePitch(oscillator, (r) => readings.push(r), { a4: 442 });

    vi.advanceTimersByTime(120);
    expect(readings).toHaveLength(2);
    expect(readings[0]).toMatchObject({ solfege: 'Ré 4', name: 'D4' });
    expect(Math.abs(readings[0]!.cents)).toBeLessThan(1);

    await handle.stop();
    vi.advanceTimersByTime(500);
    expect(readings).toHaveLength(2);
  });

  it('follows setA4', async () => {
    const readings: PitchReading[] = [];
    const oscillator = { frequency: { value: 442 }, context: {} } as unknown as AudioNode;
    const handle = await startFakePitch(oscillator, (r) => r && readings.push(r));
    handle.setA4(440);
    expect(handle.a4).toBe(440);
    vi.advanceTimersByTime(60);
    expect(readings.at(-1)!.cents).toBeGreaterThan(7);
    await handle.stop();
  });
});
