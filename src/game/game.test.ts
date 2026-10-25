import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { noteFromMidi } from '../audio/notes';
import type { PitchListener, PitchOptions } from '../audio/pitch/types';
import { DETECTION_LAG_SECONDS } from './judge';
import type { GameEvent, Song } from './types';

const pitch = vi.hoisted(() => ({
  listener: undefined as PitchListener | undefined,
  options: undefined as PitchOptions | undefined,
  stop: vi.fn(async () => undefined),
  context: { currentTime: 0 },
}));

vi.mock('../audio/pitch', () => ({
  startPitch: vi.fn(async (_source: unknown, listener: PitchListener, options: PitchOptions) => {
    pitch.listener = listener;
    pitch.options = options;
    return { context: pitch.context, a4: options.a4, setA4: vi.fn(), stop: pitch.stop };
  }),
}));

const SONG: Song = {
  id: 't',
  title: 'T',
  composer: 'X',
  key: 'D',
  bpm: 60,
  beatsPerBar: 4,
  notes: [
    { beat: 0, beats: 1, midi: 62, string: 1 },
    { beat: 1, beats: 1, midi: 64, string: 1 },
  ],
};

function play(midi: number, at: number) {
  const n = noteFromMidi(midi, 442);
  for (let i = 0; i < 10; i++) {
    const time = at + DETECTION_LAG_SECONDS + i * 0.01;
    pitch.listener?.({ time, hz: n.frequency, midi, name: n.name, solfege: n.solfege, cents: 0, clarity: 0.97, level: -12 });
  }
  pitch.listener?.(null);
}

let startGame: typeof import('./game').startGame;

beforeEach(async () => {
  vi.useFakeTimers();
  pitch.context.currentTime = 5;
  pitch.stop.mockClear();
  ({ startGame } = await import('./game'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('startGame', () => {
  it('starts two bars after the worklet loads by default and schedules the song from there', async () => {
    const handle = await startGame({} as MediaStream, SONG, { compensationSeconds: 0 });
    expect(handle.startAt).toBe(5 + 8);
    expect(handle.notes.map((n) => n.time)).toEqual([13, 14]);
    expect(pitch.options).toMatchObject({ a4: 442 });
    await handle.cancel();
  });

  it('judges readings, expires unplayed notes on the clock and resolves at the end', async () => {
    const events: GameEvent[] = [];
    const handle = await startGame({} as MediaStream, SONG, {
      startAt: 10,
      compensationSeconds: 0,
      onEvent: (e) => events.push(e),
    });
    play(62, 10.02);
    expect(handle.state).toMatchObject({ score: 100, combo: 1 });
    pitch.context.currentTime = 12;
    await vi.advanceTimersByTimeAsync(40);
    const result = await handle.result;
    expect(result.counts).toEqual({ perfect: 1, great: 0, good: 0, miss: 1 });
    expect(events.map((e) => (e.type === 'judgment' ? e.judgment : e.type))).toEqual(['perfect', 'miss', 'done']);
    expect(pitch.stop).toHaveBeenCalledOnce();
  });

  it('applies the saved compensation unless told otherwise', async () => {
    const storage = new Map([['violin-hero:latency-ms', JSON.stringify({ delayMs: 100, spreadMs: 5, measuredAt: '' })]]);
    vi.stubGlobal('localStorage', { getItem: (k: string) => storage.get(k) ?? null });
    const events: GameEvent[] = [];
    const handle = await startGame({} as MediaStream, SONG, { startAt: 10, onEvent: (e) => events.push(e) });
    play(62, 10.1);
    expect(events[0]).toMatchObject({ judgment: 'perfect', offsetMs: expect.closeTo(0, 6) });
    await handle.cancel();
  });

  it('rejects the result and stops listening once on cancel', async () => {
    const handle = await startGame({} as MediaStream, SONG, { startAt: 10, compensationSeconds: 0 });
    await handle.cancel();
    await expect(handle.result).rejects.toMatchObject({ name: 'AbortError' });
    expect(pitch.stop).toHaveBeenCalledOnce();
    await handle.cancel();
    expect(pitch.stop).toHaveBeenCalledOnce();
  });
});
