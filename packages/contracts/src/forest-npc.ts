import type { AvatarConfig, Facing } from './index';

export type ForestNPCArt = 'villager' | 'wizard' | 'witch' | 'warlock' | 'guard' | 'knight' | 'king' | 'queen' | 'catfolk' | 'ogre' | 'goblin' | 'deer' | 'fox' | 'rabbit' | 'owl' | 'spirit' | 'frog' | 'duck';
export type ForestNPCActivity = 'wandering' | 'patrolling' | 'working' | 'resting' | 'talking' | 'recovering' | 'fruit-picking' | 'washing' | 'woodwork' | 'fleeing' | 'escorting' | 'warning';

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
  /** Authority increments on death so a delayed attack cannot hit a new life. */
  lifeRevision?: number;
  questHook?: string;
  respawnAt?: number;
  dialogue?: { id: string; text: string; until: number };
}
