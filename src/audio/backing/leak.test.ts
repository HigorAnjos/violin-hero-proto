import { describe, expect, it } from 'vitest';
import { PitchTracker } from '../pitch/tracker';
import { createJudge } from '../../game/judge';
import { LEAD_SECONDS, renderPerformance } from '../../game/simulate';
import { C_MAJOR_SCALE, scheduleSong } from '../../game/song';
import type { GameResult, Song } from '../../game/types';
import { renderBacking } from './render';

const A4 = 442;
const BLOCK = 128;
const SAMPLE_RATE = 48_000;

function judgeSignal(signal: Float32Array, song: Song): GameResult {
  const judge = createJudge(scheduleSong(song, LEAD_SECONDS, A4), { onEvent: () => undefined });
  const tracker = new PitchTracker({ sampleRate: SAMPLE_RATE, a4: A4 });
  const stream = tracker.createWindow();
  for (let start = 0; start < signal.length && !judge.done; start += BLOCK) {
    const blockStart = start / SAMPLE_RATE;
    stream.push(signal.subarray(start, start + BLOCK), (window, end) => {
      const reading = tracker.analyse(window, blockStart + end / SAMPLE_RATE);
      if (reading !== undefined) judge.push(reading);
    });
    judge.advance((start + BLOCK) / SAMPLE_RATE);
  }
  return judge.result();
}

function rms(signal: Float32Array): number {
  let sum = 0;
  for (const v of signal) sum += v * v;
  return Math.sqrt(sum / signal.length);
}

/**
 * The simulated violin and the accompaniment leaking into the microphone `leakDb` below the violin's level (RMS over
 * the same take). With `violin` false the leak keeps that level and nothing else is heard.
 */
function take(
  song: Song,
  leakDb: number,
  { violin = true, guide = false, accompaniment = true, wrong = [] as number[] } = {},
): Float32Array {
  const { signal } = renderPerformance(song, { a4: A4, sampleRate: SAMPLE_RATE, wrong });
  const backing = renderBacking(song, {
    sampleRate: SAMPLE_RATE,
    length: signal.length,
    startSeconds: LEAD_SECONDS,
    a4: A4,
    guide,
    accompaniment,
  });
  const scale = (rms(signal) / rms(backing)) * 10 ** (leakDb / 20);
  const mix = new Float32Array(signal.length);
  for (let i = 0; i < mix.length; i++) mix[i] = (violin ? signal[i] : 0) + backing[i] * scale;
  return mix;
}

const hits = (result: GameResult) => result.counts.perfect + result.counts.great + result.counts.good;

describe('accompaniment leaking into the microphone', { timeout: 60_000 }, () => {
  const song = C_MAJOR_SCALE;

  it.each([0, -6, -12])('alone at %s dB: not a single note is scored', (leakDb) => {
    const result = judgeSignal(take(song, leakDb, { violin: false }), song);
    expect(hits(result)).toBe(0);
    expect(result.counts.miss).toBe(song.notes.length);
  });

  it.each([-3, -6, -12])('under the violin at %s dB: every note still Perfeito', (leakDb) => {
    const result = judgeSignal(take(song, leakDb), song);
    expect(result.counts.perfect).toBe(song.notes.length);
  });

  it('under a violin playing 3 wrong notes at -6 dB: exactly those are Errou', () => {
    const wrong = [2, 7, 11];
    const result = judgeSignal(take(song, -6, { wrong }), song);
    expect(result.judgments.filter((j) => j.judgment === 'miss').map((j) => j.index)).toEqual(wrong);
    expect(result.counts.perfect).toBe(song.notes.length - wrong.length);
  });

  it('the guide melody alone at -12 dB does score notes: that is why it is off by default', () => {
    const result = judgeSignal(take(song, -12, { violin: false, guide: true, accompaniment: false }), song);
    expect(hits(result)).toBeGreaterThan(0);
  });
});
