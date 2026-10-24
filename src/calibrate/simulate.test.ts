import { describe, expect, it, vi } from 'vitest';
import { NOTE_ENVELOPE, noteEnvelope, simulateString, simulatedOnsets } from './simulate';

describe('noteEnvelope', () => {
  it('starts silent, rises, holds and releases to silence', () => {
    expect(noteEnvelope(2)).toEqual([
      { time: 2, value: 0, ramp: false },
      { time: 2 + NOTE_ENVELOPE.attack, value: NOTE_ENVELOPE.peak, ramp: true },
      { time: 2 + NOTE_ENVELOPE.attack + NOTE_ENVELOPE.hold, value: NOTE_ENVELOPE.peak, ramp: true },
      {
        time: 2 + NOTE_ENVELOPE.attack + NOTE_ENVELOPE.hold + NOTE_ENVELOPE.release,
        value: 0,
        ramp: true,
      },
    ]);
  });

  it('ends before the next click at 60 bpm so notes stay separate', () => {
    expect(noteEnvelope(0).at(-1)!.time).toBeLessThan(1 - 0.25);
  });
});

describe('simulatedOnsets', () => {
  it('delays every click by the simulated latency', () => {
    expect(simulatedOnsets([3, 4, 5], 120)).toEqual([3.12, 4.12, 5.12]);
  });
});

describe('simulateString', () => {
  it('bows the A at every onset through a gain the caller listens to', () => {
    const gainParam = { value: 1, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() };
    const gain = { gain: gainParam, disconnect: vi.fn() };
    const oscillator = {
      setPeriodicWave: vi.fn(),
      frequency: { value: 0 },
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      disconnect: vi.fn(),
    };
    const context = {
      createOscillator: () => oscillator,
      createPeriodicWave: vi.fn(() => ({})),
      createGain: () => gain,
    } as unknown as BaseAudioContext;

    const sim = simulateString(context, 442, [1.1, 2.1]);

    expect(sim.output).toBe(gain);
    expect(oscillator.frequency.value).toBe(442);
    expect(oscillator.connect).toHaveBeenCalledWith(gain);
    expect(oscillator.start).toHaveBeenCalled();
    expect(gainParam.value).toBe(0);
    expect(gainParam.setValueAtTime.mock.calls).toEqual([
      [0, 1.1],
      [0, 2.1],
    ]);
    expect(gainParam.linearRampToValueAtTime).toHaveBeenCalledTimes(6);

    sim.stop();
    expect(oscillator.stop).toHaveBeenCalled();
    expect(gain.disconnect).toHaveBeenCalled();
  });
});
