import type { Point } from '@third-space/config';
import type { ForestNPCDefinition } from './ForestNPCController';

export const LANTERN_ROAD = Object.freeze({
  incidentId: 'lantern-road-v1', npcId: 'npc:orchard-worker-mara',
  origin: { x: 56, y: 84 }, destination: { x: 91, y: 51 },
  route: [{ x: 72, y: 84 }, { x: 96, y: 70 }, { x: 97, y: 51 }, { x: 91, y: 51 }] as readonly Point[],
  bandits: [{ x: 59, y: 85 }, { x: 58, y: 86 }] as readonly Point[],
});

/** Seven outdoor actors; none are room members or voice/presence participants. */
export function livingWorldNPCDefinitions(): ForestNPCDefinition[] {
  return [
    { id: LANTERN_ROAD.npcId, name: 'Mara', role: 'Fruit picker · gathering apples', art: 'villager', home: LANTERN_ROAD.origin,
      avatar: { hair: 'long', clothingColor: '#b48657', hairColor: '#613f30', skinColor: '#c89170' },
      lines: ['One basket for Nessa, one for the neighbours. The crooked apples taste just as sweet.', 'I take Lantern Road home. A little company makes that a kinder walk.'],
      patrol: [{ x: 56, y: 84 }, { x: 55, y: 83 }, { x: 57, y: 83 }], nightPatrol: [{ x: 56, y: 84 }],
      activity: 'fruit-picking', speed: .65, maxHealth: 100, questHook: 'lantern-road' },
    { id: 'npc:washer-elsie', name: 'Elsie Reed', role: 'Washer · rinsing linen', art: 'villager', home: { x: 99, y: 68 },
      avatar: { hair: 'curly', clothingColor: '#7d9dba', hairColor: '#5e5149', skinColor: '#b98769' },
      lines: ['A clean blanket is a small sort of welcome. Nessa never lets us run out.', 'Mara brings apples while I hang the washing. We keep an eye on each other.'],
      patrol: [{ x: 99, y: 68 }, { x: 99, y: 67 }, { x: 100, y: 67 }], nightPatrol: [{ x: 99, y: 68 }], activity: 'washing', speed: .55 },
    { id: 'npc:woodworker-bram', name: 'Bram', role: 'Woodworker · mending crates', art: 'villager', home: { x: 94, y: 54 },
      avatar: { hair: 'short', clothingColor: '#8a9865', hairColor: '#583d32', skinColor: '#c19978' },
      lines: ['A repaired crate has another season in it. People deserve at least that much patience.', 'Mara should be back with the fruit. The road has been uneasy lately.'],
      patrol: [{ x: 94, y: 54 }, { x: 93, y: 53 }, { x: 94, y: 53 }], nightPatrol: [{ x: 94, y: 54 }], activity: 'woodwork', speed: .55 },
    { id: 'npc:spirit-lumen', name: 'Lumen', role: 'Kind spirit · tending lost light', art: 'spirit', home: { x: 55, y: 82 },
      avatar: { skinColor: '#c8efe0', clothingColor: '#adc8a0', hairColor: '#e7fff2', trouserColor: '#ebd397' },
      lines: ['A little light is enough to offer. You need not promise the whole dawn.', 'I remember every traveller who waited for someone slower.'],
      patrol: [{ x: 55, y: 82 }, { x: 54, y: 83 }, { x: 55, y: 84 }], nightPatrol: [{ x: 55, y: 82 }, { x: 54, y: 83 }], active: 'always', speed: .5 },
    { id: 'npc:spirit-morrow', name: 'Morrow', role: 'Malicious spirit · whispering doubts', art: 'spirit', home: { x: 101, y: 70 },
      avatar: { skinColor: '#ac9fcb', clothingColor: '#5e4979', hairColor: '#554266', trouserColor: '#bd97b5' },
      lines: ['Leave the basket. Leave the road. Leave the person who slowed you down.', 'Nobody would know you heard the cry. Except you, of course.'],
      patrol: [{ x: 101, y: 70 }, { x: 100, y: 70 }, { x: 99, y: 70 }], nightPatrol: [{ x: 101, y: 70 }, { x: 100, y: 70 }], active: 'night', speed: .6 },
    { id: 'npc:pond-frog', name: 'Reed frog', role: 'Pond wildlife · resting in reeds', art: 'frog', home: { x: 99, y: 67 },
      lines: ['The frog answers with one indignant croak.'], patrol: [{ x: 99, y: 67 }, { x: 100, y: 67 }], nightPatrol: [{ x: 99, y: 67 }], speed: .45, maxHealth: 40 },
    { id: 'npc:pond-duck', name: 'Pond duck', role: 'Pond wildlife · foraging at the bank', art: 'duck', home: { x: 101, y: 69 },
      lines: ['The duck searches the bank for a more interesting crumb.'], patrol: [{ x: 101, y: 69 }, { x: 100, y: 70 }], nightPatrol: [{ x: 101, y: 69 }], active: 'day', speed: .65, maxHealth: 50 },
  ];
}

export const LIVING_WORLD_NPCS: readonly ForestNPCDefinition[] = livingWorldNPCDefinitions();
