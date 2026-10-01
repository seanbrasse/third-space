import type {PlayerState} from '../../contracts/src/index';
import type {ForestNPC} from '../../contracts/src/forest-npc';
import {isHomeSegmentWalkable} from './index';

/** Shared presentation/authority conditions; command revisions and story prerequisites
 * are still validated by the server when an action actually arrives. */
export function canUseForestStory(worldId:string,changingWorld:boolean,player:PlayerState|undefined):player is PlayerState {
  return worldId==='forest'&&!changingWorld&&!!player&&player.connected&&player.mode==='home'&&!player.respawnAt;
}

export function canDiscussForestStory(
  worldId:string,changingWorld:boolean,player:PlayerState|undefined,
  orin:Pick<ForestNPC,'x'|'y'|'phase'>|undefined,
  map:Parameters<typeof isHomeSegmentWalkable>[2],
):boolean {
  return canUseForestStory(worldId,changingWorld,player)&&!player.zone&&!!orin&&orin.phase!=='respawning'
    &&Math.hypot(orin.x-player.x,orin.y-player.y)<=2.5&&isHomeSegmentWalkable(player,orin,map);
}
