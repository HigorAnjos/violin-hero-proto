export const CENTS_RANGE = 50;
export const IN_TUNE_CENTS = 5;
export const CLOSE_CENTS = 15;

export type TuneState = 'in-tune' | 'close' | 'off';

export const STATE_COLORS: Record<TuneState, string> = {
  'in-tune': '#4cc38a',
  close: '#e0a33a',
  off: '#e5484d',
};

export function clampCents(cents: number): number {
  return Math.max(-CENTS_RANGE, Math.min(CENTS_RANGE, cents));
}

export function needleFraction(cents: number): number {
  return (clampCents(cents) + CENTS_RANGE) / (2 * CENTS_RANGE);
}

export function tuneState(cents: number): TuneState {
  const off = Math.abs(cents);
  if (off <= IN_TUNE_CENTS) return 'in-tune';
  if (off <= CLOSE_CENTS) return 'close';
  return 'off';
}

export function tuneHint(cents: number): string {
  if (tuneState(cents) === 'in-tune') return 'Afinado';
  return cents < 0 ? 'Baixo · suba' : 'Alto · desça';
}

const hzFormat = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function formatHz(hz: number): string {
  return `${hzFormat.format(hz)} Hz`;
}

export function formatCents(cents: number): string {
  const rounded = Math.round(cents);
  if (rounded === 0) return '0';
  return rounded > 0 ? `+${rounded}` : `−${-rounded}`;
}

export interface CentsView {
  cents: number;
  text: string;
  state: TuneState;
  color: string;
  hint: string;
  fraction: number;
}

// Number, color and hint must agree with what the player reads, so everything derives from the rounded value.
export function centsView(rawCents: number): CentsView {
  const cents = Math.round(rawCents) || 0;
  const state = tuneState(cents);
  return {
    cents,
    text: formatCents(cents),
    state,
    color: STATE_COLORS[state],
    hint: tuneHint(cents),
    fraction: needleFraction(cents),
  };
}
