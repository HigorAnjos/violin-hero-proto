import { describe, expect, it } from 'vitest';
import { RAW_AUDIO, describeMicError } from './microphone';

describe('describeMicError', () => {
  it.each([
    ['SecurityError', 'HTTPS'],
    ['NotAllowedError', 'Permissão negada'],
    ['NotFoundError', 'Nenhum microfone'],
    ['OverconstrainedError', 'Nenhum microfone'],
    ['NotReadableError', 'em uso'],
    ['AbortError', 'em uso'],
    ['InvalidStateError', 'Toque em Ativar de novo'],
    ['NotSupportedError', 'navegador'],
  ])('explains %s', (name, expected) => {
    expect(describeMicError(new DOMException('x', name))).toContain(expected);
  });

  it('falls back for unknown errors', () => {
    expect(describeMicError(new Error('boom'))).toBe('Não foi possível abrir o microfone.');
    expect(describeMicError('nope')).toBe('Não foi possível abrir o microfone.');
  });
});

describe('RAW_AUDIO', () => {
  it('disables browser voice processing', () => {
    expect(RAW_AUDIO).toEqual({ echoCancellation: false, noiseSuppression: false, autoGainControl: false });
  });
});
