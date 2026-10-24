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
  // iOS Safari only unlocks audio for a context created and resumed inside the user gesture, i.e. before the first await.
  const context = new AudioContext({ latencyHint: 'interactive' });
  const resumed = context.resume();
  let stream: MediaStream | undefined;
  let source: MediaStreamAudioSourceNode;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: RAW_AUDIO, video: false });
    await resumed;
    if (context.state !== 'running') {
      throw new DOMException(`audio context is ${context.state}`, 'InvalidStateError');
    }
    source = context.createMediaStreamSource(stream);
  } catch (error) {
    stream?.getTracks().forEach((t) => t.stop());
    await context.close().catch(() => undefined);
    throw error;
  }
  const live = stream;
  return {
    context,
    stream: live,
    source,
    label: live.getAudioTracks()[0]?.label ?? '',
    async stop() {
      live.getTracks().forEach((t) => t.stop());
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
    case 'InvalidStateError':
      return 'O navegador não liberou o áudio. Toque em Ativar de novo.';
    case 'NotSupportedError':
      return 'Este navegador não dá acesso ao microfone.';
    default:
      return 'Não foi possível abrir o microfone.';
  }
}
