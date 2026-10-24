import { describe, expect, it } from 'vitest';
import { sine } from '../../src/audio/testing/synth';
import { FakeAudioContext, FakeOfflineAudioContext } from './web-audio';

describe('web audio test doubles', () => {
  it('are installed as globals in the node environment', () => {
    expect(globalThis.AudioContext).toBe(FakeAudioContext);
    expect(globalThis.OfflineAudioContext).toBe(FakeOfflineAudioContext);
  });

  it('renders a generated signal through an offline context at its start offset', async () => {
    const signal = sine(442, 0.1);
    const ctx = new OfflineAudioContext(1, 48000 * 0.2, 48000);
    const buffer = ctx.createBuffer(1, signal.length, 48000);
    buffer.getChannelData(0).set(signal);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start(0.05);

    const rendered = (await ctx.startRendering()).getChannelData(0);

    expect(rendered).toHaveLength(9600);
    expect(Array.from(rendered.subarray(0, 2400)).every((v) => v === 0)).toBe(true);
    expect(rendered.subarray(2400, 2400 + signal.length)).toEqual(signal);
  });

  it('ignores sources that were never started or connected', async () => {
    const ctx = new OfflineAudioContext({ numberOfChannels: 1, length: 100, sampleRate: 48000 });
    const loose = ctx.createBufferSource();
    loose.buffer = ctx.createBuffer(1, 100, 48000);
    loose.buffer.getChannelData(0).fill(1);
    loose.start();
    const idle = ctx.createBufferSource();
    idle.buffer = loose.buffer;
    idle.connect(ctx.destination);

    const rendered = (await ctx.startRendering()).getChannelData(0);

    expect(Array.from(rendered).every((v) => v === 0)).toBe(true);
  });

  it('tracks realtime context state', async () => {
    const ctx = new AudioContext();
    expect(ctx.state).toBe('suspended');
    await ctx.resume();
    expect(ctx.state).toBe('running');
    await ctx.close();
    await ctx.resume();
    expect(ctx.state).toBe('closed');
  });
});
