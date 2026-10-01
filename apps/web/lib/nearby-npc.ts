import type { PlayerState } from '../../../packages/contracts/src';
import type { ForestNPC, ForestNPCArt } from '../../../packages/contracts/src/forest-npc';
import { isHomeSegmentWalkable, type NavigationMap } from '../../../packages/simulation/src';

export const NPC_INTERACTION_RANGE = 2.5;
export type NearbyNPCPlayer = Pick<PlayerState, 'id' | 'x' | 'y' | 'connected' | 'mode' | 'zone' | 'respawnAt'> & {
  /** Optional authoritative survival health, when available alongside PlayerState. */
  health?: number;
};
const wildlifeArt: ReadonlySet<ForestNPCArt> = new Set(['deer', 'fox', 'rabbit', 'owl', 'frog', 'duck']);

/** Shared selector for the E prompt and its click/touch equivalent. The caller
 * gates forest/world transitions; the room revalidates every actual command.
 * A straight walkable segment is required, matching NPC conversation authority.
 * No path search, array mutation, conversation opening or action execution. */
export function nearestInteractableNPC(
  player: NearbyNPCPlayer | null | undefined,
  npcs: readonly ForestNPC[],
  map: NavigationMap,
): ForestNPC | undefined {
  if (!player || !player.connected || player.mode !== 'home' || player.zone || player.respawnAt ||
    player.id.startsWith('npc:') || !Number.isFinite(player.x) || !Number.isFinite(player.y) ||
    (player.health !== undefined && (!Number.isFinite(player.health) || player.health <= 0))) return undefined;

  let nearest: ForestNPC | undefined;
  let nearestDistance = NPC_INTERACTION_RANGE ** 2;
  for (const npc of npcs) {
    if (npc.phase === 'respawning' || npc.respawnAt || !Number.isFinite(npc.health) || npc.health <= 0 ||
      wildlifeArt.has(npc.art) || npc.role.toLowerCase() === 'wildlife' || /^(?:npc:)?animal:/.test(npc.id)) continue;
    const distance = (npc.x - player.x) ** 2 + (npc.y - player.y) ** 2;
    if (!Number.isFinite(distance) || distance > nearestDistance ||
      (nearest && distance === nearestDistance && npc.id >= nearest.id)) continue;
    if (!isHomeSegmentWalkable(player, npc, map)) continue;
    nearest = npc;
    nearestDistance = distance;
  }
  return nearest;
}
