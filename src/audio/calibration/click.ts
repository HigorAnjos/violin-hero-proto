export const CLICK_HZ = 3520;
const SIGMA_SECONDS = 0.001;
/** The envelope peaks this long after the scheduled time; the click is 2× as long. */
export const CLICK_PEAK_SECONDS = 4 * SIGMA_SECONDS;

/**
 * A short A7 sine burst, three octaves above the open A, with a Gaussian envelope (σ 1 ms, ~8 ms in all). The Gaussian
 * keeps the spectrum within a few hundred Hz of 3520 Hz, so its leak into the microphone puts no energy in the A band
 * the onset detector listens to; a sharper edge splatters down to 442 Hz and fires onsets on the click.
 */
export function renderClick(sampleRate: number, peak = 0.7): Float32Array<ArrayBuffer> {
  const length = Math.round(2 * CLICK_PEAK_SECONDS * sampleRate);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    const envelope = Math.exp(-0.5 * ((t - CLICK_PEAK_SECONDS) / SIGMA_SECONDS) ** 2);
    out[i] = peak * envelope * Math.sin(2 * Math.PI * CLICK_HZ * t);
  }
  return out;
}

export function createClickBuffer(context: BaseAudioContext, peak?: number): AudioBuffer {
  const samples = renderClick(context.sampleRate, peak);
  const buffer = context.createBuffer(1, samples.length, context.sampleRate);
  buffer.copyToChannel(samples, 0);
  return buffer;
}

/**
 * Plays one click per time on the context clock, centred so its peak (the beat the player hears) lands on the time.
 * Returns a function that silences the ones still pending.
 */
export function scheduleClicks(
  context: BaseAudioContext,
  times: readonly number[],
  destination: AudioNode = context.destination,
): () => void {
  const buffer = createClickBuffer(context);
  const sources = times.map((time) => {
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(destination);
    source.start(Math.max(0, time - CLICK_PEAK_SECONDS));
    return source;
  });
  return () => {
    for (const source of sources) {
      try {
        source.stop();
      } catch {
        // stop() throws on a source that never started; nothing left to silence.
      }
      source.disconnect();
    }
  };
}
