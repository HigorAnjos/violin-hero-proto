import type { Attack } from './types';

export const ATTACK_PROCESSOR_NAME = 'attack-processor';

export interface AttackProcessorOptions {
  a4: number;
}

export type FromAttackProcessor = Attack;
