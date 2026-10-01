import {createHash} from 'node:crypto';
import type {ClientCommand, PlayerState} from '@third-space/contracts';
import type {ForestNPC} from '../../../packages/contracts/src/forest-npc';
import type {LivingWorldSnapshot, NPCActionOffer} from '../../../packages/contracts/src/living-world';
import type {ForestStorySnapshot} from '../../../packages/contracts/src/forest-story';
import {LivingWorldStore} from '../../../packages/data/src/living-world-store';
import {isLivingWorldNpc,potionMultipliers} from '../../../packages/simulation/src/living-world-rules';
import {npcConversation,type NPCConversationView} from '../../../packages/config/src/npc-conversations';
import {getWorld} from '@third-space/config';
import {isHomeSegmentWalkable} from '@third-space/simulation';
import {LivingWorldController,type LivingWorldHuman} from './LivingWorldController';
import type {ForestNPCController} from './ForestNPCController';
import {SURVIVAL,type SurvivalInventory} from './survival-inventory';

interface Options {
  homeId:string; epoch:string; store:LivingWorldStore; survival:SurvivalInventory;
  players:()=>Map<string,PlayerState>; npcs:()=>ForestNPCController|null; keeper:()=>ForestNPC|undefined;
  fresh:(p:PlayerState,c:{worldRevision:number;lifeRevision:number;zoneRevision:number})=>boolean;
  canAccess:(id:string)=>boolean; story:(id:string)=>ForestStorySnapshot;
  talk:(id:string,npcId:string,commandId:string)=>void;
  refreshStory:()=>void; send:(id:string,type:string,payload:unknown)=>void;
  notice:(id:string,message:string,commandId?:string)=>void;
  inventoryRevision:(id:string,revision:number)=>void;
  knockout:(id:string,now:number)=>void;
  extendConversation?:(id:string,view:NPCConversationView)=>NPCConversationView;
  extraAction?:(id:string,c:Extract<ClientCommand,{type:'npc.action'}>,npc:ForestNPC)=>boolean;
  /** Persist only: called inside the reputation transaction before physical damage. */
  onNpcHit?:(id:string,npcId:string,commandId:string)=>void;
}
const range=(a:{x:number;y:number},b:{x:number;y:number})=>Math.hypot(a.x-b.x,a.y-b.y);
/** Private reliable views and bounded world authority. No UI result can grant a physical outcome. */
export class LivingWorldRoom {
  readonly controller:LivingWorldController;
  private cache=new Map<string,LivingWorldSnapshot>();
  private helpSent=new Map<string,string>();
  private nextRefresh=0;
  private pendingViolence=new Map<string,{actorId:string;targetUserId:string;witnessNpcIds:string[]}>();
  private nextCommit=0;
  private alternate=false;
  constructor(private o:Options){this.controller=new LivingWorldController(getWorld('forest'),{sessionId:o.epoch});}
  private deliver(id:string,type:string,payload:unknown){try{this.o.send(id,type,payload);}catch{/* Durable state is delivered again on reconnect. */}}
  push(id:string){
    const view=this.o.store.read(this.o.homeId,id);this.cache.set(id,view);
    this.o.inventoryRevision(id,view.personal.inventory.revision);
    this.o.survival.restoreApples(id,view.personal.inventory.apples);
    this.o.survival.restorePotions(id,view.personal.inventory.potions);
    const player=this.o.players().get(id);if(player)player.potionEffects=view.personal.effects;
    this.controller.syncStory(view.rescue.stage);
    this.deliver(id,'living.snapshot',view);return view;
  }
  refreshMember(id:string){try{return this.push(id);}catch{return this.cache.get(id);}}
  remove(id:string){this.cache.delete(id);this.helpSent.delete(id);}
  private refresh(){for(const p of this.o.players().values())if(p.connected&&this.o.canAccess(p.id))this.refreshMember(p.id);}
  damage(p:PlayerState,now:number){return SURVIVAL.attackDamage*potionMultipliers(p.potionEffects??[],now).damage;}
  humans():LivingWorldHuman[]{return [...this.o.players().values()].map(p=>{const s=this.o.survival.ensure(p.id),v=this.cache.get(p.id);return {...p,health:s.health,armed:s.equipped==='knife'&&!!s.knifeId,lifeRevision:p.respawnCount??0,afraidNpcIds:v?.personal.relationships.filter(r=>r.afraid&&r.fearExpiresAt>Date.now()).map(r=>`npc:${r.npcId}`)??[]};});}
  private npc(id:string){return this.o.npcs()?.get(id)??(id==='npc:keeper-ada'?this.o.keeper():undefined);}
  private nearby(p:PlayerState,npc:ForestNPC|undefined){return !!npc&&npc.health>0&&npc.phase!=='respawning'&&range(p,npc)<=2.5&&isHomeSegmentWalkable(p,npc,getWorld('forest').map);}
  private offers(id:string,npc:ForestNPC):NPCActionOffer[]{
    const name=npc.id.slice(4),offers=isLivingWorldNpc(name)?this.o.store.offers(this.o.homeId,id,name):[];
    if(isLivingWorldNpc(name)&&name!=='keeper-ada')offers.push({actionId:`attack:${npc.id}:${npc.lifeRevision??0}`,npcId:name,kind:'attack',label:'Attack with knife · neighbours remember',expiresAt:Date.now()+60000,...(this.protectedNpc(npc.id)?{disabledReason:'Mara is under the village’s protection.'}:{})});
    return offers;
  }
  private open(id:string,npc:ForestNPC,mode:'conversation'|'help'='conversation',commandId?:string){
    const personal=this.push(id),name=npc.id.slice(4);
    const base=npcConversation({npcId:name,npcName:npc.name,story:this.o.story(id).story,offers:this.offers(id,npc),relationship:personal.personal.relationships.find(r=>r.npcId===name),trust:personal.personal.trust,rescue:personal.rescue});
    const view=this.o.extendConversation?.(id,base)??base;
    const p=this.o.players().get(id)!;
    this.deliver(id,'npc.conversation',{view,mode,commandId,epoch:this.o.epoch,lifeRevision:p.respawnCount??0,zoneRevision:p.zoneRevision??0,targetNpcLifeRevision:npc.lifeRevision??0});
  }
  command(id:string,c:ClientCommand):boolean {
    if(!c.type.startsWith('npc.')&&c.type!=='living.use')return false;
    const command=c as Extract<ClientCommand,{type:`npc.${string}`|'living.use'}>,p=this.o.players().get(id),now=Date.now();
    if(!p||!this.o.fresh(p,command)||p.zone){this.o.notice(id,'Return outside, alive and connected, then try again.',command.commandId);return true;}
    // All paths share a life/world fence and bounded replay ledger, including physical attacks.
    if(command.type!=='npc.action'&&command.type!=='living.use'&&!this.o.survival.acceptCommand(id,command.commandId,now))return true;
    try{
      if(command.type==='living.use'){
        const inventory=this.o.survival.ensure(id);
        const result=this.o.store.usePotion(this.o.homeId,id,{commandId:command.commandId,potion:command.potion,expectedInventoryRevision:command.expectedInventoryRevision,equipped:inventory.equipped===`${command.potion}-potion`});
        this.deliver(id,'living.receipt',result.receipt);this.refresh();return true;
      }
      const npc=this.npc(command.npcId);
      if(!this.nearby(p,npc)){this.o.notice(id,'Move beside them with a clear path. They may still be recovering.',command.commandId);return true;}
      if(command.type==='npc.interact'){
        this.o.talk(id,npc!.id,command.commandId);
        if(['npc:orchard-worker-mara','npc:wizard-orin-vale','npc:innkeeper-nessa'].includes(npc!.id)){this.o.store.advanceRescue(this.o.homeId,id,{commandId:`referral:${createHash('sha256').update(command.commandId).digest('hex')}`,event:'discovered'});this.refresh();}
        // The private conversation uses the committed story state. Ambient speech is only decoration.
        this.open(id,npc!,'conversation',command.commandId);return true;
      }
      const actor=this.humans().find(a=>a.id===id)!;
      if(command.type==='npc.decline'){this.controller.decline(actor,now,npc);return true;}
      if(command.targetLifeRevision!==(npc!.lifeRevision??0)){this.o.notice(id,'They have recovered since that action. Speak again.',command.commandId);return true;}
      if(command.type==='npc.attack'){
        if(npc!.id==='npc:keeper-ada'||this.protectedNpc(npc!.id)||!isLivingWorldNpc(npc!.id.slice(4))){this.o.notice(id,'That resident cannot be attacked.',command.commandId);return true;}
        const swing=this.o.survival.strikeWorldTarget(p,npc!,now);
        if(!swing.ok){this.o.notice(id,swing.reason,command.commandId);return true;}
        const npcs=this.o.npcs()!.snapshot();
        const witnesses=npcs.filter(n=>isLivingWorldNpc(n.id.slice(4))&&n.phase!=='respawning'&&range(n,p)<=8&&isHomeSegmentWalkable(n,p,getWorld('forest').map)&&isHomeSegmentWalkable(n,npc!,getWorld('forest').map)).map(n=>n.id.slice(4)).slice(0,32);
        // Commit the observed intent before damaging; a storage failure never creates unrecorded harm.
        const result=this.o.store.witnessAttack(this.o.homeId,id,{commandId:`npc-hit:${createHash('sha256').update(command.commandId).digest('hex')}`,targetNpcId:npc!.id.slice(4),witnessNpcIds:witnesses},()=>this.o.onNpcHit?.(id,npc!.id,command.commandId));
        if(!result.replayed){this.controller.observeViolence(actor,npc!.id,now,npcs);this.o.npcs()!.damage(npc!.id,this.damage(p,now),now);}
        this.deliver(id,'living.receipt',{...result.receipt,commandId:command.commandId});this.open(id,npc!,'conversation',command.commandId);return true;
      }
      // An offer is bound to this nearby NPC, this admitted member and this current life.
      if(this.o.extraAction?.(id,command,npc!)){this.open(id,npc!,'conversation',command.commandId);return true;}
      const offer=this.offers(id,npc!).find(v=>v.actionId===command.actionId);
      const result=this.o.store.act(this.o.homeId,id,{commandId:command.commandId,npcId:npc!.id.slice(4),actionId:command.actionId,expectedInventoryRevision:command.expectedInventoryRevision,potionSlotAvailable:!!offer&&(!offer.potion||this.o.survival.canStoreItem(id,`${offer.potion}-potion`))});
      if(result.receipt.status==='updated'&&!result.replayed&&offer&&(offer.kind==='protect'||offer.kind==='escort')){
        const physical=offer.kind==='protect'?this.controller.protect(actor,now,npc):this.controller.escort(actor,now,npc);
        if(!physical.ok)this.o.notice(id,physical.reason,command.commandId);
      }
      this.deliver(id,'living.receipt',result.receipt);
      if(result.receipt.status==='updated'&&!result.replayed&&offer?.kind==='talk')this.o.talk(id,npc!.id,command.commandId);
      this.o.refreshStory();this.refresh();this.open(id,npc!,'conversation',command.commandId);
    }catch{this.o.notice(id,'That action could not be saved. Speak again to refresh it.',command.commandId);}
    return true;
  }
  recordPlayerHit(actorId:string,targetUserId:string,eventId:string,now:number){
    const actor=this.humans().find(a=>a.id===actorId),victim=this.o.players().get(targetUserId);if(!actor||!victim)return;
    const npcs=this.o.npcs()?.snapshot()??[],witnessNpcIds=npcs.filter(n=>isLivingWorldNpc(n.id.slice(4))&&n.phase!=='respawning'&&range(n,actor)<=8&&isHomeSegmentWalkable(n,actor,getWorld('forest').map)&&isHomeSegmentWalkable(n,victim,getWorld('forest').map)).map(n=>n.id.slice(4)).slice(0,32);
    if(!witnessNpcIds.length)return;
    this.controller.observeViolence(actor,targetUserId,now,npcs,victim);
    if(this.pendingViolence.size<64)this.pendingViolence.set(`player-hit:${createHash('sha256').update(eventId).digest('hex')}`,{actorId,targetUserId,witnessNpcIds});
    this.commitViolence();
  }
  private commitViolence(){for(const [commandId,event]of this.pendingViolence){
    if(!this.o.canAccess(event.actorId)||!this.o.canAccess(event.targetUserId)){this.pendingViolence.delete(commandId);continue;}
    try{this.o.store.witnessPlayerAttack(this.o.homeId,event.actorId,{commandId,targetUserId:event.targetUserId,witnessNpcIds:event.witnessNpcIds});this.pendingViolence.delete(commandId);this.push(event.actorId);}catch{/* Retry bounded witnessed events when storage becomes available. */}
  }}
  strike(id:string,mobId:string,revision:number,now:number){const actor=this.humans().find(p=>p.id===id)!;return this.controller.strike(actor,mobId,revision,now,(a,target,at)=>this.o.survival.strikeWorldTarget(a,target,at),this.damage(this.o.players().get(id)!,now));}
  tick(now:number,phase:'dawn'|'day'|'dusk'|'night',pathSearchBudget=1){
    const npcController=this.o.npcs();if(!npcController)return 0;
    const budget=Number.isFinite(pathSearchBudget)?Math.max(0,Math.min(1,Math.floor(pathSearchBudget))):0;
    // Only advance priority when this subsystem receives a search slot. Goblins
    // may consume alternating ticks; advancing on zero would always favor one lane.
    if(budget>0)this.alternate=!this.alternate;
    if(this.alternate)npcController.update(now,{phase,pathSearchBudget:budget});
    const update=this.controller.update(now,this.humans(),npcController.snapshot(),{night:phase==='night',pathSearchBudget:this.alternate?budget-npcController.diagnostics().lastPathSearches:budget});
    for(const intent of update.steering)npcController.steer(intent.npcId,intent.goal,now,{...intent,bubble:intent.bubble?.text});
    if(!this.alternate)npcController.update(now,{phase,pathSearchBudget:budget-this.controller.diagnostics().lastPathQueries});
    for(const hit of update.damage){
      if(hit.targetKind==='npc'){const n=npcController.get(hit.targetId);if(n&&(n.lifeRevision??0)===hit.targetLifeRevision)npcController.damage(n.id,hit.amount,now);}
      else {const p=this.o.players().get(hit.targetId);if(p&&(p.respawnCount??0)===hit.targetLifeRevision){const result=this.o.survival.damageWorld(p,hit.amount,now);if(result.ok)for(const id of result.deaths)this.o.knockout(id,now);}}
    }
    if(now>=this.nextCommit){this.nextCommit=now+500;this.commitViolence();for(const event of this.controller.pendingEvents()){
      const participantIds=[...new Set(event.participantIds)].filter(id=>this.o.canAccess(id));
      const ids=[event.actorId,...participantIds].filter(id=>this.o.canAccess(id));
      if(!ids.length){this.controller.acknowledgeEvent(event.eventId);continue;}
      try{const result=this.o.store.advanceRescue(this.o.homeId,ids[0]!,{commandId:event.eventId,event:event.event,incidentId:event.incidentId,participantIds});if(result.receipt.status!=='updated'&&result.receipt.status!=='unchanged')break;this.controller.acknowledgeEvent(event.eventId);this.refresh();}catch{break;/* Preserve event order: later outcomes cannot outrun a failed prerequisite. */}
    }}
    if(now>=this.nextRefresh){this.nextRefresh=now+1000;
      for(const [id,view]of this.cache)if(this.o.players().get(id)?.connected&&this.o.canAccess(id)&&(view.personal.effects.length||view.personal.relationships.some(r=>r.fear>0||r.trust<0)||view.rescue.stage==='recovering'))this.refreshMember(id);
    }
    const rescue=this.controller.snapshot().rescue,id=rescue.helpTargetId,npc=npcController.get(rescue.npcId);
    if(id&&npc&&this.cache.get(id)?.rescue.discovered&&rescue.phase==='endangered'&&this.helpSent.get(id)!==rescue.attemptId&&this.o.players().get(id)?.connected){
      this.helpSent.set(id,rescue.attemptId!);this.open(id,npc,'help');
    }
    return npcController.diagnostics().lastPathSearches+this.controller.diagnostics().lastPathQueries;
  }
  protectedNpc(id:string){const phase=this.controller.snapshot().rescue.phase;return id==='npc:orchard-worker-mara'&&(phase==='recovering'||phase==='complete');}
}
