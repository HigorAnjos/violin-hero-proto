import { describe, expect, it, vi } from 'vitest';
import { RAW_AUDIO, openMicrophone } from '../../src/audio/microphone';
import { FakeAudioContext } from '../setup/web-audio';

function trackContexts(configure: (ctx: FakeAudioContext) => void = () => {}) {
  const created: FakeAudioContext[] = [];
  vi.stubGlobal(
    'AudioContext',
    class extends FakeAudioContext {
      constructor(options?: AudioContextOptions) {
        super(options);
        configure(this);
        created.push(this);
      }
    },
  );
  return created;
}

function fakeStream(label = 'Mic interno') {
  const track = { label, stop: vi.fn() };
  return {
    track,
    stream: { getAudioTracks: () => [track], getTracks: () => [track] } as unknown as MediaStream,
  };
}

function stubBrowser(getUserMedia: (c: MediaStreamConstraints) => Promise<MediaStream>, secure = true) {
  vi.stubGlobal('isSecureContext', secure);
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn(getUserMedia) } });
}

describe('openMicrophone', () => {
  it('requests raw audio and returns a running context wired to the stream', async () => {
    const { stream, track } = fakeStream();
    stubBrowser(async () => stream);

    const mic = await openMicrophone();

    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({ audio: RAW_AUDIO, video: false });
    expect(mic.context.state).toBe('running');
    expect(mic.source.mediaStream).toBe(stream);
    expect(mic.label).toBe('Mic interno');

    await mic.stop();

    expect(track.stop).toHaveBeenCalled();
    expect(mic.context.state).toBe('closed');
  });

  it('refuses an insecure context before touching getUserMedia', async () => {
    stubBrowser(async () => fakeStream().stream, false);

    await expect(openMicrophone()).rejects.toMatchObject({ name: 'SecurityError' });
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
  });

  it('reports a browser without getUserMedia', async () => {
    vi.stubGlobal('isSecureContext', true);
    vi.stubGlobal('navigator', {});

    await expect(openMicrophone()).rejects.toMatchObject({ name: 'NotSupportedError' });
  });

  it('propagates a denied permission', async () => {
    stubBrowser(async () => {
      throw new DOMException('denied', 'NotAllowedError');
    });

    await expect(openMicrophone()).rejects.toMatchObject({ name: 'NotAllowedError' });
  });

  it('creates and resumes the context before awaiting getUserMedia, inside the user gesture', async () => {
    const resume = vi.fn(FakeAudioContext.prototype.resume);
    const created = trackContexts((ctx) => (ctx.resume = resume));
    let seenAtRequest: { contexts: number; resumes: number } | undefined;
    stubBrowser(async () => {
      seenAtRequest = { contexts: created.length, resumes: resume.mock.calls.length };
      return fakeStream().stream;
    });

    await openMicrophone();

    expect(seenAtRequest).toEqual({ contexts: 1, resumes: 1 });
  });

  it('closes the context when permission is denied', async () => {
    const created = trackContexts();
    stubBrowser(async () => {
      throw new DOMException('denied', 'NotAllowedError');
    });

    await expect(openMicrophone()).rejects.toMatchObject({ name: 'NotAllowedError' });
    expect(created[0].state).toBe('closed');
  });

  it('releases the tracks and the context when wiring fails after getUserMedia', async () => {
    const created = trackContexts((ctx) => {
      ctx.createMediaStreamSource = () => {
        throw new DOMException('boom', 'NotSupportedError');
      };
    });
    const { stream, track } = fakeStream();
    stubBrowser(async () => stream);

    await expect(openMicrophone()).rejects.toMatchObject({ name: 'NotSupportedError' });
    expect(track.stop).toHaveBeenCalled();
    expect(created[0].state).toBe('closed');
  });

  it('fails with InvalidStateError and releases the mic when audio stays suspended', async () => {
    const created = trackContexts((ctx) => (ctx.resume = async () => {}));
    const { stream, track } = fakeStream();
    stubBrowser(async () => stream);

    await expect(openMicrophone()).rejects.toMatchObject({ name: 'InvalidStateError' });
    expect(track.stop).toHaveBeenCalled();
    expect(created[0].state).toBe('closed');
  });
});
