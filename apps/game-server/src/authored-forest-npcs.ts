import {LIVING_WORLD_NPCS} from './living-world-npcs';
import type { WorldDefinition } from '@third-space/config';
import { AUTHORED_FOREST_NPCS, FOREST_WILDLIFE } from '../../../packages/config/src/forest-cast';
import type { ForestNPCArt } from '../../../packages/contracts/src/forest-npc';
import { DEFAULT_FOREST_NPCS, ForestNPCController, type ForestNPCDefinition } from './ForestNPCController';

const roleArt: Record<string, ForestNPCArt> = { watch: 'guard', cat: 'catfolk', cheesemonger: 'villager', peasant: 'villager', innkeeper: 'villager', flirt: 'villager' };
/** Static biographies stay in config; live snapshots carry only the visual and interaction state. */
export function authoredForestNPCDefinitions(): ForestNPCDefinition[] {
  return [
    ...DEFAULT_FOREST_NPCS,
    ...LIVING_WORLD_NPCS,
    ...AUTHORED_FOREST_NPCS.map(npc => ({
      id: `npc:${npc.id}`, name: npc.name.replace(/ · .+$/, ''), role: npc.role === 'cat' ? 'Catfolk courier' : npc.role === 'watch' ? 'Town watch' : npc.role === 'flirt' ? 'Unreliable poet' : npc.role,
      art: roleArt[npc.role] ?? npc.role as ForestNPCArt,
      home: npc.home, avatar: { skinColor: npc.appearance.skin, hairColor: npc.appearance.hair, clothingColor: npc.appearance.coat, trouserColor: npc.appearance.trim },
      // Personal quest-state dialogue is delivered privately by the quest controller.
      lines: [npc.dialogue['first-meeting'], ...npc.ambientLines], patrol: npc.routine.day, duskPatrol: npc.routine.dusk, nightPatrol: npc.routine.night,
      activity: npc.role === 'guard' || npc.role === 'watch' || npc.role === 'knight' ? 'patrolling' as const : 'working' as const,
      questHook: npc.questHooks[0], maxHealth: npc.role === 'ogre' ? 160 : 100,
    })),
    ...FOREST_WILDLIFE.map(animal => ({
      id: `npc:${animal.id}`, name: animal.name, role: 'Wildlife', art: animal.kind,
      home: animal.home, lines: [animal.kind === 'owl' ? 'A soft hoot answers the forest.' : animal.kind === 'deer' ? 'The deer raises its ears, then returns to the grass.' : animal.kind === 'fox' ? 'The fox watches your hands, hoping for a dropped crumb.' : 'The rabbit pauses mid-chew. You have been noticed.'],
      patrol: animal.route, nightPatrol: animal.active === 'day' ? [] : animal.route, active: animal.active, speed: animal.speed, maxHealth: 60,
    })),
  ];
}

/** Call only for the expanded outdoor world. Interior entry does not create or destroy these actors. */
export function createAuthoredForestNPCs(world: WorldDefinition, random: () => number = Math.random) {
  return new ForestNPCController(world, random, authoredForestNPCDefinitions());
}
