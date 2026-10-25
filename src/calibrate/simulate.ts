import { CLICK_PEAK_SECONDS, createClickBuffer } from '../audio/calibration/click';
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

export function parseLeak(search: string): boolean {
  const raw = new URLSearchParams(search).get('vazamento');
  return raw === '1' || raw === 'sim';
}

export interface SimulatedString {
  /** Feed this to startCalibration in place of the microphone. */
  output: AudioNode;
  /** Bows the A at each onset; call after the click schedule is known. */
  bowAt(onsets: readonly number[]): void;
  /** Mixes the engine's own click, peaking at each time, into the output, as if the speaker leaked into the mic. */
  leakAt(times: readonly number[]): void;
  stop(): void;
}

/** A synthetic open A string; not routed to the speakers, like the tuner's ?sinal mode. */
export function simulateString(context: BaseAudioContext, hz: number): SimulatedString {
  const { real, imag } = harmonicWave();
  const oscillator = context.createOscillator();
  oscillator.setPeriodicWave(context.createPeriodicWave(real, imag));
  oscillator.frequency.value = hz;
  const envelope = context.createGain();
  envelope.gain.value = 0;
  const output = context.createGain();
  oscillator.connect(envelope).connect(output);
  oscillator.start();
  const clicks: AudioBufferSourceNode[] = [];
  return {
    output,
    bowAt(onsets) {
      for (const at of onsets) {
        for (const point of noteEnvelope(at)) {
          if (point.ramp) envelope.gain.linearRampToValueAtTime(point.value, point.time);
          else envelope.gain.setValueAtTime(point.value, point.time);
        }
      }
    },
    leakAt(times) {
      const buffer = createClickBuffer(context);
      for (const at of times) {
        const click = context.createBufferSource();
        click.buffer = buffer;
        click.connect(output);
        click.start(Math.max(0, at - CLICK_PEAK_SECONDS));
        clicks.push(click);
      }
    },
    stop() {
      oscillator.stop();
      oscillator.disconnect();
      envelope.disconnect();
      for (const click of clicks) click.disconnect();
      output.disconnect();
    },
  };
}
