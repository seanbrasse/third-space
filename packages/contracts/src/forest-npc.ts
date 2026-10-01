import type { AvatarConfig, Facing } from './index';

export type ForestNPCArt = 'villager' | 'wizard' | 'witch' | 'warlock' | 'guard' | 'knight' | 'king' | 'queen' | 'catfolk' | 'ogre' | 'goblin' | 'deer' | 'fox' | 'rabbit' | 'owl';
export type ForestNPCActivity = 'wandering' | 'patrolling' | 'working' | 'resting' | 'talking' | 'recovering';

/** Room-owned actors. IDs cannot stand in for authenticated human membership. */
export interface ForestNPC {
  id: string;
  name: string;
  role: string;
  art: ForestNPCArt;
  avatar: AvatarConfig;
  x: number;
  y: number;
  facing: Facing;
  phase: 'wander' | 'talking' | 'respawning';
  activity: ForestNPCActivity;
  moving: boolean;
  health: number;
  maxHealth: number;
  questHook?: string;
  respawnAt?: number;
  dialogue?: { id: string; text: string; until: number };
}
