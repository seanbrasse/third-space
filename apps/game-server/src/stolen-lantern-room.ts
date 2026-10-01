import {createHash} from 'node:crypto';
import type {ClientCommand,PlayerState} from '@third-space/contracts';
import {getWorld} from '@third-space/config';
import {isHomeSegmentWalkable} from '@third-space/simulation';
import type {ForestNPC} from '../../../packages/contracts/src/forest-npc';
import type {StolenLanternAction,StolenLanternSnapshot} from '../../../packages/contracts/src/stolen-lantern';
import {StolenLanternStore} from '../../../packages/data/src/stolen-lantern-store';
import {STOLEN_LANTERN_CONFIG,STOLEN_LANTERN_INCIDENT_NPCS} from '../../../packages/config/src/stolen-lantern';
import {LANTERN_CAVE,LANTERN_CAVE_ANCHOR} from '../../../packages/config/src/lantern-cave';
import {extendStolenLanternConversation} from '../../../packages/config/src/stolen-lantern-conversations';
import type {NPCConversationView} from '../../../packages/config/src/npc-conversations';
import {GoblinPatrol,type GoblinPatrolHuman} from './GoblinPatrol';
import type {ForestNPCController} from './ForestNPCController';
import type {SurvivalInventory} from './survival-inventory';

interface Options {
  homeId:string;epoch:string;store:StolenLanternStore;survival:SurvivalInventory;
  players:()=>Map<string,PlayerState>;npcs:()=>ForestNPCController|null;
  fresh:(p:PlayerState,c:{worldRevision:number;lifeRevision:number;zoneRevision:number})=>boolean;
  canAccess:(id:string)=>boolean;protectedNpc:(id:string)=>boolean;damage:(p:PlayerState,now:number)=>number;
  refreshInventory:()=>void;send:(id:string,type:string,payload:unknown)=>void;
  notice:(id:string,message:string,commandId?:string)=>void;knockout:(id:string,now:number)=>void;
}
const dist=(a:{x:number;y:number},b:{x:number;y:number})=>Math.hypot(a.x-b.x,a.y-b.y);
const ACTIONS:readonly StolenLanternAction[]=['begin','ask-pip','recover','return','ward','restitute','claim'];
/** Private quest/relationship views; all physical events come from room authority. */
export class StolenLanternRoom {
  readonly patrol:GoblinPatrol;
  private cache=new Map<string,StolenLanternSnapshot>();
  private nextRefresh=0;
  constructor(private o:Options){this.patrol=new GoblinPatrol(getWorld('forest'),{sessionId:o.epoch});}
  private deliver(id:string,type:string,payload:unknown){try{this.o.send(id,type,payload);}catch{/* Reliable current state is resent on rejoin. */}}
  push(id:string){
    const view=this.o.store.read(this.o.homeId,id);this.cache.set(id,view);
    const p=this.o.players().get(id);if(p)p.spiritEffects={wardUntil:view.personal.wardUntil,snareUntil:view.personal.snareUntil};
    this.deliver(id,'lantern.snapshot',view);return view;
  }
  remove(id:string){this.cache.delete(id);}
  private refresh(){for(const p of this.o.players().values())if(p.connected&&this.o.canAccess(p.id))try{this.push(p.id);}catch{/* Next refresh/rejoin retries. */}}
  conversation(id:string,base:NPCConversationView){return extendStolenLanternConversation(base,this.push(id));}
  private act(id:string,commandId:string,action:StolenLanternAction,npcId?:string,expectedInventoryRevision?:number){
    const result=this.o.store.act(this.o.homeId,id,{commandId,action,npcId,expectedInventoryRevision,appleSlotAvailable:this.o.survival.canStoreItem(id,'apple')});
    this.deliver(id,'living.receipt',{...result.receipt,inventoryRevision:result.snapshot.personal.inventory.revision});
    // Quest and ordinary survival share the same atomic apple revision.
    this.o.refreshInventory();this.refresh();return result;
  }
  extraAction(id:string,c:Extract<ClientCommand,{type:'npc.action'}>,npc:ForestNPC){
    if(!c.actionId.startsWith('stolen:'))return false;
    const action=c.actionId.slice(7) as StolenLanternAction;
    if(!ACTIONS.includes(action)||action==='recover'){this.o.notice(id,'That lantern action is not available here.',c.commandId);return true;}
    // Called after LivingWorldRoom revalidates world/life, target life, range and LOS.
    this.act(id,c.commandId,action,npc.id.slice(4),c.expectedInventoryRevision);return true;
  }
  command(id:string,c:ClientCommand){
    if(c.type!=='lantern.recover')return false;
    const p=this.o.players().get(id);
    if(!p||!this.o.canAccess(id)||!this.o.fresh(p,c)||p.zone!==LANTERN_CAVE.id||dist(p,LANTERN_CAVE_ANCHOR)>STOLEN_LANTERN_CONFIG.recoveryRange||!isHomeSegmentWalkable(p,LANTERN_CAVE_ANCHOR,LANTERN_CAVE.map)){
      this.o.notice(id,'Reach the lantern inside Lantern Cave with a clear path.',c.commandId);return true;
    }
    try{this.act(id,c.commandId,'recover');}catch{this.o.notice(id,'The lantern could not be saved. Try again.',c.commandId);}return true;
  }
  /** Invoked inside the existing reputation transaction, before physical damage. */
  recordNpcHit(id:string,npcId:string,commandId:string){
    npcId=npcId.replace(/^npc:/,'');if(!STOLEN_LANTERN_INCIDENT_NPCS.includes(npcId))return;
    this.o.store.recordIncident(this.o.homeId,id,{commandId:`incident:${createHash('sha256').update(commandId).digest('hex')}`,npcId});
  }
  private humans():GoblinPatrolHuman[]{return [...this.o.players().values()].map(p=>{const s=this.o.survival.ensure(p.id);return {...p,health:s.health,armed:s.equipped==='knife'&&!!s.knifeId,lifeRevision:p.respawnCount??0,wardUntil:p.spiritEffects?.wardUntil??0};});}
  strike(id:string,mobId:string,revision:number,now:number){
    const actor=this.humans().find(p=>p.id===id),p=this.o.players().get(id);
    if(!actor||!p)return {ok:false as const,reason:'That player is no longer here'};
    return this.patrol.strike(actor,mobId,revision,now,(a,target,at)=>this.o.survival.strikeWorldTarget(a,target,at),this.o.damage(p,now));
  }
  tick(now:number,night:boolean,pathSearchBudget=1){
    const npcs=this.o.npcs();if(!npcs)return 0;
    const update=this.patrol.update(now,this.humans(),npcs.snapshot(),{night,pathSearchBudget,isProtectedNpc:n=>n.id==='npc:keeper-ada'||this.o.protectedNpc(n.id)});
    for(const hit of update.damage){
      if(hit.targetKind==='npc'){const n=npcs.get(hit.targetId);if(n&&(n.lifeRevision??0)===hit.targetLifeRevision&&!this.o.protectedNpc(n.id))npcs.damage(n.id,hit.amount,now);}
      else{const p=this.o.players().get(hit.targetId);if(p&&(p.respawnCount??0)===hit.targetLifeRevision&&(p.zoneRevision??0)===hit.targetZoneRevision){const result=this.o.survival.damageWorld(p,hit.amount,now);if(result.ok)for(const id of result.deaths)this.o.knockout(id,now);}}
    }
    for(const hit of update.snares){const p=this.o.players().get(hit.targetId);if(!p||!p.connected||p.zone||p.respawnAt||(p.respawnCount??0)!==hit.targetLifeRevision||(p.zoneRevision??0)!==hit.targetZoneRevision||!this.o.canAccess(p.id))continue;
      try{const result=this.o.store.snare(this.o.homeId,p.id,hit.id);this.push(p.id);if(!result.replayed&&result.receipt.status==='updated')this.o.notice(p.id,'Morrow’s roots slow your steps for five seconds. Lumen’s ward can clear them.');}catch{/* No saved effect means no authoritative slowdown. */}
    }
    if(now>=this.nextRefresh){this.nextRefresh=now+1000;for(const [id,s]of this.cache)if(this.o.players().get(id)?.connected&&this.o.canAccess(id)&&(s.personal.wardUntil>s.serverTime||s.personal.snareUntil>s.serverTime))try{this.push(id);}catch{}}
    return this.patrol.diagnostics().lastPathQueries;
  }
}
