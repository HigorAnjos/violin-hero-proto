import { centsBetween, midiToFrequency } from '../audio/notes';
import type { PitchReading } from '../audio/pitch/types';
import { DEFAULT_WINDOWS, applyJudgment, initialScore, judgeOffset } from './score';
import type {
  GameListener,
  GameResult,
  Judge,
  JudgeOptions,
  Judgment,
  NoteJudgment,
  ScoreState,
  TimedNote,
} from './types';

export const DEFAULT_TOLERANCE_CENTS = 50;
/** Consecutive readings of one note (~20 ms apart at the 10 ms hop) before it counts as played. */
export const STABLE_READINGS = 3;
/**
 * From a real onset to the first reading of the new note: ~21 ms after silence (half the 40 ms window), ~43 ms out of
 * legato; the F3 compensation measured the onset itself, so only this pitch-window lag is left to remove.
 */
export const DETECTION_LAG_SECONDS = 0.03;
/** An attack whose pitch is still off at its stable reading may settle within this time and still hit. */
export const SETTLE_SECONDS = 0.1;
// Notes expire this much later than their window so an attack still being confirmed is not cut off.
const EXPIRY_SLACK_SECONDS = 0.05;

export interface CreateJudgeOptions extends JudgeOptions {
  detectionLagSeconds?: number;
  onEvent?: GameListener;
}

/**
 * Each attack is a run of readings of one note, ended by a null reading or a note change; it hits at most one note,
 * the unjudged one nearest in time whose pitch matches within the tolerance and whose window contains the attack.
 * A repeated note therefore needs a new attack. Hitting a note misses every earlier unjudged one, so judgments come
 * out in note order.
 */
export function createJudge(notes: readonly TimedNote[], options: CreateJudgeOptions = {}): Judge {
  const windows = options.windows ?? DEFAULT_WINDOWS;
  const tolerance = options.toleranceCents ?? DEFAULT_TOLERANCE_CENTS;
  const shift = (options.detectionLagSeconds ?? DETECTION_LAG_SECONDS) + (options.compensationSeconds ?? 0);
  const onEvent = options.onEvent;
  const targets = notes.map((note) => (options.a4 ? midiToFrequency(note.midi, options.a4) : note.frequency));
  const judgments: (NoteJudgment | undefined)[] = new Array(notes.length);
  const goodSeconds = windows.good / 1000;

  let state: ScoreState = initialScore();
  let firstOpen = 0;
  let finished = false;

  let runMidi = -1;
  let runStart = 0;
  let runCount = 0;
  let runUsed = false;

  function judge(index: number, judgment: Judgment, offsetMs: number | null): void {
    const next = applyJudgment(state, judgment);
    state = next.state;
    const record: NoteJudgment = { index, judgment, offsetMs, points: next.points };
    judgments[index] = record;
    onEvent?.({ type: 'judgment', ...record, ...state });
  }

  function missBefore(index: number): void {
    for (; firstOpen < index; firstOpen++) {
      if (!judgments[firstOpen]) judge(firstOpen, 'miss', null);
    }
    while (firstOpen < notes.length && judgments[firstOpen]) firstOpen++;
  }

  function finishIfDone(): void {
    if (finished || firstOpen < notes.length) return;
    finished = true;
    onEvent?.({ type: 'done', result: result() });
  }

  function tryHit(hz: number): boolean {
    const hitTime = runStart - shift;
    let best = -1;
    let bestDistance = Infinity;
    for (let i = firstOpen; i < notes.length; i++) {
      if (judgments[i]) continue;
      const distance = Math.abs(hitTime - notes[i].time);
      if (notes[i].time - hitTime > goodSeconds) break;
      if (distance > goodSeconds || distance >= bestDistance) continue;
      if (Math.abs(centsBetween(hz, targets[i])) > tolerance) continue;
      best = i;
      bestDistance = distance;
    }
    if (best < 0) return false;
    missBefore(best);
    const offsetMs = (hitTime - notes[best].time) * 1000;
    judge(best, judgeOffset(offsetMs, windows), offsetMs);
    missBefore(best + 1);
    return true;
  }

  function advance(now: number): void {
    const heard = now - shift - EXPIRY_SLACK_SECONDS;
    let last = firstOpen;
    while (last < notes.length && heard - notes[last].time > goodSeconds) last++;
    missBefore(last);
    finishIfDone();
  }

  function push(reading: PitchReading | null): void {
    if (finished) return;
    if (!reading) {
      runMidi = -1;
      return;
    }
    if (reading.midi !== runMidi) {
      runMidi = reading.midi;
      runStart = reading.time;
      runCount = 0;
      runUsed = false;
    }
    runCount++;
    if (!runUsed && runCount >= STABLE_READINGS) {
      if (tryHit(reading.hz)) runUsed = true;
      else if (reading.time - runStart > SETTLE_SECONDS) runUsed = true;
    }
    advance(reading.time);
  }

  function result(): GameResult {
    const done = judgments.filter((j): j is NoteJudgment => j !== undefined);
    const counts: Record<Judgment, number> = { perfect: 0, great: 0, good: 0, miss: 0 };
    for (const j of done) counts[j.judgment]++;
    return { judgments: done, counts, score: state.score, maxCombo: state.maxCombo };
  }

  if (notes.length === 0) finishIfDone();

  return {
    notes,
    get state() {
      return state;
    },
    get done() {
      return finished;
    },
    push,
    advance(now: number) {
      if (!finished) advance(now);
    },
    result,
  };
}
