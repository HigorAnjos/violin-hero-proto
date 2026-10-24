import { describe, expect, it, vi } from 'vitest';
import { RAW_AUDIO, openMicrophone } from '../../src/audio/microphone';

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
});
