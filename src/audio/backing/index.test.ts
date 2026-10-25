import { beforeEach, describe, expect, it, vi } from 'vitest';
import { midiToFrequency } from '../notes';
import { C_MAJOR_SCALE } from '../../game/song';
import { arrange } from './arrange';
import { DEFAULT_BACKING_VOLUME, KEEP_AUDIBLE_LEVEL, startBacking } from './index';
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
    constructor(public options: { context?: unknown } & Record<string, unknown>) {
      created.push(this);
    }
    connect(destination: unknown) {
      this.connectedTo = destination;
      return this;
    }
    dispose() {
      this.disposed = true;
    }
  }
  const created: FakeNode[] = [];
  const contexts: { options: { context: { onstatechange: unknown }; clockSource: string }; disposed: boolean }[] = [];
  class Context {
    disposed = false;
    constructor(public options: { context: { onstatechange: unknown }; clockSource: string }) {
      options.context.onstatechange = 'tone handler';
      contexts.push(this);
    }
    dispose() {
      this.disposed = true;
    }
  }
  class Gain extends FakeNode {
    gain: FakeParam;
    constructor(options: { gain: number }) {
      super(options);
      this.gain = new FakeParam(options.gain);
    }
  }
  const debug = { logger: console as { warn: (...args: unknown[]) => void }, warnedAtTrigger: [] as boolean[] };
  class Synth extends FakeNode {
    triggers: [number, number, number][] = [];
    triggerAttackRelease(frequency: number, duration: number, time: number) {
      this.triggers.push([frequency, duration, time]);
      debug.warnedAtTrigger.push(debug.logger === console);
    }
  }
  const setLogger = vi.fn((logger: typeof debug.logger) => {
    debug.logger = logger;
  });
  return { created, contexts, Context, Gain, Synth, setContext: vi.fn(), setLogger, debug };
});

vi.mock('tone/build/esm/core/context/Context.js', () => ({ Context: tone.Context }));
vi.mock('tone/build/esm/core/Global.js', () => ({ setContext: tone.setContext }));
vi.mock('tone/build/esm/core/context/Gain.js', () => ({ Gain: tone.Gain }));
vi.mock('tone/build/esm/instrument/Synth.js', () => ({ Synth: tone.Synth }));
vi.mock('tone/build/esm/core/util/Debug.js', () => ({ setLogger: tone.setLogger }));
vi.mock('tone', () => {
  throw new Error('the tone entry point builds a global Transport and a second AudioContext');
});

type FakeGain = InstanceType<typeof tone.Gain>;
type FakeSynth = InstanceType<typeof tone.Synth>;

const A4 = 442;
const BEAT = 60 / 90;

function constantSource() {
  return {
    offset: { value: 1 },
    connectedTo: undefined as unknown,
    started: false,
    stopped: false,
    connect(destination: unknown) {
      this.connectedTo = destination;
    },
    disconnect() {
      this.connectedTo = undefined;
    },
    start() {
      this.started = true;
    },
    stop() {
      this.stopped = true;
    },
  };
}

function context(currentTime = 0, state: AudioContextState = 'running') {
  const handler = () => undefined;
  const sources: ReturnType<typeof constantSource>[] = [];
  return {
    currentTime,
    state,
    destination: { name: 'destination' },
    onstatechange: handler,
    sources,
    createConstantSource() {
      const source = constantSource();
      sources.push(source);
      return source;
    },
  } as unknown as AudioContext & { sources: ReturnType<typeof constantSource>[] };
}

async function start(
  options: {
    startAt?: number;
    volume?: number;
    guide?: boolean;
    now?: number;
    output?: 'speaker' | 'headphones';
    state?: AudioContextState;
  } = {},
) {
  const ctx = context(options.now, options.state);
  const handle = await startBacking(ctx, C_MAJOR_SCALE, { startAt: 10, a4: A4, ...options });
  const [mute, master, guideGain] = tone.created.filter((n) => n instanceof tone.Gain) as FakeGain[];
  const synths = tone.created.filter((n) => n instanceof tone.Synth) as FakeSynth[];
  const [bass, pad0, pad1, pad2, guide] = synths;
  return { ctx, handle, mute, master, guideGain, bass, pad: [pad0, pad1, pad2], guide, synths };
}

beforeEach(() => {
  tone.created.length = 0;
  tone.contexts.length = 0;
  tone.setContext.mockClear();
  tone.setLogger.mockClear();
  tone.debug.logger = console;
  tone.debug.warnedAtTrigger.length = 0;
});

describe('startBacking', () => {
  it("wraps the game's own AudioContext with the offline clock, for every node, and keeps its statechange handler", async () => {
    const before = context().onstatechange;
    const { ctx, mute } = await start();
    expect(tone.contexts).toHaveLength(1);
    expect(tone.contexts[0].options).toMatchObject({ context: ctx, clockSource: 'offline' });
    expect(tone.created.every((n) => n.options.context === tone.contexts[0])).toBe(true);
    expect(tone.setContext).toHaveBeenCalledWith(tone.contexts[0]);
    expect(typeof ctx.onstatechange).toBe(typeof before);
    expect(mute.connectedTo).toBe(ctx.destination);
  });

  it('schedules bass, chords and guide on the song clock from startAt', async () => {
    const { bass, pad, guide } = await start();
    const arrangement = arrange(C_MAJOR_SCALE);
    expect(bass.triggers).toEqual(
      arrangement.bass.map((n) => [midiToFrequency(n.midi, A4), n.beats * BEAT, 10 + n.beat * BEAT]),
    );
    pad.forEach((voice, k) => {
      const tones = arrangement.pad.filter((_, i) => i % 3 === k);
      expect(voice.triggers).toEqual(tones.map((n) => [midiToFrequency(n.midi, A4), n.beats * BEAT, 10 + n.beat * BEAT]));
    });
    expect(guide.triggers.map(([, , time]) => time)).toEqual(C_MAJOR_SCALE.notes.map((n) => 10 + n.beat * BEAT));
  });

  it('pad voices each hold one chord tone: root, third and fifth', async () => {
    const { pad } = await start();
    const chords = arrange(C_MAJOR_SCALE).chords;
    pad.forEach((voice, k) => {
      voice.triggers.forEach(([frequency], i) => {
        const pc = Math.round(12 * Math.log2(frequency / A4) + 69) % 12;
        expect(pc).toBe(chords[i].pitchClasses[k]);
      });
    });
  });

  it('plays the headphones register when asked', async () => {
    const { pad, bass } = await start({ output: 'headphones' });
    const arrangement = arrange(C_MAJOR_SCALE, 'headphones');
    expect(pad[0].triggers[0][0]).toBeCloseTo(midiToFrequency(arrangement.pad[0].midi, A4));
    expect(bass.triggers[0][0]).toBeCloseTo(midiToFrequency(36, A4));
  });

  it('uses pure sines at the voice levels the leak tests rendered', async () => {
    const { bass, pad, guide } = await start();
    expect(bass.options).toMatchObject({ oscillator: { type: 'sine' }, volume: VOICES.bass.gainDb });
    for (const voice of pad) expect(voice.options).toMatchObject({ oscillator: { type: 'sine' }, volume: VOICES.pad.gainDb });
    expect(guide.options).toMatchObject({ envelope: { attack: VOICES.guide.attack, release: VOICES.guide.release } });
    expect(guide.connectedTo).toBeInstanceOf(tone.Gain);
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

  it("stop disposes every node once, never the Tone Context (it would close the game's AudioContext)", async () => {
    const { handle, master } = await start();
    await handle.stop();
    expect(tone.created.every((n) => n.disposed)).toBe(true);
    expect(tone.contexts[0].disposed).toBe(false);
    await expect(handle.stop()).resolves.toBeUndefined();
    handle.setVolume(0.9);
    expect(master.gain.ramps).toEqual([]);
  });

  it('makes the output audible right away, at −120 dBFS straight to the destination, so beat 1 is not the switch', async () => {
    const { ctx, handle } = await start({ startAt: 15 });
    const [source] = ctx.sources;
    expect(ctx.sources).toHaveLength(1);
    expect(source.offset.value).toBe(KEEP_AUDIBLE_LEVEL);
    expect(20 * Math.log10(KEEP_AUDIBLE_LEVEL)).toBeLessThanOrEqual(-120);
    expect(source.connectedTo).toBe(ctx.destination);
    expect(source.started).toBe(true);
    await handle.stop();
    expect(source.stopped).toBe(true);
    expect(source.connectedTo).toBeUndefined();
  });

  it('keeps the keep-audible source out of the mute, so disabling the orchestra does not bring the switch back', async () => {
    const { ctx, handle, mute } = await start();
    handle.setEnabled(false);
    expect(ctx.sources[0].connectedTo).not.toBe(mute);
  });

  it('silences the Tone "suspended" warnings only while scheduling on a paused context', async () => {
    await start({ state: 'suspended' });
    expect(tone.debug.warnedAtTrigger.length).toBeGreaterThan(0);
    expect(tone.debug.warnedAtTrigger.every((loud) => !loud)).toBe(true);
    expect(tone.debug.logger).toBe(console);
  });

  it('leaves the Tone logger alone on a running context', async () => {
    await start();
    expect(tone.setLogger).not.toHaveBeenCalled();
  });
});
