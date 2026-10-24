export interface Microphone {
  context: AudioContext;
  stream: MediaStream;
  source: MediaStreamAudioSourceNode;
  label: string;
  stop(): Promise<void>;
}

// Browser voice processing (AGC, noise suppression, echo cancellation) distorts level and pitch of a sustained note.
export const RAW_AUDIO: MediaTrackConstraints = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
};

export async function openMicrophone(): Promise<Microphone> {
  if (!globalThis.isSecureContext) {
    throw new DOMException('insecure context', 'SecurityError');
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new DOMException('getUserMedia unavailable', 'NotSupportedError');
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: RAW_AUDIO, video: false });
  const context = new AudioContext({ latencyHint: 'interactive' });
  await context.resume();
  const source = context.createMediaStreamSource(stream);
  return {
    context,
    stream,
    source,
    label: stream.getAudioTracks()[0]?.label ?? '',
    async stop() {
      stream.getTracks().forEach((t) => t.stop());
      source.disconnect();
      await context.close();
    },
  };
}

export function describeMicError(error: unknown): string {
  const name = error instanceof DOMException || error instanceof Error ? error.name : '';
  switch (name) {
    case 'SecurityError':
      return 'O microfone só funciona em HTTPS. Abra a página pelo endereço https://.';
    case 'NotAllowedError':
      return 'Permissão negada. Libere o microfone nas configurações do navegador e tente de novo.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'Nenhum microfone encontrado neste aparelho.';
    case 'NotReadableError':
    case 'AbortError':
      return 'O microfone está em uso por outro app. Feche-o e tente de novo.';
    case 'NotSupportedError':
      return 'Este navegador não dá acesso ao microfone.';
    default:
      return 'Não foi possível abrir o microfone.';
  }
}
