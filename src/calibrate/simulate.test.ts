import { describe, expect, it, vi } from 'vitest';
import { LEAK_CLICK, NOTE_ENVELOPE, noteEnvelope, parseLeak, simulateString, simulatedOnsets } from './simulate';

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

describe('parseLeak', () => {
  it.each([
    ['?simular=100&vazamento=1', true],
    ['?vazamento=sim', true],
    ['?simular=100', false],
    ['?vazamento=0', false],
  ])('%s → %s', (search, leak) => {
    expect(parseLeak(search)).toBe(leak);
  });
});

function fakeContext() {
  const node = <T extends object>(extra: T) => {
    const n = { connect: vi.fn((next: unknown) => next), disconnect: vi.fn(), ...extra };
    return n;
  };
  const param = () => ({
    value: 1,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  });
  const oscillators: ReturnType<typeof makeOsc>[] = [];
  const gains: ReturnType<typeof makeGain>[] = [];
  const makeOsc = () => node({ setPeriodicWave: vi.fn(), frequency: { value: 0 }, start: vi.fn(), stop: vi.fn() });
  const makeGain = () => node({ gain: param() });
  const context = {
    createOscillator: () => {
      const o = makeOsc();
      oscillators.push(o);
      return o;
    },
    createPeriodicWave: vi.fn(() => ({})),
    createGain: () => {
      const g = makeGain();
      gains.push(g);
      return g;
    },
  } as unknown as BaseAudioContext;
  return { context, oscillators, gains };
}

describe('simulateString', () => {
  it('holds the A silent until bowed, then bows at every onset', () => {
    const { context, oscillators, gains } = fakeContext();
    const sim = simulateString(context, 442);
    const [oscillator] = oscillators;
    const [envelope, output] = gains;

    expect(sim.output).toBe(output);
    expect(oscillator.frequency.value).toBe(442);
    expect(oscillator.connect).toHaveBeenCalledWith(envelope);
    expect(envelope.connect).toHaveBeenCalledWith(output);
    expect(oscillator.start).toHaveBeenCalled();
    expect(envelope.gain.value).toBe(0);
    expect(envelope.gain.setValueAtTime).not.toHaveBeenCalled();

    sim.bowAt([1.1, 2.1]);
    expect(envelope.gain.setValueAtTime.mock.calls).toEqual([
      [0, 1.1],
      [0, 2.1],
    ]);
    expect(envelope.gain.linearRampToValueAtTime).toHaveBeenCalledTimes(6);

    sim.stop();
    expect(oscillator.stop).toHaveBeenCalled();
    expect(output.disconnect).toHaveBeenCalled();
  });

  it('leaks a short click into the output at each time', () => {
    const { context, oscillators, gains } = fakeContext();
    const sim = simulateString(context, 442);
    sim.leakAt([3, 4]);

    const clicks = oscillators.slice(1);
    expect(clicks).toHaveLength(2);
    expect(clicks[0].frequency.value).toBe(LEAK_CLICK.hz);
    expect(clicks[0].start).toHaveBeenCalledWith(3);
    expect(clicks[1].start).toHaveBeenCalledWith(4);
    const clickGain = gains[2];
    expect(clickGain.gain.setValueAtTime).toHaveBeenCalledWith(LEAK_CLICK.peak, 3);
    expect(clickGain.connect).toHaveBeenCalledWith(gains[1]);
  });
});
