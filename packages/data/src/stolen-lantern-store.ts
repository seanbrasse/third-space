import type { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import type { StolenLanternActionRequest, StolenLanternIncident, StolenLanternMutation, StolenLanternReceipt, StolenLanternSnapshot, StolenLanternStage } from '../../contracts/src/stolen-lantern.js';
import { STOLEN_LANTERN_CONFIG as C, STOLEN_LANTERN_INCIDENT_NPCS, STOLEN_LANTERN_JOURNAL, STOLEN_LANTERN_RECIPIENTS } from '../../config/src/stolen-lantern.js';

type Row = Record<string, unknown>;
type Outcome = Pick<StolenLanternReceipt, 'status' | 'message'>;
interface Shared { revision:number; stage:StolenLanternStage; recoveredBy:string|null; returnedAt:number|null }
interface Personal { revision:number; wardUntil:number; wardReadyAt:number; snareUntil:number }
export interface StolenLanternIncidentRequest { commandId:string; npcId:string }
export class StolenLanternStoreError extends Error {
  constructor(public readonly code:'ACCESS_DENIED'|'INVALID_EVENT'|'EVENT_CONFLICT'|'UNSUPPORTED_VERSION'|'CORRUPT_STATE', message:string) { super(message); }
}
const integer = (value:unknown,min=0,max=Number.MAX_SAFE_INTEGER):value is number => typeof value==='number'&&Number.isSafeInteger(value)&&value>=min&&value<=max;
const key = (value:unknown,max=200):value is string => typeof value==='string'&&value.length>0&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value);
const invalid = (message='Invalid Stolen Lantern command.'):never => { throw new StolenLanternStoreError('INVALID_EVENT',message); };
const corrupt = ():never => { throw new StolenLanternStoreError('CORRUPT_STATE','Invalid durable Stolen Lantern state.'); };
const outcome = (status:Outcome['status'],message:string):Outcome => ({status,message});

/** Additive SQLite authority. The room authenticates socket/world/life/reach and
 * cave recovery; only verified server events may call recordIncident or snare. */
export class StolenLanternStore {
  constructor(private readonly db:DatabaseSync,private readonly options:{canAccess:(homeId:string,userId:string)=>boolean;now?:()=>number}) {
    this.transaction(()=>{
      this.db.exec('CREATE TABLE IF NOT EXISTS forest_adventure_schema(component TEXT PRIMARY KEY,version INTEGER NOT NULL)');
      const version=this.one('SELECT version FROM forest_adventure_schema WHERE component=?','stolen-lantern');
      if(version&&version.version!==C.version)throw new StolenLanternStoreError('UNSUPPORTED_VERSION','Stolen Lantern storage needs an explicit migration.');
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS forest_adventure_inventory(
          home_id TEXT NOT NULL REFERENCES homes(id),user_id TEXT NOT NULL REFERENCES profiles(id),
          version INTEGER NOT NULL,revision INTEGER NOT NULL CHECK(revision>=1),
          apples INTEGER NOT NULL CHECK(apples BETWEEN 0 AND 5),PRIMARY KEY(home_id,user_id)
        );
        CREATE TABLE IF NOT EXISTS stolen_lantern_state(
          home_id TEXT PRIMARY KEY REFERENCES homes(id),version INTEGER NOT NULL,
          revision INTEGER NOT NULL CHECK(revision>=1),
          stage TEXT NOT NULL CHECK(stage IN ('quiet','ask-pip','find-cave','return-lantern','complete')),
          recovered_by TEXT REFERENCES profiles(id),returned_at INTEGER
        );
        CREATE TABLE IF NOT EXISTS stolen_lantern_personal(
          home_id TEXT NOT NULL REFERENCES homes(id),user_id TEXT NOT NULL REFERENCES profiles(id),
          version INTEGER NOT NULL,revision INTEGER NOT NULL CHECK(revision>=1),
          ward_until INTEGER NOT NULL CHECK(ward_until>=0),ward_ready_at INTEGER NOT NULL CHECK(ward_ready_at>=0),
          snare_until INTEGER NOT NULL CHECK(snare_until>=0),PRIMARY KEY(home_id,user_id)
        );
        CREATE TABLE IF NOT EXISTS stolen_lantern_incidents(
          home_id TEXT NOT NULL REFERENCES homes(id),user_id TEXT NOT NULL REFERENCES profiles(id),
          npc_id TEXT NOT NULL,occurred_at INTEGER NOT NULL,resolved_at INTEGER,
          PRIMARY KEY(home_id,user_id,npc_id)
        );
        CREATE TABLE IF NOT EXISTS stolen_lantern_rewards(
          home_id TEXT NOT NULL REFERENCES homes(id),user_id TEXT NOT NULL REFERENCES profiles(id),
          apples INTEGER NOT NULL CHECK(apples=2),earned_at INTEGER NOT NULL,claimed_at INTEGER,
          PRIMARY KEY(home_id,user_id)
        );
        CREATE TABLE IF NOT EXISTS stolen_lantern_receipts(
          home_id TEXT NOT NULL REFERENCES homes(id),user_id TEXT NOT NULL REFERENCES profiles(id),
          command_id TEXT NOT NULL,payload_hash TEXT NOT NULL,receipt_json TEXT NOT NULL,
          PRIMARY KEY(home_id,user_id,command_id)
        );
      `);
      this.db.prepare('INSERT OR IGNORE INTO forest_adventure_schema VALUES(?,?)').run('stolen-lantern',C.version);
    });
  }

  read(homeId:string,userId:string):StolenLanternSnapshot {
    return this.transaction(()=>{this.requireAccess(homeId,userId);this.ensure(homeId,userId);return this.snapshot(homeId,userId,this.now());});
  }

  act(homeId:string,userId:string,request:StolenLanternActionRequest):StolenLanternMutation {
    if(!request||typeof request.action!=='string'||!Object.prototype.hasOwnProperty.call(STOLEN_LANTERN_RECIPIENTS,request.action)||
      (request.expectedInventoryRevision!==undefined&&!integer(request.expectedInventoryRevision,1))||
      (request.appleSlotAvailable!==undefined&&typeof request.appleSlotAvailable!=='boolean'))return invalid();
    const allowed:readonly string[]=STOLEN_LANTERN_RECIPIENTS[request.action];
    if(request.action==='recover'?request.npcId!==undefined:!key(request.npcId,100)||!allowed.includes(request.npcId))return invalid('That action belongs to a different place or neighbour.');
    if((request.action==='restitute'||request.action==='claim')&&!integer(request.expectedInventoryRevision,1))return invalid('A current inventory revision is required.');
    return this.execute(homeId,userId,request.commandId,['action',request.action,request.npcId??null,request.expectedInventoryRevision??null],now=>{
      const shared=this.shared(homeId),personal=this.personal(homeId,userId);
      if(request.npcId&&request.action!=='restitute'&&this.one('SELECT 1 AS found FROM stolen_lantern_incidents WHERE home_id=? AND user_id=? AND npc_id=? AND resolved_at IS NULL',homeId,userId,request.npcId))
        return outcome('blocked','This neighbour remembers being hurt. Make restitution to them before asking for help.');
      if(request.action==='begin'){
        if(shared.stage!=='quiet')return outcome('unchanged','The home already has Elsie’s request in its journal.');
        this.stage(homeId,'ask-pip');return outcome('updated','Elsie’s lantern is missing. Ask Pip who carried it away.');
      }
      if(request.action==='ask-pip'){
        if(shared.stage==='quiet')return outcome('blocked','Speak to Elsie about her lantern first.');
        if(shared.stage!=='ask-pip')return outcome('unchanged','Pip’s account is already in the home’s journal.');
        this.stage(homeId,'find-cave');return outcome('updated','Pip saw a restless light carry the lantern toward the cave east of the orchard.');
      }
      if(request.action==='recover'){
        if(shared.stage==='return-lantern'||shared.stage==='complete')return outcome('unchanged','The home already recovered the one missing lantern.');
        if(shared.stage!=='find-cave')return outcome('blocked','Follow Elsie’s request and Pip’s account before recovering the lantern.');
        this.db.prepare("UPDATE stolen_lantern_state SET stage='return-lantern',revision=revision+1,recovered_by=? WHERE home_id=?").run(userId,homeId);
        return outcome('updated','The lantern is in the home’s care. Any member can return it to Elsie.');
      }
      if(request.action==='return'){
        if(shared.stage==='complete')return outcome('unchanged','Elsie already has her lantern back.');
        if(shared.stage!=='return-lantern')return outcome('blocked','The home must recover the lantern inside the cave before returning it.');
        this.db.prepare("UPDATE stolen_lantern_state SET stage='complete',revision=revision+1,returned_at=? WHERE home_id=?").run(now,homeId);
        const members=this.db.prepare("SELECT user_id FROM members WHERE home_id=? AND status='active'").all(homeId) as Row[];
        for(const member of members){const id=String(member.user_id);if(this.options.canAccess(homeId,id))this.db.prepare('INSERT OR IGNORE INTO stolen_lantern_rewards VALUES(?,?,?,?,NULL)').run(homeId,id,C.rewardApples,now);}
        return outcome('updated','Elsie’s lantern is home. Two apples await every member who belonged to the home at its return.');
      }
      if(request.action==='ward'){
        if(personal.wardUntil>now)return outcome('blocked','Lumen’s ward is already holding. It cannot be refreshed.');
        if(personal.wardReadyAt>now)return outcome('blocked','Lumen’s ward needs time to recover.');
        this.db.prepare('UPDATE stolen_lantern_personal SET revision=revision+1,ward_until=?,ward_ready_at=?,snare_until=0 WHERE home_id=? AND user_id=?').run(now+C.wardDurationMs,now+C.wardCooldownMs,homeId,userId);
        return outcome('updated','Lumen loosened the snare and set a twenty-second ward around you.');
      }
      if(request.action==='restitute'){
        const incident=this.one('SELECT * FROM stolen_lantern_incidents WHERE home_id=? AND user_id=? AND npc_id=?',homeId,userId,request.npcId!);
        if(!incident||incident.resolved_at!==null)return outcome('unchanged','There is no unresolved harm to make right with this neighbour.');
        const inventory=this.inventory(homeId,userId);
        if(inventory.revision!==request.expectedInventoryRevision)return outcome('inventory-conflict','Your apples changed. Refresh before making restitution.');
        if(inventory.apples<C.restitutionApples)return outcome('blocked','Restitution requires two apples for this neighbour.');
        this.changeApples(homeId,userId,-C.restitutionApples);
        this.db.prepare('UPDATE stolen_lantern_incidents SET resolved_at=? WHERE home_id=? AND user_id=? AND npc_id=?').run(now,homeId,userId,request.npcId!);
        this.bumpPersonal(homeId,userId);return outcome('updated','Two apples and an apology made this particular harm right.');
      }
      const reward=this.reward(homeId,userId);
      if(!reward)return outcome('blocked','There is no earned lantern reward waiting for you.');
      if(reward.claimed_at!==null)return outcome('unchanged','Elsie’s two-apple reward is already in your ledger.');
      const inventory=this.inventory(homeId,userId);
      if(inventory.revision!==request.expectedInventoryRevision)return outcome('inventory-conflict','Your apples changed. Elsie will keep the reward safe.');
      if(request.appleSlotAvailable!==true||inventory.apples+C.rewardApples>C.appleCapacity)return outcome('inventory-full','Make room for two apples. Elsie will keep your reward safe.');
      this.changeApples(homeId,userId,C.rewardApples);
      this.db.prepare('UPDATE stolen_lantern_rewards SET claimed_at=? WHERE home_id=? AND user_id=?').run(now,homeId,userId);
      this.bumpPersonal(homeId,userId);return outcome('updated','Elsie’s two apples are in your pocket. The lantern stays safely home.');
    });
  }

  /** Direct, verified harm only. These specific memories do not decay with
   * global reputation, ordinary gifts, NPC respawn, logout, or server restart. */
  recordIncident(homeId:string,userId:string,request:StolenLanternIncidentRequest):StolenLanternMutation {
    if(!request||!STOLEN_LANTERN_INCIDENT_NPCS.includes(request.npcId))return invalid('Unknown lantern neighbour.');
    return this.execute(homeId,userId,request.commandId,['incident',request.npcId],now=>{
      this.db.prepare('INSERT INTO stolen_lantern_incidents VALUES(?,?,?,?,NULL) ON CONFLICT(home_id,user_id,npc_id) DO UPDATE SET occurred_at=excluded.occurred_at,resolved_at=NULL').run(homeId,userId,request.npcId,now);
      this.bumpPersonal(homeId,userId);return outcome('updated','This neighbour remembers the harm until you make restitution to them.');
    });
  }

  /** One server-observed Morrow pulse. No client timestamp or duration is accepted. */
  snare(homeId:string,userId:string,eventId:string):StolenLanternMutation {
    return this.execute(homeId,userId,eventId,['snare'],now=>{
      const personal=this.personal(homeId,userId);
      if(personal.wardUntil>now)return outcome('blocked','Lumen’s ward turned Morrow’s snare aside.');
      if(personal.snareUntil>now)return outcome('unchanged','The existing snare cannot stack or extend.');
      this.db.prepare('UPDATE stolen_lantern_personal SET revision=revision+1,snare_until=? WHERE home_id=? AND user_id=?').run(now+C.snareDurationMs,homeId,userId);
      return outcome('updated','Morrow’s snare catches your feet for five seconds.');
    });
  }

  private execute(homeId:string,userId:string,commandId:string,detail:unknown[],apply:(now:number)=>Outcome):StolenLanternMutation {
    if(!key(commandId,160))return invalid('Invalid command identity.');
    return this.transaction(()=>{
      this.requireAccess(homeId,userId);this.ensure(homeId,userId);
      const hash=createHash('sha256').update(JSON.stringify(detail)).digest('hex'),now=this.now();
      const prior=this.one('SELECT * FROM stolen_lantern_receipts WHERE home_id=? AND user_id=? AND command_id=?',homeId,userId,commandId);
      if(prior){
        if(prior.payload_hash!==hash)throw new StolenLanternStoreError('EVENT_CONFLICT','That command ID already identifies a different lantern action.');
        const receipt=this.parseReceipt(prior.receipt_json,commandId);
        return {receipt,replayed:true,snapshot:this.snapshot(homeId,userId,now)};
      }
      // Validate all durable state before mutation, including existing shared inventory.
      this.snapshot(homeId,userId,now);
      const result=apply(now),snapshot=this.snapshot(homeId,userId,now);
      const receipt:StolenLanternReceipt={commandId,...result,at:now,inventoryRevision:snapshot.personal.inventory.revision};
      this.db.prepare('INSERT INTO stolen_lantern_receipts VALUES(?,?,?,?,?)').run(homeId,userId,commandId,hash,JSON.stringify(receipt));
      return {receipt,replayed:false,snapshot};
    });
  }
  private snapshot(homeId:string,userId:string,now:number):StolenLanternSnapshot {
    const shared=this.shared(homeId),personal=this.personal(homeId,userId),inventory=this.inventory(homeId,userId),reward=this.reward(homeId,userId);
    if(reward&&shared.stage!=='complete')return corrupt();
    const incidents=(this.db.prepare('SELECT * FROM stolen_lantern_incidents WHERE home_id=? AND user_id=? ORDER BY occurred_at,npc_id').all(homeId,userId) as Row[]).map(row=>{
      if(!STOLEN_LANTERN_INCIDENT_NPCS.includes(String(row.npc_id))||!integer(row.occurred_at,1)||(row.resolved_at!==null&&!integer(row.resolved_at,Number(row.occurred_at))))return corrupt();
      return {npcId:String(row.npc_id),reason:'You struck this neighbour. Make restitution directly to them.',at:row.occurred_at,resolvedAt:row.resolved_at===null?0:Number(row.resolved_at)} satisfies StolenLanternIncident;
    });
    return {serverTime:now,quest:{revision:shared.revision,stage:shared.stage,title:C.title,...STOLEN_LANTERN_JOURNAL[shared.stage],custody:shared.stage==='complete'?'returned':shared.stage==='return-lantern'?'home':'missing',...(shared.recoveredBy?{recoveredBy:shared.recoveredBy}:{}),...(shared.returnedAt!==null?{returnedAt:shared.returnedAt}:{})},personal:{...personal,inventory,incidents,reward:!reward?'unavailable':reward.claimed_at===null?'pending':'claimed'}};
  }
  private ensure(homeId:string,userId:string){
    this.db.prepare('INSERT OR IGNORE INTO forest_adventure_inventory VALUES(?,?,1,1,0)').run(homeId,userId);
    this.db.prepare("INSERT OR IGNORE INTO stolen_lantern_state VALUES(?,1,1,'quiet',NULL,NULL)").run(homeId);
    this.db.prepare('INSERT OR IGNORE INTO stolen_lantern_personal VALUES(?,?,1,1,0,0,0)').run(homeId,userId);
  }
  private shared(homeId:string):Shared {
    const row=this.one('SELECT * FROM stolen_lantern_state WHERE home_id=?',homeId)!;
    if(row.version!==1)throw new StolenLanternStoreError('UNSUPPORTED_VERSION','Shared lantern storage needs an explicit migration.');
    if(!integer(row.revision,1)||typeof row.stage!=='string'||!Object.prototype.hasOwnProperty.call(STOLEN_LANTERN_JOURNAL,row.stage))return corrupt();
    const stage=row.stage as StolenLanternStage,recovered=stage==='return-lantern'||stage==='complete';
    if(recovered?!key(row.recovered_by):row.recovered_by!==null)return corrupt();
    if(stage==='complete'?!integer(row.returned_at,1):row.returned_at!==null)return corrupt();
    return {revision:row.revision,stage,recoveredBy:row.recovered_by===null?null:String(row.recovered_by),returnedAt:row.returned_at===null?null:Number(row.returned_at)};
  }
  private personal(homeId:string,userId:string):Personal {
    const row=this.one('SELECT * FROM stolen_lantern_personal WHERE home_id=? AND user_id=?',homeId,userId)!;
    if(row.version!==1)throw new StolenLanternStoreError('UNSUPPORTED_VERSION','Personal lantern storage needs an explicit migration.');
    if(!integer(row.revision,1)||!integer(row.ward_until)||!integer(row.ward_ready_at)||!integer(row.snare_until)||(row.ward_until>0&&row.ward_ready_at-row.ward_until!==C.wardCooldownMs-C.wardDurationMs)||(row.ward_until===0&&row.ward_ready_at!==0))return corrupt();
    return {revision:row.revision,wardUntil:row.ward_until,wardReadyAt:row.ward_ready_at,snareUntil:row.snare_until};
  }
  private inventory(homeId:string,userId:string):{apples:number;revision:number}{
    const row=this.one('SELECT * FROM forest_adventure_inventory WHERE home_id=? AND user_id=?',homeId,userId)!;
    if(row.version!==1)throw new StolenLanternStoreError('UNSUPPORTED_VERSION','Inventory needs an explicit migration.');
    if(!integer(row.revision,1)||!integer(row.apples,0,C.appleCapacity))return corrupt();
    return {apples:row.apples,revision:row.revision};
  }
  private reward(homeId:string,userId:string):Row|undefined {
    const row=this.one('SELECT * FROM stolen_lantern_rewards WHERE home_id=? AND user_id=?',homeId,userId);
    if(row&&(row.apples!==C.rewardApples||!integer(row.earned_at,1)||(row.claimed_at!==null&&!integer(row.claimed_at,Number(row.earned_at)))))return corrupt();
    return row;
  }
  private parseReceipt(raw:unknown,commandId:string):StolenLanternReceipt {
    let value:StolenLanternReceipt;try{value=JSON.parse(String(raw));}catch{return corrupt();}
    if(!value||value.commandId!==commandId||!['updated','unchanged','blocked','inventory-conflict','inventory-full'].includes(value.status)||!key(value.message,500)||!integer(value.at,1)||!integer(value.inventoryRevision,1))return corrupt();
    return value;
  }
  private stage(homeId:string,stage:StolenLanternStage){this.db.prepare('UPDATE stolen_lantern_state SET stage=?,revision=revision+1 WHERE home_id=?').run(stage,homeId);}
  private bumpPersonal(homeId:string,userId:string){this.db.prepare('UPDATE stolen_lantern_personal SET revision=revision+1 WHERE home_id=? AND user_id=?').run(homeId,userId);}
  private changeApples(homeId:string,userId:string,amount:number){this.db.prepare('UPDATE forest_adventure_inventory SET apples=apples+?,revision=revision+1 WHERE home_id=? AND user_id=?').run(amount,homeId,userId);}
  private requireAccess(homeId:string,userId:string){if(!key(homeId)||!key(userId)||!this.options.canAccess(homeId,userId))throw new StolenLanternStoreError('ACCESS_DENIED','Current canonical home membership is required.');}
  private now(){const now=(this.options.now??Date.now)();if(!integer(now,1,Number.MAX_SAFE_INTEGER-C.wardCooldownMs))return invalid('Invalid authoritative clock.');return now;}
  private one(sql:string,...params:(string|number)[]):Row|undefined{return this.db.prepare(sql).get(...params) as Row|undefined;}
  private transaction<T>(fn:()=>T):T {
    // A room may commit reputation and a specific incident together. Releasing
    // our savepoint never commits the caller's transaction or earlier writes.
    const savepoint=this.db.isTransaction?`stolen_lantern_${randomUUID().replaceAll('-','')}`:null;
    this.db.exec(savepoint?`SAVEPOINT ${savepoint}`:'BEGIN IMMEDIATE');
    try{
      const result=fn();
      this.db.exec(savepoint?`RELEASE SAVEPOINT ${savepoint}`:'COMMIT');
      return result;
    }catch(error){
      // SQLite can itself end a transaction for a fatal error; preserve that
      // original error rather than attempting a rollback on a closed scope.
      if(this.db.isTransaction){
        if(savepoint){this.db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);this.db.exec(`RELEASE SAVEPOINT ${savepoint}`);}
        else this.db.exec('ROLLBACK');
      }
      throw error;
    }
  }
}
