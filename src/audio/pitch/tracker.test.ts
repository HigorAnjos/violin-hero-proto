import { describe, expect, it } from 'vitest';
import { HIGHEST_MIDI, LOWEST_MIDI, midiToFrequency, noteName } from '../notes';
import { concat, silence, tone, whiteNoise } from '../testing/synth';
import { PitchTracker, SlidingWindow, hopSizeFor, median, windowSizeFor, type TrackerOptions } from './tracker';
import type { PitchReading } from './types';

const SAMPLE_RATE = 48000;
const ALL_MIDI = Array.from({ length: HIGHEST_MIDI - LOWEST_MIDI + 1 }, (_, i) => LOWEST_MIDI + i);
const WARMUP_SEC = 0.1;

function track(signal: Float32Array, options: Partial<TrackerOptions> = {}): (PitchReading | null)[] {
  const sampleRate = options.sampleRate ?? SAMPLE_RATE;
  const tracker = new PitchTracker({ sampleRate, ...options });
  const stream = new SlidingWindow(tracker.windowSize, tracker.hopSize);
  const events: (PitchReading | null)[] = [];
  const block = 128;
  for (let start = 0; start < signal.length; start += block) {
    const quantum = signal.subarray(start, start + block);
    stream.push(quantum, (window, end) => {
      const event = tracker.analyse(window, (start + end) / sampleRate);
      if (event !== undefined) events.push(event);
    });
  }
  return events;
}

function settled(events: (PitchReading | null)[]): PitchReading[] {
  return events.filter((e): e is PitchReading => e !== null && e.time >= WARMUP_SEC);
}

describe('median', () => {
  it('handles odd and even lengths', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it('uses only the first length values and sorts into the scratch buffer', () => {
    const scratch = new Float64Array(5);
    expect(median(Float64Array.from([5, 1, 3, 9, 9]), 3, scratch)).toBe(3);
    expect([...scratch.subarray(0, 3)]).toEqual([1, 3, 5]);
  });

  it('rejects an empty list', () => {
    expect(() => median([])).toThrow(RangeError);
  });
});

describe('sizes', () => {
  it('uses a 2048-sample window and a 10 ms hop at 48 kHz and 44.1 kHz', () => {
    expect(windowSizeFor(48000)).toBe(2048);
    expect(windowSizeFor(44100)).toBe(2048);
    expect(hopSizeFor(48000)).toBe(480);
    expect(hopSizeFor(44100)).toBe(441);
  });
});

describe('SlidingWindow', () => {
  it('emits the latest samples in order every hop once full', () => {
    const stream = new SlidingWindow(4, 2);
    const seen: number[][] = [];
    const ends: number[] = [];
    stream.push(Float32Array.from([1, 2, 3, 4, 5]), (w, end) => {
      seen.push([...w]);
      ends.push(end);
    });
    stream.push(Float32Array.from([6, 7]), (w) => seen.push([...w]));
    expect(seen).toEqual([
      [1, 2, 3, 4],
      [3, 4, 5, 6],
    ]);
    expect(ends).toEqual([4]);
  });
});

describe('PitchTracker', () => {
  it('rejects a window of the wrong size', () => {
    const tracker = new PitchTracker({ sampleRate: SAMPLE_RATE });
    expect(() => tracker.analyse(new Float32Array(100), 0)).toThrow(RangeError);
  });

  it.each(ALL_MIDI)('detects midi %i with harmonics', (midi) => {
    const readings = settled(track(tone({ frequency: midiToFrequency(midi), durationSec: 0.5 })));
    expect(readings.length).toBeGreaterThan(30);
    for (const r of readings) {
      expect(r.midi).toBe(midi);
      expect(r.name).toBe(noteName(midi));
      expect(Math.abs(r.cents)).toBeLessThan(3);
      expect(r.clarity).toBeGreaterThanOrEqual(0.9);
    }
  });

  it.each(ALL_MIDI)('keeps midi %i through ±30 cents vibrato at 5 Hz', (midi) => {
    const signal = tone({ frequency: midiToFrequency(midi), durationSec: 1, vibrato: { depthCents: 30, rateHz: 5 } });
    const readings = settled(track(signal));
    expect(readings.length).toBeGreaterThan(70);
    for (const r of readings) expect(r.midi).toBe(midi);
    expect(Math.max(...readings.map((r) => Math.abs(r.cents)))).toBeGreaterThan(15);
  });

  it.each(ALL_MIDI)('detects midi %i under background noise', (midi) => {
    const signal = tone({ frequency: midiToFrequency(midi), durationSec: 0.5, noise: 0.2, seed: midi });
    const readings = settled(track(signal));
    expect(readings.length).toBeGreaterThan(30);
    for (const r of readings) expect(r.midi).toBe(midi);
  });

  it.each(ALL_MIDI.flatMap((midi) => [[midi, 40] as const, [midi, -40] as const]))(
    'holds midi %i through ±30 cents vibrato centred at %i cents',
    (midi, offsetCents) => {
      const signal = tone({
        frequency: midiToFrequency(midi + offsetCents / 100),
        durationSec: 1.5,
        vibrato: { depthCents: 30, rateHz: 5 },
      });
      const all = track(signal);
      expect(all).not.toContain(null);
      const readings = all as PitchReading[];
      const changes = readings.slice(1).filter((r, i) => r.midi !== readings[i].midi).length;
      expect(changes).toBeLessThanOrEqual(1);
      const late = readings.filter((r) => r.time >= 0.4);
      expect(late.length).toBeGreaterThan(100);
      for (const r of late) expect(r.midi).toBe(midi);
      expect(Math.max(...late.map((r) => Math.abs(r.cents)))).toBeGreaterThan(55);
    },
  );

  it('switches at once to an in-tune semitone and within ~150 ms to one played 25 cents flat', () => {
    const inTune = track(
      concat(tone({ frequency: midiToFrequency(62), durationSec: 0.3 }), tone({ frequency: midiToFrequency(63), durationSec: 0.3 })),
    ).filter((e): e is PitchReading => e !== null);
    const firstInTune = inTune.find((r) => r.midi === 63)!;
    expect(firstInTune.time - 0.3).toBeLessThan(0.06);

    const flat = track(
      concat(
        tone({ frequency: midiToFrequency(62), durationSec: 0.3 }),
        tone({ frequency: midiToFrequency(62.75), durationSec: 0.5 }),
      ),
    ).filter((e): e is PitchReading => e !== null);
    const firstFlat = flat.find((r) => r.midi === 63)!;
    expect(firstFlat.time - 0.3).toBeLessThan(0.2);
    for (const r of flat.filter((r) => r.time > firstFlat.time)) expect(r.midi).toBe(63);
  });

  it('starts fresh on the nearest note after silence', () => {
    const events = track(
      concat(
        tone({ frequency: midiToFrequency(62.4), durationSec: 0.3 }),
        silence(0.1),
        tone({ frequency: midiToFrequency(62.6), durationSec: 0.3 }),
      ),
    );
    const afterGap = events.filter((e): e is PitchReading => e !== null && e.time > 0.4);
    expect(afterGap.length).toBeGreaterThan(10);
    for (const r of afterGap) expect(r.midi).toBe(63);
  });

  it('works at 44.1 kHz', () => {
    const signal = tone({ frequency: midiToFrequency(62), durationSec: 0.5, sampleRate: 44100 });
    const readings = settled(track(signal, { sampleRate: 44100 }));
    expect(readings.length).toBeGreaterThan(30);
    for (const r of readings) expect(r.midi).toBe(62);
  });

  it('reports nothing for silence', () => {
    expect(track(silence(1))).toEqual([]);
  });

  it.each([1, 2, 3, 4, 5])('reports nothing for pure noise (seed %i)', (seed) => {
    expect(track(whiteNoise(SAMPLE_RATE, 0.3, seed))).toEqual([]);
  });

  it('emits a single null when a note stops', () => {
    const events = track(concat(tone({ frequency: midiToFrequency(69), durationSec: 0.3 }), silence(0.3)));
    const firstNull = events.indexOf(null);
    expect(firstNull).toBeGreaterThan(0);
    expect(events.slice(firstNull)).toEqual([null]);
  });

  it('follows a note change within the median window', () => {
    const a = midiToFrequency(62);
    const b = midiToFrequency(66);
    const events = track(concat(tone({ frequency: a, durationSec: 0.3 }), tone({ frequency: b, durationSec: 0.3 })));
    const late = events.filter((e): e is PitchReading => e !== null && e.time >= 0.45);
    expect(late.length).toBeGreaterThan(10);
    for (const r of late) expect(r.midi).toBe(66);
  });

  it('measures cents against the configured A4', () => {
    const signal = tone({ frequency: 440, durationSec: 0.4 });
    const at440 = settled(track(signal, { a4: 440 }));
    const at442 = settled(track(signal, { a4: 442 }));
    for (const r of at440) expect(r.cents).toBeCloseTo(0, 0);
    for (const r of at442) {
      expect(r.midi).toBe(69);
      expect(r.cents).toBeCloseTo(-7.85, 0);
    }
  });

  it('applies setA4 to later readings', () => {
    const tracker = new PitchTracker({ sampleRate: SAMPLE_RATE });
    const window = tone({ frequency: 440, durationSec: 0.1 }).subarray(0, tracker.windowSize);
    expect(tracker.analyse(window, 0)!.cents).toBeCloseTo(-7.85, 0);
    tracker.setA4(440);
    expect(tracker.a4).toBe(440);
    expect(tracker.analyse(window, 0.01)!.cents).toBeCloseTo(0, 0);
  });

  it('ignores pitches outside the violin range', () => {
    expect(track(tone({ frequency: 100, durationSec: 0.4 }))).toEqual([]);
  });
});
