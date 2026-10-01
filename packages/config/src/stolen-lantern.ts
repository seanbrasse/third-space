import { LANTERN_CAVE_ANCHOR } from './lantern-cave';

export const STOLEN_LANTERN_CONFIG = Object.freeze({
  version: 1,
  id: 'stolen-lantern',
  title: 'The Stolen Lantern',
  lanternId: 'quest:stolen-lantern',
  recoveryPoint: LANTERN_CAVE_ANCHOR,
  recoveryRange: 1.8,
  rewardApples: 2,
  restitutionApples: 2,
  appleCapacity: 5,
  wardDurationMs: 20_000,
  wardCooldownMs: 60_000,
  snareDurationMs: 5_000,
} as const);

export const STOLEN_LANTERN_NPCS = Object.freeze({ elsie: 'washer-elsie', pip: 'goblin-pip', lumen: 'spirit-lumen' } as const);
export const STOLEN_LANTERN_INCIDENT_NPCS: readonly string[] = Object.freeze(Object.values(STOLEN_LANTERN_NPCS));
export const STOLEN_LANTERN_RECIPIENTS = Object.freeze({
  begin: Object.freeze([STOLEN_LANTERN_NPCS.elsie]),
  'ask-pip': Object.freeze([STOLEN_LANTERN_NPCS.pip]),
  recover: Object.freeze([] as string[]),
  return: Object.freeze([STOLEN_LANTERN_NPCS.elsie]),
  ward: Object.freeze([STOLEN_LANTERN_NPCS.lumen]),
  restitute: STOLEN_LANTERN_INCIDENT_NPCS,
  claim: Object.freeze([STOLEN_LANTERN_NPCS.elsie]),
} as const);

/** Public journal text reveals only the next discovered step. The lantern is
 * held once by the home; these instructions never promise a personal item. */
export const STOLEN_LANTERN_JOURNAL = Object.freeze({
  quiet: Object.freeze({ objective: '', location: '' }),
  'ask-pip': Object.freeze({ objective: 'Ask Pip who carried Elsie’s lantern away.', location: 'Pip at Copperbutton camp, southeast along the southern road.' }),
  'find-cave': Object.freeze({ objective: 'Enter Lantern Cave and recover the lantern inside. Lumen can ward you against Morrow’s snare.', location: 'Inside Lantern Cave, beyond the stone entrance east of the orchard.' }),
  'return-lantern': Object.freeze({ objective: 'The home has the lantern. Return it to Elsie; any member can carry the news.', location: 'Elsie at the reed pond south of Bramblewick.' }),
  complete: Object.freeze({ objective: 'Elsie’s lantern is home. Each member who belonged to the home at its return may collect two apples.', location: 'Elsie at the reed pond keeps earned rewards until your pockets have room.' }),
} as const);
