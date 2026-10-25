import { describe, expect, it } from 'vitest';
import { midiToFrequency, noteFromMidi } from '../audio/notes';
import type { PitchReading } from '../audio/pitch/types';
import { DETECTION_LAG_SECONDS, createJudge, type CreateJudgeOptions } from './judge';
import type { GameEvent, StringIndex, TimedNote } from './types';

const A4 = 442;

function note(index: number, time: number, midi: number, duration = 0.6): TimedNote {
  return { index, time, duration, midi, string: 1 as StringIndex, frequency: midiToFrequency(midi, A4) };
}

function reading(time: number, midi: number, cents = 0, level = -12): PitchReading {
  const n = noteFromMidi(midi, A4);
  const hz = n.frequency * 2 ** (cents / 1200);
  return { time, hz, midi, name: n.name, solfege: n.solfege, cents, clarity: 0.97, level };
}

/** Readings every 10 ms from `from` to `to` (exclusive) with the level given by `level(t)`. */
function held(from: number, to: number, midi: number, level: (t: number) => number = () => -12): PitchReading[] {
  const out: PitchReading[] = [];
  for (let t = from; t < to - 1e-9; t += 0.01) out.push(reading(t, midi, 0, level(t)));
  return out;
}

/** Readings every 10 ms for an attack heard `offsetMs` from `noteTime`, held for `holdSec`. */
function attack(noteTime: number, offsetMs: number, midi: number, holdSec = 0.3, cents = 0, compensation = 0) {
  const first = noteTime + offsetMs / 1000 + DETECTION_LAG_SECONDS + compensation;
  const out: PitchReading[] = [];
  for (let t = 0; t <= holdSec + 1e-9; t += 0.01) out.push(reading(first + t, midi, cents));
  return out;
}

function setup(notes: TimedNote[], options: CreateJudgeOptions = {}) {
  const events: GameEvent[] = [];
  const judge = createJudge(notes, { ...options, onEvent: (e) => events.push(e) });
  const judgments = () => events.filter((e) => e.type === 'judgment');
  const feed = (readings: (PitchReading | null)[]) => readings.forEach((r) => judge.push(r));
  return { judge, events, judgments, feed };
}

describe('timing windows', () => {
  it.each([
    [0, 'perfect'],
    [65, 'perfect'],
    [-65, 'perfect'],
    [100, 'great'],
    [-125, 'great'],
    [180, 'good'],
    [-215, 'good'],
  ] as const)('attack at %s ms → %s', (offset, expected) => {
    const { judge, judgments, feed } = setup([note(0, 1, 66)]);
    feed(attack(1, offset, 66));
    judge.advance(3);
    expect(judgments()).toHaveLength(1);
    expect(judgments()[0]).toMatchObject({ index: 0, judgment: expected });
    expect((judgments()[0] as { offsetMs: number }).offsetMs).toBeCloseTo(offset, 6);
  });

  it('an attack beyond the good window misses', () => {
    const { judge, judgments, feed } = setup([note(0, 1, 66)]);
    feed(attack(1, 260, 66));
    judge.advance(3);
    expect(judgments()[0]).toMatchObject({ judgment: 'miss', offsetMs: null });
  });

  it('a note never played misses once its window closes', () => {
    const { judge, judgments } = setup([note(0, 1, 66)]);
    judge.advance(1.2);
    expect(judgments()).toHaveLength(0);
    judge.advance(1.4);
    expect(judgments()[0]).toMatchObject({ judgment: 'miss', offsetMs: null, points: 0 });
    expect(judge.done).toBe(true);
  });

  it('keeps a note open 100 ms past its window for readings delayed by main-thread jank', () => {
    const { judge, judgments, feed } = setup([note(0, 1, 66)]);
    judge.advance(1 + 0.22 + DETECTION_LAG_SECONDS + 0.09);
    feed(attack(1, 215, 66));
    expect(judgments()[0]).toMatchObject({ judgment: 'good' });

    const late = setup([note(0, 1, 66)]);
    late.judge.advance(1 + 0.22 + DETECTION_LAG_SECONDS + 0.11);
    expect(late.judgments()[0]).toMatchObject({ judgment: 'miss' });
  });

  it('does not expire a note whose late attack is still being confirmed', () => {
    const { judge, judgments, feed } = setup([note(0, 1, 66)]);
    const late = attack(1, 210, 66);
    judge.advance(late[0].time);
    feed(late);
    expect(judgments()[0]).toMatchObject({ judgment: 'good' });
  });
});

describe('pitch', () => {
  it('a wrong note does not hit and the note misses', () => {
    const { judge, judgments, feed } = setup([note(0, 1, 66)]);
    feed(attack(1, 0, 67));
    judge.advance(3);
    expect(judgments()[0]).toMatchObject({ judgment: 'miss' });
  });

  it('accepts up to ±50 cents of the target', () => {
    for (const cents of [-45, 45]) {
      const { judge, judgments, feed } = setup([note(0, 1, 66)]);
      feed(attack(1, 0, 66, 0.3, cents));
      judge.advance(3);
      expect(judgments()[0]).toMatchObject({ judgment: 'perfect' });
    }
  });

  it('matches by frequency, not by the note the hysteresis is holding', () => {
    const { judge, judgments, feed } = setup([note(0, 1, 66)]);
    feed(attack(1, 0, 65, 0.3, 70));
    judge.advance(3);
    expect(judgments()[0]).toMatchObject({ judgment: 'perfect' });
  });

  it('honours a custom tolerance', () => {
    const { judge, judgments, feed } = setup([note(0, 1, 66)], { toleranceCents: 20 });
    feed(attack(1, 0, 66, 0.3, 30));
    judge.advance(3);
    expect(judgments()[0]).toMatchObject({ judgment: 'miss' });
  });

  it('needs a stable reading: two stray readings are not an attack', () => {
    const { judge, judgments, feed } = setup([note(0, 1, 66)]);
    feed([...attack(1, 0, 66, 0.01), null]);
    judge.advance(3);
    expect(judgments()[0]).toMatchObject({ judgment: 'miss' });
  });

  it('times the hit from the start of the run even if the pitch settles later', () => {
    const { judge, judgments, feed } = setup([note(0, 1, 66)]);
    const start = attack(1, 0, 66, 0.05, 70);
    const settled = attack(1, 60, 66, 0.2, 0);
    feed([...start, ...settled]);
    judge.advance(3);
    expect(judgments()[0]).toMatchObject({ judgment: 'perfect', offsetMs: expect.closeTo(0, 6) });
  });
});

describe('one reading, one note', () => {
  it('a held note does not hit a repeated note', () => {
    const { judge, judgments, feed } = setup([note(0, 1, 66), note(1, 1.5, 66)]);
    feed(attack(1, 0, 66, 0.9));
    judge.advance(3);
    expect(judgments().map((e) => e.judgment)).toEqual(['perfect', 'miss']);
  });

  it('a repeated note hits after a new attack (null between)', () => {
    const { judge, judgments, feed } = setup([note(0, 1, 66), note(1, 1.5, 66)]);
    feed([...attack(1, 0, 66, 0.4), null, ...attack(1.5, 20, 66, 0.4)]);
    judge.advance(3);
    expect(judgments().map((e) => e.judgment)).toEqual(['perfect', 'perfect']);
  });

  it('a repeated note hits after a new attack through a note change', () => {
    const { judge, judgments, feed } = setup([note(0, 1, 66), note(1, 1.3, 66)]);
    feed([...attack(1, 0, 66, 0.2), ...attack(1.2, 0, 67, 0.05), ...attack(1.3, 30, 66, 0.3)]);
    judge.advance(3);
    expect(judgments().map((e) => e.judgment)).toEqual(['perfect', 'perfect']);
  });

  it('an attack in two windows goes to the earliest open note: late players stay in step', () => {
    const { judge, judgments, feed } = setup([note(0, 1, 66), note(1, 1.333, 66)]);
    feed([...attack(1, 180, 66, 0.1), null, ...attack(1.333, 180, 66, 0.2)]);
    judge.advance(3);
    expect(judgments().map((e) => e.judgment)).toEqual(['good', 'good']);
  });

  it('early players too: the repetition is not taken by the first attack', () => {
    const { judge, judgments, feed } = setup([note(0, 1, 66), note(1, 1.333, 66)]);
    feed([...attack(1, -180, 66, 0.1), null, ...attack(1.333, -180, 66, 0.2)]);
    judge.advance(3);
    expect(judgments().map((e) => e.judgment)).toEqual(['good', 'good']);
  });
});

describe('bow changes and dropouts', () => {
  const dipAt = (from: number, to: number, depth: number) => (t: number) => (t >= from && t < to ? -12 - depth : -12);

  it('a dip in level and back, same pitch, is a new attack timed at the rise', () => {
    const { judge, judgments, feed } = setup([note(0, 1, 66), note(1, 1.667, 66)]);
    feed(held(1 + DETECTION_LAG_SECONDS, 2.2, 66, dipAt(1.627, 1.667, 6)));
    judge.advance(3);
    expect(judgments().map((e) => e.judgment)).toEqual(['perfect', 'perfect']);
    expect((judgments()[1] as { offsetMs: number }).offsetMs).toBeCloseTo(-2, 0);
  });

  it('a slow ±3 dB bow tremor is not an attack', () => {
    const { judge, judgments, feed } = setup([note(0, 1, 66), note(1, 1.667, 66)]);
    feed(held(1 + DETECTION_LAG_SECONDS, 2.4, 66, (t) => -12 + 3 * Math.sin(2 * Math.PI * 7 * t)));
    judge.advance(3);
    expect(judgments().map((e) => e.judgment)).toEqual(['perfect', 'miss']);
  });

  it('a gentle diminuendo and swell is not an attack', () => {
    const { judge, judgments, feed } = setup([note(0, 1, 66), note(1, 1.667, 66)]);
    feed(held(1 + DETECTION_LAG_SECONDS, 2.4, 66, (t) => -12 - 8 * Math.sin(Math.PI * Math.min(1, Math.max(0, t - 1.2)))));
    judge.advance(3);
    expect(judgments().map((e) => e.judgment)).toEqual(['perfect', 'miss']);
  });

  it('a short silence counts through the dip seen in the last hop before the dropout', () => {
    const { judge, judgments, feed } = setup([note(0, 1, 66), note(1, 1.667, 66)]);
    feed([
      ...held(1 + DETECTION_LAG_SECONDS, 1.64, 66),
      reading(1.64, 66, 0, -24),
      null,
      ...held(1.68, 2.2, 66),
    ]);
    judge.advance(3);
    expect(judgments().map((e) => e.judgment)).toEqual(['perfect', 'perfect']);
  });

  it('a clarity dropout under 60 ms inside a held note is not an attack', () => {
    const { judge, judgments, feed } = setup([note(0, 1, 66), note(1, 1.667, 66)]);
    feed([...held(1 + DETECTION_LAG_SECONDS, 1.6, 66), null, ...held(1.65, 2.2, 66)]);
    judge.advance(3);
    expect(judgments().map((e) => e.judgment)).toEqual(['perfect', 'miss']);
  });

  it('a two-reading blip to the neighbour is neither a note change nor an attack', () => {
    const { judge, judgments, feed } = setup([note(0, 1, 66), note(1, 1.667, 66)]);
    feed([...held(1 + DETECTION_LAG_SECONDS, 1.65, 66), ...held(1.65, 1.67, 65), ...held(1.67, 2.2, 66)]);
    judge.advance(3);
    expect(judgments().map((e) => e.judgment)).toEqual(['perfect', 'miss']);
  });
});

describe('order, latency and score', () => {
  it('hitting a later note misses the earlier unjudged ones first', () => {
    const { judge, judgments, feed } = setup([note(0, 1, 66), note(1, 1.333, 67)]);
    feed(attack(1.333, -150, 67));
    expect(judgments().map((e) => [e.index, e.judgment])).toEqual([
      [0, 'miss'],
      [1, 'good'],
    ]);
    judge.advance(3);
    expect(judgments()).toHaveLength(2);
  });

  it('subtracts the latency compensation', () => {
    const comp = 0.12;
    const withComp = setup([note(0, 1, 66)], { compensationSeconds: comp });
    withComp.feed(attack(1, 0, 66, 0.3, 0, comp));
    withComp.judge.advance(3);
    expect(withComp.judgments()[0]).toMatchObject({ judgment: 'perfect', offsetMs: expect.closeTo(0, 6) });

    const without = setup([note(0, 1, 66)]);
    without.feed(attack(1, 0, 66, 0.3, 0, comp));
    without.judge.advance(3);
    expect(without.judgments()[0]).toMatchObject({ judgment: 'great', offsetMs: expect.closeTo(120, 6) });
  });

  it('carries score and combo on every event and reports done once', () => {
    const notes = [note(0, 1, 66), note(1, 1.5, 67), note(2, 2, 69)];
    const { judge, events, feed } = setup(notes);
    feed([...attack(1, 0, 66, 0.3), null, ...attack(1.5, 100, 67, 0.3), null]);
    judge.advance(4);
    judge.advance(5);
    expect(events.map((e) => (e.type === 'judgment' ? [e.judgment, e.points, e.score, e.combo] : e.type))).toEqual([
      ['perfect', 100, 100, 1],
      ['great', 70, 170, 2],
      ['miss', 0, 170, 0],
      'done',
    ]);
    const done = events.at(-1);
    expect(done?.type === 'done' && done.result).toEqual({
      judgments: expect.any(Array),
      counts: { perfect: 1, great: 1, good: 0, miss: 1 },
      score: 170,
      maxCombo: 2,
    });
    expect(judge.state).toEqual({ score: 170, combo: 0, maxCombo: 2, multiplier: 1 });
  });

  it('ignores readings after the end', () => {
    const { judge, judgments, feed } = setup([note(0, 1, 66)]);
    judge.advance(3);
    feed(attack(1, 0, 66));
    expect(judgments()).toHaveLength(1);
  });

  it('uses the given A4 for the targets', () => {
    const notes = [note(0, 1, 66)];
    const { judge, judgments } = setup(notes, { a4: 415 });
    const lowHz = midiToFrequency(66, 415);
    const first = 1 + DETECTION_LAG_SECONDS;
    for (let i = 0; i < 10; i++) judge.push({ ...reading(first + i * 0.01, 65), hz: lowHz });
    judge.advance(3);
    expect(judgments()[0]).toMatchObject({ judgment: 'perfect' });
  });
});
