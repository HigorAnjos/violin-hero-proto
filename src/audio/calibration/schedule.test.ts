import { describe, expect, it } from 'vitest';
import { clickSchedule } from './schedule';

describe('clickSchedule', () => {
  it('places count-in then beats one interval apart', () => {
    const schedule = clickSchedule(2, { bpm: 120, beats: 3, countIn: 2 });
    expect(schedule.countIn).toEqual([2, 2.5]);
    expect(schedule.beats).toEqual([3, 3.5, 4]);
  });

  it('defaults to 4 count-in clicks and 8 beats at 60 bpm', () => {
    const schedule = clickSchedule(0);
    expect(schedule.countIn).toEqual([0, 1, 2, 3]);
    expect(schedule.beats).toHaveLength(8);
    expect(schedule.beats[0]).toBe(4);
    expect(schedule.beats[7]).toBe(11);
  });

  it('rejects invalid settings', () => {
    expect(() => clickSchedule(0, { bpm: 0 })).toThrow(RangeError);
    expect(() => clickSchedule(0, { beats: 0 })).toThrow(RangeError);
    expect(() => clickSchedule(0, { countIn: -1 })).toThrow(RangeError);
    expect(() => clickSchedule(0, { beats: 2.5 })).toThrow(RangeError);
  });
});
