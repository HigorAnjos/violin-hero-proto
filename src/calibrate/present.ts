import type { BeatResult, BeatStatus, CalibrationResult, ClickSchedule, Compensation } from '../audio/calibration/types';

export const MIN_SIMULATE_MS = 0;
export const MAX_SIMULATE_MS = 1000;
/** How long the visual pulse stays lit after each click, in seconds. */
export const PULSE_SECONDS = 0.15;

export function parseSimulateMs(search: string): number | null {
  const raw = new URLSearchParams(search).get('simular');
  if (raw == null || raw.trim() === '') return null;
  const value = Number(raw.trim().replace(',', '.'));
  if (!Number.isFinite(value) || value < MIN_SIMULATE_MS || value > MAX_SIMULATE_MS) return null;
  return value;
}

export function formatMs(ms: number): string {
  const rounded = Math.round(ms) || 0;
  return rounded < 0 ? `−${-rounded} ms` : `${rounded} ms`;
}

export type MarkerState = 'pending' | BeatStatus;

export interface MarkerView {
  state: MarkerState;
  text: string;
  label: string;
}

export function markerView(index: number, beat: BeatResult | undefined): MarkerView {
  const n = index + 1;
  if (!beat) return { state: 'pending', text: String(n), label: `Batida ${n}: aguardando` };
  if (beat.status === 'missed' || beat.delayMs == null) {
    return { state: 'missed', text: '—', label: `Batida ${n}: não detectada` };
  }
  const ms = formatMs(beat.delayMs);
  if (beat.status === 'outlier') return { state: 'outlier', text: ms, label: `Batida ${n}: ${ms}, descartada` };
  return { state: 'hit', text: ms, label: `Batida ${n}: ${ms}` };
}

export type PulsePhase =
  | { kind: 'waiting' }
  | { kind: 'count-in'; index: number; remaining: number; lit: boolean }
  | { kind: 'beat'; index: number; lit: boolean }
  | { kind: 'finished' };

/** Where the player is in the click track at AudioContext output time `now`. */
export function pulsePhase(now: number, schedule: ClickSchedule, pulseSeconds = PULSE_SECONDS): PulsePhase {
  const all = [...schedule.countIn, ...schedule.beats];
  let last = -1;
  for (let i = 0; i < all.length && all[i] <= now; i++) last = i;
  if (last < 0) return { kind: 'waiting' };
  const lit = now - all[last] < pulseSeconds;
  const countIn = schedule.countIn.length;
  if (last < countIn) return { kind: 'count-in', index: last, remaining: countIn - last, lit };
  const index = last - countIn;
  const interval = all.length > 1 ? all[all.length - 1] - all[all.length - 2] : pulseSeconds;
  if (index === schedule.beats.length - 1 && now - all[last] >= interval) return { kind: 'finished' };
  return { kind: 'beat', index, lit };
}

export function pulseText(phase: PulsePhase, beats: number): string {
  switch (phase.kind) {
    case 'waiting':
      return 'Prepare o arco…';
    case 'count-in':
      return String(phase.remaining);
    case 'beat':
      return `${phase.index + 1}/${beats}`;
    case 'finished':
      return 'Pronto';
  }
}

export interface ResultView {
  delay: string;
  spread: string;
  summary: string;
  canSave: boolean;
}

export function resultView(result: CalibrationResult): ResultView {
  const total = result.beats.length;
  if (!result.ok || !Number.isFinite(result.delayMs)) {
    return {
      delay: '—',
      spread: '—',
      summary: `Só ${result.beatsUsed} de ${total} batidas valeram. Toque a corda Lá solta junto com cada clique e refaça.`,
      canSave: false,
    };
  }
  return {
    delay: formatMs(result.delayMs),
    spread: `± ${formatMs(result.spreadMs)}`,
    summary: `${result.beatsUsed} de ${total} batidas usadas.`,
    canSave: true,
  };
}

export function toCompensation(result: CalibrationResult, now: Date): Compensation {
  return { delayMs: result.delayMs, spreadMs: result.spreadMs, measuredAt: now.toISOString() };
}

const dateFormat = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'America/Sao_Paulo',
});

export function savedText(saved: Compensation | null): string {
  if (!saved) return 'Nenhuma calibração salva. O jogo usa 0 ms.';
  const when = Date.parse(saved.measuredAt);
  const date = Number.isFinite(when) ? ` em ${dateFormat.format(when)}` : '';
  return `Salvo: ${formatMs(saved.delayMs)} (± ${formatMs(saved.spreadMs)})${date}.`;
}

export interface OutputStamp {
  contextTime: number;
  performanceTime: number;
}

/** Converts performance.now() into the AudioContext time the speaker is playing, so the pulse lights with the click. */
export function outputContextTime(performanceNow: number, stamp: OutputStamp): number {
  return stamp.contextTime + (performanceNow - stamp.performanceTime) / 1000;
}
