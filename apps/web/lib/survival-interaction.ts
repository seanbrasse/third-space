import type {PlayerState} from '@third-space/contracts';
import type {SurvivalSnapshot} from '../../../packages/contracts/src/survival';
import type {WorldMap} from '@third-space/config';
import {isHomeSegmentWalkable} from '@third-space/simulation';
/** E uses the same pickup/harvest authority as tapping a prop; never spends locally. */
export function nearestSurvivalInteraction(p:PlayerState,snapshot:SurvivalSnapshot|undefined,now:number,map:WorldMap){
  if(!snapshot||p.mode!=='home'||p.zone||p.respawnAt||!p.connected)return undefined;
  const bag=snapshot.backpacks.map(b=>({...b,range:1.5,command:{type:'survival.pickup',backpackId:b.id}}));
  const trees=snapshot.appleTrees.filter(t=>t.readyAt<=now).map(t=>({...t,range:1.8,command:{type:'survival.harvest',treeId:t.id}}));
  return [...bag,...trees].filter(t=>Math.hypot(t.x-p.x,t.y-p.y)<=t.range&&isHomeSegmentWalkable(p,t,map))
    .sort((a,b)=>Math.hypot(a.x-p.x,a.y-p.y)-Math.hypot(b.x-p.x,b.y-p.y)||a.id.localeCompare(b.id))[0]?.command;
}
