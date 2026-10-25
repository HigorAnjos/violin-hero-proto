import { compensationSeconds } from '../audio/calibration/storage';
import { DEFAULT_A4 } from '../audio/notes';
import { startPitch } from '../audio/pitch';
import { createJudge } from './judge';
import { scheduleSong, secondsPerBeat } from './song';
import type { GameEvent, GameHandle, GameOptions, GameResult, Judge, Song } from './types';

export const LEAD_IN_BARS = 2;
const TICK_MS = 20;

/**
 * Listens to the source, places the song on its AudioContext clock and judges every note. Pausing is
 * context.suspend()/resume(): the clock, the song and the expiry of notes all stop with it.
 */
export async function startGame(
  source: MediaStream | AudioNode,
  song: Song,
  options: GameOptions = {},
): Promise<GameHandle> {
  const a4 = options.a4 ?? DEFAULT_A4;
  let judge: Judge | undefined;
  const pitch = await startPitch(source, (reading) => judge?.push(reading), { a4, context: options.context });
  const { context } = pitch;

  // Read the clock only after the worklet loaded: on a phone addModule can eat a precomputed lead-in.
  const leadIn = options.leadInSeconds ?? LEAD_IN_BARS * song.beatsPerBar * secondsPerBeat(song);
  const startAt = options.startAt ?? context.currentTime + leadIn;
  const notes = scheduleSong(song, startAt, a4);

  let settled = false;
  let resolve!: (result: GameResult) => void;
  let reject!: (error: unknown) => void;
  const result = new Promise<GameResult>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  result.catch(() => undefined);

  let timer: ReturnType<typeof setInterval> | undefined;
  let tornDown: Promise<void> | undefined;
  const teardown = (): Promise<void> => {
    tornDown ??= (async () => {
      if (timer !== undefined) clearInterval(timer);
      await pitch.stop().catch(() => undefined);
    })();
    return tornDown;
  };

  const onEvent = (event: GameEvent) => {
    options.onEvent?.(event);
    if (event.type !== 'done' || settled) return;
    settled = true;
    void teardown();
    resolve(event.result);
  };

  const activeJudge = createJudge(notes, {
    a4,
    windows: options.windows,
    compensationSeconds: options.compensationSeconds ?? compensationSeconds(),
    onEvent,
  });
  judge = activeJudge;
  timer = setInterval(() => {
    if (!settled) activeJudge.advance(context.currentTime);
  }, TICK_MS);

  return {
    context,
    startAt,
    notes,
    get state() {
      return activeJudge.state;
    },
    result,
    async cancel() {
      if (!settled) {
        settled = true;
        reject(new DOMException('game cancelled', 'AbortError'));
      }
      await teardown();
    },
  };
}
