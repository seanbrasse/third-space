import type { Facing } from './index';

export type ForestMobKind = 'bramble-raider' | 'rootbound-guardian';
export interface ForestMob {
  id: string;
  encounterId: string;
  name: string;
  kind: ForestMobKind;
  x: number;
  y: number;
  facing: Facing;
  health: number;
  maxHealth: number;
  lifeRevision: number;
  phase: 'idle' | 'pursuing' | 'windup' | 'recovering' | 'returning' | 'defeated';
  moving: boolean;
  /** The committed impact point is visible throughout the fair windup. */
  windup?: { x: number; y: number; until: number; radius: number };
  hurtAt?: number;
  defeatedAt?: number;
}
export interface ForestCombatEncounter {
  id: string;
  title: string;
  phase: 'idle' | 'active' | 'resetting' | 'defeated';
  participantScale: number;
  resetAt?: number;
}
export interface ForestMobSnapshot { mobs: ForestMob[]; encounters: ForestCombatEncounter[] }
