export const DEFAULT_SAMPLE_RATE = 48000;
export const VIOLIN_HARMONICS: readonly number[] = [1, 0.6, 0.45, 0.3, 0.2, 0.12];

export interface Vibrato {
  depthCents: number;
  rateHz: number;
}

export interface ToneOptions {
  frequency: number;
  durationSec: number;
  sampleRate?: number;
  harmonics?: readonly number[];
  vibrato?: Vibrato;
  peak?: number;
  noise?: number;
  seed?: number;
}

export function tone(options: ToneOptions): Float32Array {
  const {
    frequency,
    durationSec,
    sampleRate = DEFAULT_SAMPLE_RATE,
    harmonics = VIOLIN_HARMONICS,
    vibrato,
    peak = 0.8,
    noise = 0,
    seed = 1,
  } = options;
  if (!(frequency > 0) || !(durationSec > 0) || !(sampleRate > 0)) {
    throw new RangeError('frequency, durationSec and sampleRate must be positive');
  }

  const length = Math.round(durationSec * sampleRate);
  const out = new Float32Array(length);
  const nyquist = sampleRate / 2;
  let phase = 0;

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    const f = vibrato
      ? frequency * 2 ** ((vibrato.depthCents * Math.sin(2 * Math.PI * vibrato.rateHz * t)) / 1200)
      : frequency;
    let sample = 0;
    for (let k = 0; k < harmonics.length; k++) {
      // Harmonics above Nyquist would alias into false low partials and fool the detector.
      if ((k + 1) * f >= nyquist) break;
      sample += harmonics[k] * Math.sin((k + 1) * phase);
    }
    out[i] = sample;
    phase += (2 * Math.PI * f) / sampleRate;
  }

  normalize(out, peak);
  if (noise > 0) addInPlace(out, whiteNoise(length, noise, seed));
  return out;
}

export function sine(frequency: number, durationSec: number, sampleRate = DEFAULT_SAMPLE_RATE): Float32Array {
  return tone({ frequency, durationSec, sampleRate, harmonics: [1] });
}

export function whiteNoise(length: number, amplitude: number, seed = 1): Float32Array {
  const random = mulberry32(seed);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) out[i] = amplitude * (random() * 2 - 1);
  return out;
}

export function silence(durationSec: number, sampleRate = DEFAULT_SAMPLE_RATE): Float32Array {
  return new Float32Array(Math.round(durationSec * sampleRate));
}

export function concat(...parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function frames(signal: Float32Array, size: number, hop: number): Float32Array[] {
  const result: Float32Array[] = [];
  for (let start = 0; start + size <= signal.length; start += hop) {
    result.push(signal.subarray(start, start + size));
  }
  return result;
}

function normalize(buffer: Float32Array, peak: number): void {
  let max = 0;
  for (const v of buffer) max = Math.max(max, Math.abs(v));
  if (max === 0) return;
  const gain = peak / max;
  for (let i = 0; i < buffer.length; i++) buffer[i] *= gain;
}

function addInPlace(target: Float32Array, source: Float32Array): void {
  for (let i = 0; i < target.length; i++) target[i] += source[i];
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
