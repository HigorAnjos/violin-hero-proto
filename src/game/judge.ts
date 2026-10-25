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
/**
 * Notes expire this much after their window: readings reach the main thread by postMessage and a confirmation takes
 * ~30 ms, so a phone's main-thread jank must not turn an edge hit into a miss.
 */
export const EXPIRY_SLACK_SECONDS = 0.1;
/** Time constant of the slow level the hop level is compared with; tremor and vibrato ride on it. */
export const LEVEL_SLOW_SECONDS = 0.15;
/** A hop this far below the slow level arms a bow change; a ±3 dB bow tremor never gets there. */
export const BOW_DIP_DB = 4;
/** Rising this far above the bottom of the dip, with the same pitch, is a new attack (re-bowed repeated note). */
export const BOW_RISE_DB = 4;
/**
 * A null only separates two attacks of the same note when readings stopped at least this long; a scratchy bow makes
 * clarity drop out for up to ~50 ms in the middle of a sustained note, and that is not a new attack. Shorter silences
 * still count through the level: the last hop before the dropout already shows the dip.
 */
export const NEW_ATTACK_GAP_SECONDS = 0.06;
/**
 * Bow changes are only looked for this many readings (~120 ms, about one tremor cycle) after an attack; until then the
 * slow level is a plain running mean, so it does not start on a tremor crest. The shortest note of the song is 333 ms.
 */
export const LEVEL_WARMUP_READINGS = 12;
const LEVEL_ALPHA = 1 - Math.exp(-0.01 / LEVEL_SLOW_SECONDS);

export interface CreateJudgeOptions extends JudgeOptions {
  detectionLagSeconds?: number;
  onEvent?: GameListener;
}

/**
 * Each attack is a run of readings of one note, ended by a gap in the readings, a note change or a bow change (a dip in
 * level and back, same pitch); it hits at most one note: the earliest unjudged one whose window contains the attack
 * and whose pitch matches within the tolerance. Players run late, so the earliest open note is the generous choice
 * when a short note and its repetition both qualify. Hitting a note misses every earlier unjudged one, so judgments
 * come out in note order.
 */
export function createJudge(notes: readonly TimedNote[], options: CreateJudgeOptions = {}): Judge {
  const windows = options.windows ?? DEFAULT_WINDOWS;
  const tolerance = options.toleranceCents ?? DEFAULT_TOLERANCE_CENTS;
  const lag = options.detectionLagSeconds ?? DETECTION_LAG_SECONDS;
  const compensation = options.compensationSeconds ?? 0;
  const onEvent = options.onEvent;
  const targets = notes.map((note) => (options.a4 ? midiToFrequency(note.midi, options.a4) : note.frequency));
  const judgments: (NoteJudgment | undefined)[] = new Array(notes.length);
  const goodSeconds = windows.good / 1000;

  let state: ScoreState = initialScore();
  let firstOpen = 0;
  let finished = false;

  let runMidi = -1;
  let attackTime = 0;
  let runCount = 0;
  let runUsed = false;
  let slowLevel = 0;
  let dipping = false;
  let dipBottom = 0;
  let levelCount = 0;
  let candidateMidi = -1;
  let candidateStart = 0;
  let candidateCount = 0;
  let lastReading = -Infinity;
  let interrupted = false;

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
    const hitTime = attackTime - compensation;
    for (let i = firstOpen; i < notes.length; i++) {
      if (judgments[i]) continue;
      if (notes[i].time - hitTime > goodSeconds) break;
      if (Math.abs(hitTime - notes[i].time) > goodSeconds) continue;
      if (Math.abs(centsBetween(hz, targets[i])) > tolerance) continue;
      missBefore(i);
      const offsetMs = (hitTime - notes[i].time) * 1000;
      judge(i, judgeOffset(offsetMs, windows), offsetMs);
      missBefore(i + 1);
      return true;
    }
    return false;
  }

  function advance(now: number): void {
    const heard = now - lag - compensation - EXPIRY_SLACK_SECONDS;
    let last = firstOpen;
    while (last < notes.length && heard - notes[last].time > goodSeconds) last++;
    missBefore(last);
    finishIfDone();
  }

  function startAttack(time: number, count: number, level: number): void {
    attackTime = time;
    runCount = count;
    runUsed = false;
    slowLevel = level;
    levelCount = 1;
    dipping = false;
  }

  /** True when this reading ends a bow change: level fell well below its slow average and has come back up. */
  function bowChanged(level: number): boolean {
    levelCount++;
    if (!dipping) {
      if (levelCount > LEVEL_WARMUP_READINGS && level < slowLevel - BOW_DIP_DB) {
        dipping = true;
        dipBottom = level;
        return false;
      }
      slowLevel += Math.max(LEVEL_ALPHA, 1 / levelCount) * (level - slowLevel);
      return false;
    }
    dipBottom = Math.min(dipBottom, level);
    return level - dipBottom >= BOW_RISE_DB;
  }

  function push(reading: PitchReading | null): void {
    if (finished) return;
    if (!reading) {
      interrupted = true;
      return;
    }
    const gap = reading.time - lastReading;
    lastReading = reading.time;
    const resumed = interrupted;
    interrupted = false;
    if (resumed && gap >= NEW_ATTACK_GAP_SECONDS) {
      runMidi = reading.midi;
      candidateCount = 0;
      startAttack(reading.time - lag, 1, reading.level);
    } else if (reading.midi !== runMidi) {
      // A one- or two-reading blip to a neighbour (noise, hysteresis) is neither a note change nor a new attack.
      if (reading.midi !== candidateMidi || candidateCount === 0) {
        candidateMidi = reading.midi;
        candidateStart = reading.time;
        candidateCount = 0;
      }
      if (++candidateCount < STABLE_READINGS) {
        advance(reading.time);
        return;
      }
      runMidi = reading.midi;
      candidateCount = 0;
      startAttack(candidateStart - lag, STABLE_READINGS, reading.level);
    } else if (bowChanged(reading.level)) {
      candidateCount = 0;
      // The hop level has no window lag: the rise happened within the last hop.
      startAttack(reading.time - 0.005, STABLE_READINGS, reading.level);
    } else {
      candidateCount = 0;
      runCount++;
    }
    if (!runUsed && runCount >= STABLE_READINGS) {
      if (tryHit(reading.hz)) runUsed = true;
      else if (reading.time - (attackTime + lag) > SETTLE_SECONDS) runUsed = true;
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
