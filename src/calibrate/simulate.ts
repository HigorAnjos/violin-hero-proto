import { harmonicWave } from '../tuner/test-signal';

export interface EnvelopeOptions {
  attack?: number;
  hold?: number;
  release?: number;
  peak?: number;
}

export interface EnvelopePoint {
  time: number;
  value: number;
  ramp: boolean;
}

export const NOTE_ENVELOPE: Required<EnvelopeOptions> = { attack: 0.015, hold: 0.4, release: 0.08, peak: 0.8 };

/** Gain automation for one bowed note starting at `at`; `ramp` points are reached linearly from the previous one. */
export function noteEnvelope(at: number, options: EnvelopeOptions = {}): EnvelopePoint[] {
  const { attack, hold, release, peak } = { ...NOTE_ENVELOPE, ...options };
  return [
    { time: at, value: 0, ramp: false },
    { time: at + attack, value: peak, ramp: true },
    { time: at + attack + hold, value: peak, ramp: true },
    { time: at + attack + hold + release, value: 0, ramp: true },
  ];
}

export function simulatedOnsets(beats: readonly number[], delayMs: number): number[] {
  return beats.map((t) => t + delayMs / 1000);
}

export interface SimulatedString {
  /** Feed this to startCalibration in place of the microphone. */
  output: AudioNode;
  stop(): void;
}

/** A synthetic open A string bowed at each onset; not routed to the speakers, like the tuner's ?sinal mode. */
export function simulateString(context: BaseAudioContext, hz: number, onsets: readonly number[]): SimulatedString {
  const { real, imag } = harmonicWave();
  const oscillator = context.createOscillator();
  oscillator.setPeriodicWave(context.createPeriodicWave(real, imag));
  oscillator.frequency.value = hz;
  const gain = context.createGain();
  gain.gain.value = 0;
  for (const at of onsets) {
    for (const point of noteEnvelope(at)) {
      if (point.ramp) gain.gain.linearRampToValueAtTime(point.value, point.time);
      else gain.gain.setValueAtTime(point.value, point.time);
    }
  }
  oscillator.connect(gain);
  oscillator.start();
  return {
    output: gain,
    stop() {
      oscillator.stop();
      oscillator.disconnect();
      gain.disconnect();
    },
  };
}
