import {livingActorCanvas} from './living-environment-art';
import { AUTHORED_FOREST_NPCS, FOREST_WILDLIFE } from '../../../packages/config/src/forest-cast';
import type { ForestNPCTextureFactory } from './forest-npc-presentation';
import { authoredNpcCanvas } from './authored-forest-art';
import { avatarPixelCanvas } from './pixel-art';

const cast = new Map(AUTHORED_FOREST_NPCS.map(npc => [`npc:${npc.id}`, npc]));
const wildlife = new Map(FOREST_WILDLIFE.map(npc => [`npc:${npc.id}`, npc]));

/** Optional texture factory for the expanded cast. Core three-NPC scenes have no content-art dependency. */
export const authoredNPCTexture: ForestNPCTextureFactory = (npc, facing, frame) => {
  if(npc.art==='spirit'||npc.art==='frog'||npc.art==='duck')return livingActorCanvas(npc.art,{skin:npc.avatar.skinColor,coat:npc.avatar.clothingColor,hair:npc.avatar.hairColor,trim:npc.avatar.trouserColor},facing,frame);
  const resident = cast.get(npc.id);
  if (resident) return authoredNpcCanvas(resident.role, resident.appearance, facing, frame);
  const animal = wildlife.get(npc.id);
  if (animal) return authoredNpcCanvas(animal.kind, { skin: '#b89268', hair: '#694b35', coat: '#b17549', trim: '#e2cda6' }, facing, frame);
  return avatarPixelCanvas(npc.avatar, facing, frame);
};
