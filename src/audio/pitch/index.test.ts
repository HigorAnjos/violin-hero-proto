import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeAudioContext } from '../../../test/setup/web-audio';
import { PROCESSOR_NAME } from './protocol';
import type { PitchReading } from './types';

vi.mock('./worklet.ts?worker&url', () => ({ default: '/assets/pitch-worklet.js' }));

class FakePort {
  readonly sent: unknown[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  postMessage(message: unknown): void {
    this.sent.push(message);
  }
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

function withWorklet<T extends object>(context: T, addModule = vi.fn(async (_url: string) => undefined)) {
  Object.assign(context, { audioWorklet: { addModule } });
  return addModule;
}

const reading: PitchReading = { time: 1, hz: 442, midi: 69, name: 'A4', solfege: 'Lá 4', cents: 0, clarity: 0.99, level: -12 };

let startPitch: typeof import('./index').startPitch;

beforeEach(async () => {
  FakeWorkletNode.created = [];
  vi.stubGlobal('AudioWorkletNode', FakeWorkletNode);
  vi.resetModules();
  ({ startPitch } = await import('./index'));
});

describe('startPitch', () => {
  it('wires an AudioNode source through the worklet to the destination', async () => {
    const context = new FakeAudioContext();
    const addModule = withWorklet(context);
    const source = new FakeNode(context as unknown as BaseAudioContext);

    const handle = await startPitch(source as unknown as AudioNode, () => {});

    expect(addModule).toHaveBeenCalledWith('/assets/pitch-worklet.js');
    const [node] = FakeWorkletNode.created;
    expect(node.name).toBe(PROCESSOR_NAME);
    expect(node.options.processorOptions).toEqual({ a4: 442, minClarity: 0.9 });
    expect(node.options.channelCount).toBe(1);
    expect(source.connections.has(node)).toBe(true);
    expect(node.connections.has(context.destination)).toBe(true);
    expect(handle.context).toBe(context);
    expect(handle.a4).toBe(442);
  });

  it('forwards readings and nulls to the listener', async () => {
    const context = new FakeAudioContext();
    withWorklet(context);
    const listener = vi.fn();
    await startPitch(new FakeNode(context as unknown as BaseAudioContext) as unknown as AudioNode, listener);
    const port = FakeWorkletNode.created[0].port;
    port.onmessage!({ data: reading });
    port.onmessage!({ data: null });
    expect(listener.mock.calls).toEqual([[reading], [null]]);
  });

  it('loads the module once per context', async () => {
    const context = new FakeAudioContext();
    const addModule = withWorklet(context);
    const source = new FakeNode(context as unknown as BaseAudioContext) as unknown as AudioNode;
    await startPitch(source, () => {});
    await startPitch(source, () => {});
    expect(addModule).toHaveBeenCalledTimes(1);
  });

  it('passes custom options and sends A4 changes to the processor', async () => {
    const context = new FakeAudioContext();
    withWorklet(context);
    const handle = await startPitch(
      new FakeNode(context as unknown as BaseAudioContext) as unknown as AudioNode,
      () => {},
      { a4: 440, minClarity: 0.8 },
    );
    const node = FakeWorkletNode.created[0];
    expect(node.options.processorOptions).toEqual({ a4: 440, minClarity: 0.8 });
    handle.setA4(443);
    expect(handle.a4).toBe(443);
    expect(node.port.sent).toEqual([{ type: 'a4', a4: 443 }]);
    expect(() => handle.setA4(0)).toThrow(RangeError);
  });

  it('rejects an invalid A4', async () => {
    const context = new FakeAudioContext();
    withWorklet(context);
    const source = new FakeNode(context as unknown as BaseAudioContext) as unknown as AudioNode;
    await expect(startPitch(source, () => {}, { a4: Number.NaN })).rejects.toThrow(RangeError);
  });

  it('stop disconnects without closing a context it does not own', async () => {
    const context = new FakeAudioContext();
    await context.resume();
    withWorklet(context);
    const source = new FakeNode(context as unknown as BaseAudioContext);
    const listener = vi.fn();
    const handle = await startPitch(source as unknown as AudioNode, listener);
    const node = FakeWorkletNode.created[0];

    await handle.stop();
    await handle.stop();

    expect(source.connections.size).toBe(0);
    expect(node.connections.size).toBe(0);
    expect(node.port.onmessage).toBeNull();
    expect(context.state).toBe('running');
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
    const stream = {} as MediaStream;

    const handle = await startPitch(stream, () => {});

    expect(created).toHaveLength(1);
    expect(handle.context).toBe(created[0]);
    expect(created[0].state).toBe('running');
    await handle.stop();
    expect(created[0].state).toBe('closed');
  });

  it('uses the given context for a MediaStream and leaves it open', async () => {
    const context = new FakeAudioContext();
    await context.resume();
    withWorklet(context);
    const handle = await startPitch({} as MediaStream, () => {}, { context: context as unknown as AudioContext });
    expect(handle.context).toBe(context);
    await handle.stop();
    expect(context.state).toBe('running');
  });

  it('closes its own context when the module fails to load', async () => {
    const created: FakeAudioContext[] = [];
    vi.stubGlobal(
      'AudioContext',
      class extends FakeAudioContext {
        constructor(options?: AudioContextOptions) {
          super(options);
          withWorklet(this, vi.fn(async () => Promise.reject(new Error('blocked'))));
          created.push(this);
        }
      },
    );
    await expect(startPitch({} as MediaStream, () => {})).rejects.toThrow('blocked');
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
    await expect(startPitch({} as MediaStream, () => {})).rejects.toMatchObject({ name: 'InvalidStateError' });
    expect(created[0].state).toBe('closed');
    expect(FakeWorkletNode.created).toHaveLength(0);
  });

  it('retries loading the module after a failure', async () => {
    const context = new FakeAudioContext();
    const addModule = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    withWorklet(context, addModule);
    const source = new FakeNode(context as unknown as BaseAudioContext) as unknown as AudioNode;
    await expect(startPitch(source, () => {})).rejects.toThrow('offline');
    await expect(startPitch(source, () => {})).resolves.toBeDefined();
    expect(addModule).toHaveBeenCalledTimes(2);
  });
});
