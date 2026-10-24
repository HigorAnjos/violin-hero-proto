import { VIOLIN_HARMONICS } from '../audio/testing/synth';

export function harmonicWave(harmonics: readonly number[] = VIOLIN_HARMONICS): { real: Float32Array; imag: Float32Array } {
  const real = new Float32Array(harmonics.length + 1);
  const imag = new Float32Array(harmonics.length + 1);
  imag.set(harmonics, 1);
  return { real, imag };
}

export function createTestSignal(context: BaseAudioContext, hz: number): OscillatorNode {
  const { real, imag } = harmonicWave();
  const oscillator = context.createOscillator();
  oscillator.setPeriodicWave(context.createPeriodicWave(real, imag));
  oscillator.frequency.value = hz;
  oscillator.start();
  return oscillator;
}
