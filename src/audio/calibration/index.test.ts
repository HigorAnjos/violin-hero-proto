import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeAudioContext } from '../../../test/setup/web-audio';
import { CLICK_PEAK_SECONDS } from './click';
import { ATTACK_PROCESSOR_NAME } from './protocol';
import { LATENCY_STORAGE_KEY, type CalibrationEvent } from './types';

vi.mock('./worklet.ts?worker&url', () => ({ default: '/assets/attack-worklet.js' }));

class FakePort {
  onmessage: ((event: { data: unknown }) => void) | null = null;
}

class FakeNode {
  readonly connections = new Set<unknown>();
  constructor(readonly context: BaseAudioContext) {}
  connect<T>(destination: T): T {
    this.connections.add(destination);
    return destination;
  }
  disconnect(destination?: unknown): void {
    if (destination === undefined) this.connections.clear();
    else this.connections.delete(destination);
  }
}

class FakeWorkletNode extends FakeNode {
  static created: FakeWorkletNode[] = [];
  readonly port = new FakePort();
  constructor(
    context: BaseAudioContext,
    readonly name: string,
    readonly options: AudioWorkletNodeOptions,
  ) {
    super(context);
    FakeWorkletNode.created.push(this);
  }
}

class MemoryStorage {
  readonly map = new Map<string, string>();
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
}

function withWorklet<T extends object>(context: T, addModule = vi.fn(async (_url: string) => undefined)) {
  Object.assign(context, { audioWorklet: { addModule } });
  return addModule;
}

let startCalibration: typeof import('./index').startCalibration;
let storage: MemoryStorage;

beforeEach(async () => {
  vi.useFakeTimers();
  FakeWorkletNode.created = [];
  storage = new MemoryStorage();
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('AudioWorkletNode', FakeWorkletNode);
  vi.resetModules();
  ({ startCalibration } = await import('./index'));
});

afterEach(() => {
  vi.useRealTimers();
});

function setup() {
  const context = new FakeAudioContext();
  context.state = 'running';
  const addModule = withWorklet(context);
  const source = new FakeNode(context as unknown as BaseAudioContext);
  return { context, addModule, source, input: source as unknown as AudioNode };
}

/** Moves the context clock and lets the 20 ms poll see it. */
async function advanceTo(context: FakeAudioContext, time: number) {
  context.currentTime = time;
  await vi.advanceTimersByTimeAsync(40);
}

function postAttack(time: number) {
  FakeWorkletNode.created[0].port.onmessage!({ data: { time, hz: 442 } });
}

describe('startCalibration', () => {
  it('wires the source through the attack worklet and schedules count-in plus beats', async () => {
    const { context, addModule, source, input } = setup();
    const handle = await startCalibration(input, { bpm: 120, beats: 3, countIn: 2, startAt: 1 });

    expect(addModule).toHaveBeenCalledWith('/assets/attack-worklet.js');
    const [node] = FakeWorkletNode.created;
    expect(node.name).toBe(ATTACK_PROCESSOR_NAME);
    expect(node.options.processorOptions).toEqual({ a4: 442 });
    expect(source.connections.has(node)).toBe(true);
    expect(node.connections.has(context.destination)).toBe(true);
    expect(handle.schedule).toEqual({ countIn: [1, 1.5], beats: [2, 2.5, 3] });
    expect(context.sources.map((s) => s.startTime)).toEqual([1, 1.5, 2, 2.5, 3].map((t) => t - CLICK_PEAK_SECONDS));
    await handle.cancel();
  });

  it('reads the clock for the default start only after the worklet module loads', async () => {
    const { context, input } = setup();
    withWorklet(
      context,
      vi.fn(async () => {
        context.currentTime = 3;
      }),
    );
    const handle = await startCalibration(input);
    expect(handle.schedule.countIn[0]).toBeCloseTo(3.5);
    await handle.cancel();
  });

  it('emits clicks, attacks, beats and the result, then saves the compensation and tears down', async () => {
    const { context, source, input } = setup();
    const events: CalibrationEvent[] = [];
    const handle = await startCalibration(input, {
      bpm: 60,
      beats: 6,
      countIn: 1,
      startAt: 1,
      onEvent: (e) => events.push(e),
    });
    expect(events[0]).toEqual({ type: 'scheduled', schedule: handle.schedule });

    const delays = [0.1, 0.11, 0.09, 0.1, 0.12, 0.08];
    for (let i = 0; i < 6; i++) {
      await advanceTo(context, 2 + i);
      postAttack(2 + i + delays[i]);
    }
    await advanceTo(context, 7.4);
    expect(events.filter((e) => e.type === 'beat')).toHaveLength(5);
    await advanceTo(context, 8);

    const result = await handle.result;
    expect(result.ok).toBe(true);
    expect(result.beatsUsed).toBe(6);
    expect(result.delayMs).toBeCloseTo(100, 6);

    const types = events.map((e) => e.type);
    expect(types.filter((t) => t === 'click')).toHaveLength(7);
    expect(types.filter((t) => t === 'attack')).toHaveLength(6);
    expect(types.at(-1)).toBe('done');
    const clicks = events.filter((e) => e.type === 'click');
    expect(clicks[0]).toEqual({ type: 'click', index: 0, time: 1, countIn: true });
    expect(clicks[1]).toEqual({ type: 'click', index: 0, time: 2, countIn: false });

    const saved = JSON.parse(storage.getItem(LATENCY_STORAGE_KEY)!);
    expect(saved.delayMs).toBeCloseTo(100, 6);
    expect(typeof saved.measuredAt).toBe('string');
    expect(source.connections.size).toBe(0);
    expect(FakeWorkletNode.created[0].port.onmessage).toBeNull();
  });

  it('reports a beat only after its window closes, so a late attack still counts', async () => {
    const { context, input } = setup();
    const events: CalibrationEvent[] = [];
    await startCalibration(input, { beats: 2, countIn: 0, startAt: 1, onEvent: (e) => events.push(e) });
    await advanceTo(context, 1.29);
    postAttack(1.28);
    await advanceTo(context, 1.5);
    expect(events.some((e) => e.type === 'beat')).toBe(false);
    await advanceTo(context, 1.76);
    const beat = events.find((e) => e.type === 'beat');
    expect(beat).toMatchObject({ beat: { index: 0, status: 'hit' } });
  });

  it('does not save a session with too few beats, or when asked not to', async () => {
    for (const save of [true, false]) {
      const { context, input } = setup();
      FakeWorkletNode.created = [];
      const handle = await startCalibration(input, { beats: 8, countIn: 0, startAt: 1, save });
      const hits = save ? 3 : 8;
      for (let i = 0; i < hits; i++) postAttack(1 + i + 0.05);
      await advanceTo(context, 10);
      const result = await handle.result;
      expect(result.ok).toBe(!save);
      expect(storage.getItem(LATENCY_STORAGE_KEY)).toBeNull();
    }
  });

  it('cancel rejects the result with AbortError and silences pending clicks', async () => {
    const { context, source, input } = setup();
    const onEvent = vi.fn();
    const handle = await startCalibration(input, { startAt: 1, onEvent });
    await handle.cancel();
    await handle.cancel();
    await expect(handle.result).rejects.toMatchObject({ name: 'AbortError' });
    expect(context.sources.every((s) => s.connections.size === 0)).toBe(true);
    expect(source.connections.size).toBe(0);
    onEvent.mockClear();
    await advanceTo(context, 20);
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('creates and closes its own context for a MediaStream', async () => {
    const created: FakeAudioContext[] = [];
    vi.stubGlobal(
      'AudioContext',
      class extends FakeAudioContext {
        constructor(options?: AudioContextOptions) {
          super(options);
          withWorklet(this);
          created.push(this);
        }
      },
    );
    const handle = await startCalibration({} as MediaStream, { startAt: 1 });
    expect(handle.context).toBe(created[0]);
    await handle.cancel();
    expect(created[0].state).toBe('closed');
  });

  it('rejects and closes its own context when the browser keeps it suspended', async () => {
    const created: FakeAudioContext[] = [];
    vi.stubGlobal(
      'AudioContext',
      class extends FakeAudioContext {
        constructor(options?: AudioContextOptions) {
          super(options);
          withWorklet(this);
          created.push(this);
        }
        override async resume(): Promise<void> {}
      },
    );
    await expect(startCalibration({} as MediaStream)).rejects.toMatchObject({ name: 'InvalidStateError' });
    expect(created[0].state).toBe('closed');
    expect(FakeWorkletNode.created).toHaveLength(0);
  });

  it('rejects an invalid A4', async () => {
    const { input } = setup();
    await expect(startCalibration(input, { a4: 0 })).rejects.toThrow(RangeError);
  });
});
