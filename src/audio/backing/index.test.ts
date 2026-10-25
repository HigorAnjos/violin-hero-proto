import { beforeEach, describe, expect, it, vi } from 'vitest';
import { midiToFrequency } from '../notes';
import { C_MAJOR_SCALE } from '../../game/song';
import { arrange } from './arrange';
import { DEFAULT_BACKING_VOLUME, startBacking } from './index';
import { VOICES } from './voices';

const tone = vi.hoisted(() => {
  class FakeParam {
    ramps: [number, number][] = [];
    constructor(public value: number) {}
    rampTo(value: number, seconds: number) {
      this.ramps.push([value, seconds]);
      this.value = value;
    }
  }
  class FakeNode {
    disposed = false;
    connectedTo: unknown;
    connect(destination: unknown) {
      this.connectedTo = destination;
      return this;
    }
    dispose() {
      this.disposed = true;
    }
  }
  const created: FakeNode[] = [];
  class Gain extends FakeNode {
    gain: FakeParam;
    constructor(value: number) {
      super();
      this.gain = new FakeParam(value);
      created.push(this);
    }
  }
  class Synth extends FakeNode {
    triggers: [number, number, number][] = [];
    constructor(public options: unknown) {
      super();
      created.push(this);
    }
    triggerAttackRelease(frequency: number, duration: number, time: number) {
      this.triggers.push([frequency, duration, time]);
    }
  }
  class PolySynth extends Synth {
    constructor(
      public voice: unknown,
      options: unknown,
    ) {
      super(options);
    }
  }
  return { created, Gain, Synth, PolySynth, setContext: vi.fn() };
});

vi.mock('tone', () => tone);

type FakeGain = InstanceType<typeof tone.Gain>;
type FakeSynth = InstanceType<typeof tone.Synth>;

const A4 = 442;
const BEAT = 60 / 90;

function context(currentTime = 0) {
  return { currentTime, destination: { name: 'destination' } } as unknown as BaseAudioContext;
}

async function start(options: { startAt?: number; volume?: number; guide?: boolean; now?: number } = {}) {
  const ctx = context(options.now);
  const handle = await startBacking(ctx, C_MAJOR_SCALE, { startAt: 10, a4: A4, ...options });
  const [mute, master, guideGain] = tone.created.filter((n) => n instanceof tone.Gain) as FakeGain[];
  const [bass, pad, guide] = tone.created.filter((n) => n instanceof tone.Synth) as FakeSynth[];
  return { ctx, handle, mute, master, guideGain, bass, pad, guide };
}

beforeEach(() => {
  tone.created.length = 0;
  tone.setContext.mockClear();
});

describe('startBacking', () => {
  it("runs Tone on the game's own AudioContext", async () => {
    const { ctx, mute } = await start();
    expect(tone.setContext).toHaveBeenCalledWith(ctx);
    expect(mute.connectedTo).toBe(ctx.destination);
  });

  it('schedules bass, chords and guide on the song clock from startAt', async () => {
    const { bass, pad, guide } = await start();
    const arrangement = arrange(C_MAJOR_SCALE);
    expect(bass.triggers).toEqual(
      arrangement.bass.map((n) => [midiToFrequency(n.midi, A4), n.beats * BEAT, 10 + n.beat * BEAT]),
    );
    expect(pad.triggers).toHaveLength(arrangement.pad.length);
    expect(pad.triggers[3]).toEqual([midiToFrequency(arrangement.pad[3].midi, A4), 2 * BEAT, 10 + 2 * BEAT]);
    expect(guide.triggers.map(([, , time]) => time)).toEqual(C_MAJOR_SCALE.notes.map((n) => 10 + n.beat * BEAT));
  });

  it('uses pure sines at the voice levels the leak tests rendered', async () => {
    const { bass, pad, guide } = await start();
    expect(bass.options).toMatchObject({ oscillator: { type: 'sine' }, volume: VOICES.bass.gainDb });
    expect(pad.options).toMatchObject({ oscillator: { type: 'sine' }, volume: VOICES.pad.gainDb });
    expect(guide.options).toMatchObject({ envelope: { attack: VOICES.guide.attack, release: VOICES.guide.release } });
    expect((pad as InstanceType<typeof tone.PolySynth>).voice).toBe(tone.Synth);
  });

  it('starts with the guide muted and the default volume', async () => {
    const { guideGain, master } = await start();
    expect(guideGain.gain.value).toBe(0);
    expect(master.gain.value).toBe(DEFAULT_BACKING_VOLUME);
  });

  it('honours guide and volume options', async () => {
    const { guideGain, master } = await start({ guide: true, volume: 0.2 });
    expect(guideGain.gain.value).toBe(1);
    expect(master.gain.value).toBe(0.2);
  });

  it('skips notes already over and starts a note in progress now', async () => {
    const { bass } = await start({ now: 10 + 3 * BEAT });
    expect(bass.triggers[0][2]).toBeCloseTo(10 + 3 * BEAT);
    expect(bass.triggers).toHaveLength(arrange(C_MAJOR_SCALE).bass.length - 1);
  });

  it('ramps volume (clamped to 0..1), enable and guide', async () => {
    const { handle, master, mute, guideGain } = await start();
    handle.setVolume(2);
    handle.setVolume(-1);
    handle.setEnabled(false);
    handle.setGuide(true);
    expect(master.gain.ramps).toEqual([
      [1, 0.05],
      [0, 0.05],
    ]);
    expect(mute.gain.ramps).toEqual([[0, 0.05]]);
    expect(guideGain.gain.ramps).toEqual([[1, 0.05]]);
  });

  it('stop disposes every node once and ignores later calls', async () => {
    const { handle, master } = await start();
    await handle.stop();
    expect(tone.created.every((n) => n.disposed)).toBe(true);
    await expect(handle.stop()).resolves.toBeUndefined();
    handle.setVolume(0.9);
    expect(master.gain.ramps).toEqual([]);
  });
});
