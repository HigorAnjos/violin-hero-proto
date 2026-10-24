export class FakeAudioBuffer {
  readonly numberOfChannels: number;
  readonly length: number;
  readonly sampleRate: number;
  private readonly channels: Float32Array[];

  constructor(options: { numberOfChannels?: number; length: number; sampleRate: number }) {
    this.numberOfChannels = options.numberOfChannels ?? 1;
    this.length = options.length;
    this.sampleRate = options.sampleRate;
    this.channels = Array.from({ length: this.numberOfChannels }, () => new Float32Array(this.length));
  }

  get duration(): number {
    return this.length / this.sampleRate;
  }

  getChannelData(channel: number): Float32Array {
    const data = this.channels[channel];
    if (!data) throw new RangeError(`channel ${channel} out of range`);
    return data;
  }

  copyToChannel(source: Float32Array, channel: number, offset = 0): void {
    this.getChannelData(channel).set(source.subarray(0, this.length - offset), offset);
  }

  copyFromChannel(destination: Float32Array, channel: number, offset = 0): void {
    destination.set(this.getChannelData(channel).subarray(offset, offset + destination.length));
  }
}

class FakeAudioNode {
  readonly connections = new Set<unknown>();
  connect<T>(destination: T): T {
    this.connections.add(destination);
    return destination;
  }
  disconnect(): void {
    this.connections.clear();
  }
}

export class FakeBufferSourceNode extends FakeAudioNode {
  buffer: FakeAudioBuffer | null = null;
  startTime: number | null = null;
  start(when = 0): void {
    this.startTime = when;
  }
  stop(): void {}
}

export class FakeMediaStreamSourceNode extends FakeAudioNode {
  constructor(readonly mediaStream: MediaStream) {
    super();
  }
}

abstract class FakeBaseAudioContext {
  readonly destination = new FakeAudioNode();
  readonly sources: FakeBufferSourceNode[] = [];
  state: AudioContextState = 'suspended';
  currentTime = 0;

  constructor(readonly sampleRate: number) {}

  createBuffer(numberOfChannels: number, length: number, sampleRate: number): FakeAudioBuffer {
    return new FakeAudioBuffer({ numberOfChannels, length, sampleRate });
  }

  createBufferSource(): FakeBufferSourceNode {
    const node = new FakeBufferSourceNode();
    this.sources.push(node);
    return node;
  }
}

export class FakeAudioContext extends FakeBaseAudioContext {
  readonly latencyHint: AudioContextOptions['latencyHint'];

  constructor(options: AudioContextOptions = {}) {
    super(options.sampleRate ?? 48000);
    this.latencyHint = options.latencyHint;
  }

  async resume(): Promise<void> {
    if (this.state !== 'closed') this.state = 'running';
  }

  async suspend(): Promise<void> {
    if (this.state !== 'closed') this.state = 'suspended';
  }

  async close(): Promise<void> {
    this.state = 'closed';
  }

  createMediaStreamSource(stream: MediaStream): FakeMediaStreamSourceNode {
    return new FakeMediaStreamSourceNode(stream);
  }
}

// Only mixes started buffer sources wired straight to the destination; enough to feed generated audio through an offline render.
export class FakeOfflineAudioContext extends FakeBaseAudioContext {
  readonly length: number;
  readonly numberOfChannels: number;

  constructor(options: OfflineAudioContextOptions);
  constructor(numberOfChannels: number, length: number, sampleRate: number);
  constructor(a: OfflineAudioContextOptions | number, length?: number, sampleRate?: number) {
    const options = typeof a === 'number' ? { numberOfChannels: a, length: length!, sampleRate: sampleRate! } : a;
    super(options.sampleRate);
    this.length = options.length;
    this.numberOfChannels = options.numberOfChannels ?? 1;
  }

  async startRendering(): Promise<FakeAudioBuffer> {
    this.state = 'running';
    const out = new FakeAudioBuffer({ numberOfChannels: this.numberOfChannels, length: this.length, sampleRate: this.sampleRate });
    for (const source of this.sources) {
      if (source.startTime === null || !source.buffer || !source.connections.has(this.destination)) continue;
      const offset = Math.round(source.startTime * this.sampleRate);
      for (let ch = 0; ch < out.numberOfChannels; ch++) {
        const input = source.buffer.getChannelData(Math.min(ch, source.buffer.numberOfChannels - 1));
        const output = out.getChannelData(ch);
        for (let i = 0; i < input.length && offset + i < output.length; i++) output[offset + i] += input[i];
      }
    }
    this.state = 'closed';
    this.currentTime = this.length / this.sampleRate;
    return out;
  }
}

const g = globalThis as Record<string, unknown>;
g.AudioBuffer ??= FakeAudioBuffer;
g.AudioContext ??= FakeAudioContext;
g.OfflineAudioContext ??= FakeOfflineAudioContext;
