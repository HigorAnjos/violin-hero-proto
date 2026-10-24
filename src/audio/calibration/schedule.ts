import { DEFAULT_BEATS, DEFAULT_BPM, DEFAULT_COUNT_IN, type ClickSchedule } from './types';

export interface ScheduleOptions {
  bpm?: number;
  beats?: number;
  countIn?: number;
}

export function clickSchedule(startAt: number, options: ScheduleOptions = {}): ClickSchedule {
  const { bpm = DEFAULT_BPM, beats = DEFAULT_BEATS, countIn = DEFAULT_COUNT_IN } = options;
  if (!(bpm > 0) || !Number.isFinite(bpm)) throw new RangeError(`invalid bpm: ${bpm}`);
  if (!Number.isInteger(beats) || beats < 1) throw new RangeError(`invalid beats: ${beats}`);
  if (!Number.isInteger(countIn) || countIn < 0) throw new RangeError(`invalid countIn: ${countIn}`);
  const interval = 60 / bpm;
  const at = (i: number) => startAt + i * interval;
  return {
    countIn: Array.from({ length: countIn }, (_, i) => at(i)),
    beats: Array.from({ length: beats }, (_, i) => at(countIn + i)),
  };
}
