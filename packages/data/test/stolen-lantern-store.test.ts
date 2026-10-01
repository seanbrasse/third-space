import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, type ChildProcess } from 'node:child_process';
import { LocalStore } from '../src/index';
import { SharedForestStoryStore } from '../src/forest-story-store';
import { LivingWorldStore } from '../src/living-world-store';
import { StolenLanternStore } from '../src/stolen-lantern-store';
import { STOLEN_LANTERN_CONFIG, STOLEN_LANTERN_RECIPIENTS } from '../../config/src/stolen-lantern';
import { LANTERN_CAVE_ANCHOR } from '../../config/src/lantern-cave';
import type { StolenLanternAction, StolenLanternActionRequest } from '../../contracts/src/stolen-lantern';

const stores:LocalStore[]=[],dirs:string[]=[];
afterEach(()=>{stores.splice(0).forEach(store=>store.close());dirs.splice(0).forEach(dir=>rmSync(dir,{recursive:true,force:true}));});
function fixture(disk=false){
  const dir=disk?mkdtempSync(join(tmpdir(),'third-space-stolen-lantern-')):null;if(dir)dirs.push(dir);
  const path=dir?join(dir,'lantern.sqlite'):':memory:',store=new LocalStore({path});stores.push(store);
  const user=store.createIdentity({name:'Lantern host'}).profile.id,home=store.createHome(user,{name:'Stolen Lantern',pin:'123456'}).id;
  let now=1_000_000,serial=0;
  const clock=()=>now,canAccess=(h:string,u:string)=>store.canAccess(h,u);
  const lantern=new StolenLanternStore(store.db,{canAccess,now:clock});
  const story=new SharedForestStoryStore(store.db,{canAccess,now:clock,chooseCulprit:()=> 'goblin-nib'});
  const read=(id=user)=>lantern.read(home,id),command=()=>`lantern-test-${++serial}`;
  const act=(action:StolenLanternAction,id=user,extra:Partial<StolenLanternActionRequest>={})=>lantern.act(home,id,{commandId:command(),action,...(action==='recover'?{}:{npcId:STOLEN_LANTERN_RECIPIENTS[action][0]}),...(['claim','restitute'].includes(action)?{expectedInventoryRevision:read(id).personal.inventory.revision}:{}),appleSlotAvailable:true,...extra});
  const member=()=>{const id=store.createIdentity({name:'Neighbour'}).profile.id;store.joinHome(home,id,{pin:'123456'});return id;};
  const apples=(count=5,id=user)=>{
    let s=story.read(home,id);
    while(s.personal.inventory.apples<count)s=story.changeApples(home,id,{before:s.personal.inventory.apples,after:s.personal.inventory.apples+1,expectedRevision:s.personal.inventory.revision,cause:'harvest'}).snapshot;
    while(s.personal.inventory.apples>count)s=story.changeApples(home,id,{before:s.personal.inventory.apples,after:s.personal.inventory.apples-1,expectedRevision:s.personal.inventory.revision,cause:'eat'}).snapshot;
    return s.personal.inventory;
  };
  const complete=()=>{act('begin');act('ask-pip');act('recover');return act('return');};
  const incident=(npcId:string,commandId=command(),id=user)=>lantern.recordIncident(home,id,{commandId,npcId});
  const reopen=()=>{stores.splice(stores.indexOf(store),1);store.close();const reopened=new LocalStore({path});stores.push(reopened);return {store:reopened,lantern:new StolenLanternStore(reopened.db,{canAccess:(h,u)=>reopened.canAccess(h,u),now:clock})};};
  return {store,lantern,story,user,home,path,clock,read,command,act,member,apples,complete,incident,reopen,advance:(ms:number)=>{now+=ms;}};
}

async function race(path:string,home:string,user:string,bodies:string[]):Promise<any[]>{
  const children:ChildProcess[]=[];
  try{
    const workers=bodies.map(body=>{
      const code=`import {DatabaseSync} from 'node:sqlite';
        import {StolenLanternStore} from ${JSON.stringify(new URL('../src/stolen-lantern-store.ts',import.meta.url).href)};
        const db=new DatabaseSync(process.env.LANTERN_DB);db.exec('PRAGMA busy_timeout=5000;PRAGMA foreign_keys=ON');
        const lantern=new StolenLanternStore(db,{canAccess:(h,u)=>!!db.prepare("SELECT 1 FROM members WHERE home_id=? AND user_id=? AND status='active'").get(h,u),now:()=>1000000});
        const home=process.env.LANTERN_HOME,user=process.env.LANTERN_USER;
        process.send({ready:true});process.on('message',()=>{try{const result=(()=>{${body}})();process.send({result});db.close();process.exit(0);}catch(error){process.send({error:String(error)});process.exit(1);}});`;
      const child=spawn(process.execPath,['--import','tsx','--input-type=module','-e',code],{cwd:fileURLToPath(new URL('../../../',import.meta.url)),stdio:['ignore','ignore','pipe','ipc'],env:{...process.env,LANTERN_DB:path,LANTERN_HOME:home,LANTERN_USER:user}});
      children.push(child);let stderr='',started=false,delivered=false;
      child.stderr!.on('data',data=>{stderr+=data.toString();});
      const ready=new Promise<void>((resolve,reject)=>{child.on('message',message=>{if((message as any).ready){started=true;resolve();}});child.on('error',reject);child.on('exit',code=>{if(!started)reject(new Error(`Lantern worker exited ${code}: ${stderr}`));});});
      const result=new Promise<any>((resolve,reject)=>{child.on('message',message=>{const m=message as any;if(m.error)reject(new Error(m.error));if(m.result){delivered=true;resolve(m.result);}});child.on('error',reject);child.on('exit',code=>{if(!delivered)reject(new Error(`Lantern worker exited ${code}: ${stderr}`));});});
      return {child,ready,result};
    });
    await Promise.all(workers.map(worker=>worker.ready));workers.forEach(worker=>worker.child.send('go'));return await Promise.all(workers.map(worker=>worker.result));
  }finally{children.forEach(child=>{if(child.exitCode===null)child.kill();});}
}

describe('Stolen Lantern durable shared quest',()=>{
  it('adds its own schema, starts quiet, uses the interior recovery anchor and exposes no mystery or personal lantern',()=>{
    const f=fixture(),schema=f.store.db.prepare('PRAGMA user_version').get(),s=f.read();
    expect(s.quest).toMatchObject({stage:'quiet',custody:'missing',objective:'',location:''});
    expect(s.personal.inventory).toEqual({apples:0,revision:1});expect(s.personal.reward).toBe('unavailable');
    expect(JSON.stringify(s)).not.toMatch(/culprit|private_json|confirmedFace|goblin-nib|potions|lanternCount/);
    expect(f.store.db.prepare('PRAGMA user_version').get()).toEqual(schema);
    expect(STOLEN_LANTERN_CONFIG.recoveryPoint).toBe(LANTERN_CAVE_ANCHOR);
    expect(STOLEN_LANTERN_CONFIG.recoveryPoint).toEqual({x:9,y:5.5});expect(STOLEN_LANTERN_CONFIG.recoveryRange).toBe(1.8);
  });
  it('shares every finite step and lets another member return the home’s one recovered lantern',()=>{
    const f=fixture(),other=f.member();
    expect(f.act('begin').snapshot.quest.stage).toBe('ask-pip');
    expect(f.act('ask-pip',other).snapshot.quest.stage).toBe('find-cave');
    const recovered=f.act('recover');
    expect(recovered.snapshot.quest).toMatchObject({stage:'return-lantern',custody:'home',recoveredBy:f.user});
    expect(f.read(other).quest).toEqual(recovered.snapshot.quest);
    expect(f.act('recover',other).receipt.status).toBe('unchanged');
    expect(f.act('return',other).snapshot.quest).toMatchObject({stage:'complete',custody:'returned',recoveredBy:f.user,returnedAt:f.clock()});
    expect(f.act('return').receipt.status).toBe('unchanged');
    expect(f.read().personal.inventory.apples).toBe(0);expect(f.read(other).personal.inventory.apples).toBe(0);
    expect(f.story.read(f.home,f.user).story.chapter).toBe('undiscovered');
  });
  it('blocks missing prerequisites permanently for that command, and rejects recipient/enum/price forgery',()=>{
    const f=fixture();
    const early={commandId:'early-recover',action:'recover' as const};
    expect(f.lantern.act(f.home,f.user,early).receipt.status).toBe('blocked');
    expect(f.act('return').receipt.status).toBe('blocked');
    f.act('begin');f.act('ask-pip');
    expect(f.lantern.act(f.home,f.user,early).replayed).toBe(true);expect(f.read().quest.stage).toBe('find-cave');
    for(const request of [{action:'begin',npcId:'goblin-pip'},{action:'ask-pip',npcId:'washer-elsie'},{action:'ward',npcId:'spirit-morrow'},{action:'recover',npcId:'washer-elsie'},{action:'complete',npcId:'washer-elsie'},{action:new String('claim'),npcId:'washer-elsie'}])expect(()=>f.lantern.act(f.home,f.user,{commandId:f.command(),...request} as StolenLanternActionRequest)).toThrowError(expect.objectContaining({code:'INVALID_EVENT'}));
    f.act('recover');f.act('return');
    const revision=f.read().personal.inventory.revision;
    const forged={commandId:'fixed-reward',action:'claim',npcId:'washer-elsie',expectedInventoryRevision:revision,appleSlotAvailable:true,apples:999,price:-1} as unknown as StolenLanternActionRequest;
    expect(f.lantern.act(f.home,f.user,forged).snapshot.personal.inventory.apples).toBe(2);
  });
  it('grants all admitted members including offline members once, excludes later joins and leaves full claims pending',()=>{
    const f=fixture(),offline=f.member();f.complete();
    expect(f.read(offline).personal.reward).toBe('pending');
    const later=f.member();expect(f.read(later).quest.stage).toBe('complete');expect(f.read(later).personal.reward).toBe('unavailable');
    f.apples(4);expect(f.act('claim').receipt.status).toBe('inventory-full');expect(f.read().personal.reward).toBe('pending');
    f.apples(3);expect(f.act('claim',f.user,{appleSlotAvailable:false}).receipt.status).toBe('inventory-full');
    const before=f.read().personal.inventory,result=f.act('claim');
    expect(result.snapshot.personal.inventory).toEqual({apples:5,revision:before.revision+1});expect(result.snapshot.personal.reward).toBe('claimed');
    expect(f.act('claim').receipt.status).toBe('unchanged');expect(f.read().personal.inventory.apples).toBe(5);
    expect(f.story.read(f.home,f.user).personal.inventory).toEqual(result.snapshot.personal.inventory);
    expect(f.act('claim',offline).snapshot.personal.inventory.apples).toBe(2);
  });
  it('restores exact shared custody and immutable reward receipts after SQLite reopen',()=>{
    const f=fixture(true);f.complete();
    const request={commandId:'claim-once',action:'claim' as const,npcId:'washer-elsie',expectedInventoryRevision:f.read().personal.inventory.revision,appleSlotAvailable:true};
    const first=f.lantern.act(f.home,f.user,request),reopened=f.reopen();f.advance(300_000);
    const replay=reopened.lantern.act(f.home,f.user,{...request,appleSlotAvailable:false});
    expect(replay.replayed).toBe(true);expect(replay.receipt).toEqual(first.receipt);expect(replay.snapshot.quest).toEqual(first.snapshot.quest);
    expect(replay.snapshot.personal.inventory).toEqual(first.snapshot.personal.inventory);
    expect(()=>reopened.lantern.act(f.home,f.user,{...request,action:'begin'})).toThrowError(expect.objectContaining({code:'EVENT_CONFLICT'}));
  });
  it('preserves a pending reward on a stale revision and atomically rolls back a failed reward write',()=>{
    const f=fixture();f.complete();const before=f.read();
    expect(f.act('claim',f.user,{expectedInventoryRevision:before.personal.inventory.revision+1}).receipt.status).toBe('inventory-conflict');
    f.store.db.exec("CREATE TRIGGER reject_lantern_reward BEFORE UPDATE ON stolen_lantern_rewards BEGIN SELECT RAISE(ABORT,'reward failure'); END");
    const request={commandId:'rollback-claim',action:'claim' as const,npcId:'washer-elsie',expectedInventoryRevision:before.personal.inventory.revision,appleSlotAvailable:true};
    expect(()=>f.lantern.act(f.home,f.user,request)).toThrow('reward failure');
    expect(f.read().personal.inventory).toEqual(before.personal.inventory);expect(f.read().personal.reward).toBe('pending');
    expect(f.store.db.prepare('SELECT 1 FROM stolen_lantern_receipts WHERE command_id=?').get('rollback-claim')).toBeUndefined();
    f.store.db.exec('DROP TRIGGER reject_lantern_reward');expect(f.lantern.act(f.home,f.user,request).receipt.status).toBe('updated');
  });
  it('serializes simultaneous shared recovery from separate SQLite processes without cloning the lantern',async()=>{
    const f=fixture(true),other=f.member();f.act('begin');f.act('ask-pip');
    const results=await race(f.path,f.home,f.user,[f.user,other].map((id,n)=>`return lantern.act(home,${JSON.stringify(id)},{commandId:'recover-${n}',action:'recover'});`));
    expect(results.map(result=>result.receipt.status).sort()).toEqual(['unchanged','updated']);
    expect(f.read().quest.stage).toBe('return-lantern');expect([f.user,other]).toContain(f.read().quest.recoveredBy);
    expect(f.read(other).quest).toEqual(f.read().quest);
    expect(f.read().personal.inventory.apples+f.read(other).personal.inventory.apples).toBe(0);
  });
  it('serializes concurrent reward claims and replays a raced identical command with a single apple grant',async()=>{
    const f=fixture(true);f.complete();
    const request={commandId:'same-claim',action:'claim',npcId:'washer-elsie',expectedInventoryRevision:f.read().personal.inventory.revision,appleSlotAvailable:true};
    const body=`return lantern.act(home,user,${JSON.stringify(request)});`;
    const same=await race(f.path,f.home,f.user,[body,body]);
    expect(same.map(result=>result.replayed).sort()).toEqual([false,true]);expect(same[0].receipt).toEqual(same[1].receipt);
    const again=await race(f.path,f.home,f.user,[0,1].map(n=>`return lantern.act(home,user,${JSON.stringify({...request,commandId:`another-${n}`})});`));
    expect(again.every(result=>result.receipt.status==='unchanged')).toBe(true);expect(f.read().personal.inventory.apples).toBe(2);
  });
});

describe('Stolen Lantern personal magic and enduring incidents',()=>{
  it('joins an outer transaction without committing incident state or its receipt before the caller',()=>{
    const f=fixture(),before=f.read();
    f.store.db.exec('CREATE TABLE transaction_owner_markers(label TEXT PRIMARY KEY)');
    f.store.db.exec('BEGIN IMMEDIATE');
    f.store.db.prepare('INSERT INTO transaction_owner_markers VALUES(?)').run('caller-before-incident');
    const recorded=f.incident('washer-elsie','outer-incident');
    expect(recorded.receipt.status).toBe('updated');expect(f.store.db.isTransaction).toBe(true);
    // Even a read inside the caller's transaction must release only its own scope.
    expect(f.read().personal.incidents).toHaveLength(1);expect(f.store.db.isTransaction).toBe(true);
    f.store.db.exec('ROLLBACK');
    expect(f.store.db.isTransaction).toBe(false);expect(f.read().personal).toEqual(before.personal);
    expect(f.store.db.prepare('SELECT count(*) AS n FROM transaction_owner_markers').get()!.n).toBe(0);
    expect(f.store.db.prepare('SELECT 1 FROM stolen_lantern_receipts WHERE command_id=?').get('outer-incident')).toBeUndefined();
    expect(f.incident('washer-elsie','outer-incident').replayed).toBe(false);
  });
  it('rolls back only its savepoint after a partial failure and leaves caller writes and transaction usable',()=>{
    const f=fixture(),before=f.read();
    f.store.db.exec('CREATE TABLE transaction_owner_markers(label TEXT PRIMARY KEY)');
    // Fail after the incident and personal revision were written, at receipt insertion.
    f.store.db.exec("CREATE TRIGGER reject_incident_receipt BEFORE INSERT ON stolen_lantern_receipts BEGIN SELECT RAISE(ABORT,'incident receipt failure'); END");
    f.store.db.exec('BEGIN IMMEDIATE');
    f.store.db.prepare('INSERT INTO transaction_owner_markers VALUES(?)').run('before-failed-incident');
    expect(()=>f.incident('goblin-pip','retryable-incident')).toThrow('incident receipt failure');
    expect(f.store.db.isTransaction).toBe(true);expect(f.read().personal).toEqual(before.personal);
    expect(f.store.db.prepare('SELECT count(*) AS n FROM transaction_owner_markers').get()!.n).toBe(1);
    expect(f.store.db.prepare('SELECT count(*) AS n FROM stolen_lantern_receipts').get()!.n).toBe(0);
    f.store.db.prepare('INSERT INTO transaction_owner_markers VALUES(?)').run('after-failed-incident');
    f.store.db.exec('COMMIT');
    expect(f.store.db.prepare('SELECT count(*) AS n FROM transaction_owner_markers').get()!.n).toBe(2);
    f.store.db.exec('DROP TRIGGER reject_incident_receipt');
    const retried=f.incident('goblin-pip','retryable-incident');
    expect(retried.receipt.status).toBe('updated');expect(retried.replayed).toBe(false);
    expect(f.store.db.isTransaction).toBe(false);
  });
  it('keeps ordinary top-level and nested replay behavior while preserving caller-owned commit boundaries',()=>{
    const f=fixture();expect(f.store.db.isTransaction).toBe(false);
    const first=f.incident('spirit-lumen','same-incident');expect(f.store.db.isTransaction).toBe(false);
    const topReplay=f.incident('spirit-lumen','same-incident');
    expect(topReplay.replayed).toBe(true);expect(topReplay.receipt).toEqual(first.receipt);expect(f.store.db.isTransaction).toBe(false);
    f.store.db.exec('BEGIN IMMEDIATE');
    const nested=new StolenLanternStore(f.store.db,{canAccess:(h,u)=>f.store.canAccess(h,u),now:f.clock});
    const replay=nested.recordIncident(f.home,f.user,{commandId:'same-incident',npcId:'spirit-lumen'});
    expect(replay.replayed).toBe(true);expect(replay.receipt).toEqual(first.receipt);expect(f.store.db.isTransaction).toBe(true);
    const next=nested.recordIncident(f.home,f.user,{commandId:'second-incident',npcId:'washer-elsie'});
    expect(next.snapshot.personal.incidents).toHaveLength(2);expect(f.store.db.isTransaction).toBe(true);
    f.store.db.exec('COMMIT');
    expect(f.read().personal.incidents).toHaveLength(2);expect(f.store.db.isTransaction).toBe(false);
    expect(f.store.db.prepare('SELECT count(*) AS n FROM stolen_lantern_receipts').get()!.n).toBe(2);
  });
  it('persists the original snare and ward deadlines across reopen, rejects stacking and clears snares with a ward',()=>{
    const f=fixture(true),snared=f.lantern.snare(f.home,f.user,'pulse-one');
    expect(snared.snapshot.personal.snareUntil).toBe(f.clock()+5_000);
    f.advance(1_000);expect(f.lantern.snare(f.home,f.user,'pulse-two').receipt.status).toBe('unchanged');
    expect(f.read().personal.snareUntil).toBe(snared.snapshot.personal.snareUntil);
    const wardRequest={commandId:'ward-once',action:'ward' as const,npcId:'spirit-lumen'};
    const ward=f.lantern.act(f.home,f.user,wardRequest);
    expect(ward.snapshot.personal).toMatchObject({wardUntil:f.clock()+20_000,wardReadyAt:f.clock()+60_000,snareUntil:0});
    f.advance(10_000);expect(f.act('ward').receipt.status).toBe('blocked');
    expect(f.lantern.snare(f.home,f.user,'warded-pulse').receipt.status).toBe('blocked');
    const reopened=f.reopen();
    expect(reopened.lantern.act(f.home,f.user,wardRequest).receipt).toEqual(ward.receipt);
    expect(reopened.lantern.read(f.home,f.user).personal.wardUntil).toBe(ward.snapshot.personal.wardUntil);
    f.advance(10_000);
    expect(reopened.lantern.snare(f.home,f.user,'expiry-pulse').receipt.status).toBe('updated');
    expect(reopened.lantern.act(f.home,f.user,{...wardRequest,commandId:'cooldown-ward'}).receipt.status).toBe('blocked');
    f.advance(40_000);
    expect(reopened.lantern.act(f.home,f.user,{...wardRequest,commandId:'next-ward'}).receipt.status).toBe('updated');
    expect(reopened.lantern.snare(f.home,f.user,'pulse-one').replayed).toBe(true);
    expect(reopened.lantern.read(f.home,f.user).personal.snareUntil).toBe(0);
  });
  it('lets a new snare begin exactly at expiry without retroactively replaying an old pulse',()=>{
    const f=fixture(),first=f.lantern.snare(f.home,f.user,'first');f.advance(5_000);
    const replay=f.lantern.snare(f.home,f.user,'first');expect(replay.replayed).toBe(true);expect(replay.snapshot.personal.snareUntil).toBe(first.snapshot.personal.snareUntil);
    expect(f.lantern.snare(f.home,f.user,'new-pulse').snapshot.personal.snareUntil).toBe(f.clock()+5_000);
    expect(()=>f.lantern.recordIncident(f.home,f.user,{commandId:'first',npcId:'spirit-lumen'})).toThrowError(expect.objectContaining({code:'EVENT_CONFLICT'}));
  });
  it('remembers harm to each specific NPC indefinitely while other members and neighbours remain unaffected',()=>{
    const f=fixture(true),other=f.member();
    f.incident('washer-elsie','elsie-hit');f.incident('spirit-lumen','lumen-hit');
    expect(f.act('begin').receipt.status).toBe('blocked');expect(f.act('ward').receipt.status).toBe('blocked');
    expect(f.act('begin',other).receipt.status).toBe('updated');expect(f.act('ask-pip').receipt.status).toBe('updated');
    f.advance(86_400_000);const reopened=f.reopen(),snapshot=reopened.lantern.read(f.home,f.user);
    expect(snapshot.personal.incidents).toHaveLength(2);expect(snapshot.personal.incidents.every(incident=>incident.resolvedAt===0)).toBe(true);
    expect(reopened.lantern.read(f.home,other).personal.incidents).toEqual([]);
    expect(reopened.lantern.act(f.home,f.user,{commandId:'still-hurt',action:'ward',npcId:'spirit-lumen'}).receipt.status).toBe('blocked');
  });
  it('atomically pays restitution for only one NPC and does not alter ordinary living-world reputation or effects',()=>{
    const f=fixture(),living=new LivingWorldStore(f.store.db,{canAccess:(h,u)=>f.store.canAccess(h,u),now:f.clock});
    living.witnessAttack(f.home,f.user,{commandId:'ordinary-harm',targetNpcId:'washer-elsie',witnessNpcIds:[]});
    const livingBefore=f.store.db.prepare('SELECT * FROM living_world_personal WHERE home_id=? AND user_id=?').get(f.home,f.user);
    f.incident('washer-elsie','specific-elsie');f.incident('goblin-pip','specific-pip');f.apples(5);
    const before=f.read().personal.inventory,request={commandId:'make-elsie-right',action:'restitute' as const,npcId:'washer-elsie',expectedInventoryRevision:before.revision};
    const result=f.lantern.act(f.home,f.user,request);
    expect(result.snapshot.personal.inventory).toEqual({apples:3,revision:before.revision+1});
    expect(result.snapshot.personal.incidents.find(incident=>incident.npcId==='washer-elsie')!.resolvedAt).toBe(f.clock());
    expect(result.snapshot.personal.incidents.find(incident=>incident.npcId==='goblin-pip')!.resolvedAt).toBe(0);
    expect(f.act('begin').receipt.status).toBe('updated');expect(f.act('ask-pip').receipt.status).toBe('blocked');
    expect(f.lantern.act(f.home,f.user,request).replayed).toBe(true);expect(f.read().personal.inventory.apples).toBe(3);
    expect(f.incident('washer-elsie','specific-elsie').replayed).toBe(true);
    expect(f.read().personal.incidents.find(incident=>incident.npcId==='washer-elsie')!.resolvedAt).toBe(f.clock());
    expect(f.store.db.prepare('SELECT * FROM living_world_personal WHERE home_id=? AND user_id=?').get(f.home,f.user)).toEqual(livingBefore);
    f.advance(1);f.incident('washer-elsie');expect(f.read().personal.incidents.find(incident=>incident.npcId==='washer-elsie')!.resolvedAt).toBe(0);
  });
  it('rejects stale or unaffordable restitution and rolls back payment if incident resolution fails',()=>{
    const f=fixture();f.incident('washer-elsie');
    expect(f.act('restitute').receipt.status).toBe('blocked');f.apples(5);const before=f.read().personal.inventory;
    expect(f.act('restitute',f.user,{expectedInventoryRevision:before.revision-1}).receipt.status).toBe('inventory-conflict');
    f.store.db.exec("CREATE TRIGGER reject_restitution BEFORE UPDATE ON stolen_lantern_incidents BEGIN SELECT RAISE(ABORT,'restitution failure'); END");
    expect(()=>f.act('restitute')).toThrow('restitution failure');expect(f.read().personal.inventory).toEqual(before);expect(f.read().personal.incidents[0]!.resolvedAt).toBe(0);
    f.store.db.exec('DROP TRIGGER reject_restitution');expect(f.act('restitute').snapshot.personal.inventory.apples).toBe(3);
  });
  it('serializes simultaneous restitution without charging twice',async()=>{
    const f=fixture(true);f.incident('washer-elsie');f.apples(5);const revision=f.read().personal.inventory.revision;
    const results=await race(f.path,f.home,f.user,[0,1].map(n=>`return lantern.act(home,user,${JSON.stringify({commandId:`restitute-${n}`,action:'restitute',npcId:'washer-elsie',expectedInventoryRevision:revision})});`));
    expect(results.map(result=>result.receipt.status).sort()).toEqual(['unchanged','updated']);expect(f.read().personal.inventory).toEqual({apples:3,revision:revision+1});
  });
  it('checks current membership on every public operation and replay, and rejects unknown incident identities',()=>{
    const f=fixture(),request={commandId:'begin-once',action:'begin' as const,npcId:'washer-elsie'};f.lantern.act(f.home,f.user,request);
    const denied=new StolenLanternStore(f.store.db,{canAccess:()=>false,now:f.clock});
    for(const call of [()=>denied.read(f.home,f.user),()=>denied.act(f.home,f.user,request),()=>denied.recordIncident(f.home,f.user,{commandId:'harm',npcId:'washer-elsie'}),()=>denied.snare(f.home,f.user,'pulse')])expect(call).toThrowError(expect.objectContaining({code:'ACCESS_DENIED'}));
    const stranger=f.store.createIdentity({name:'Stranger'}).profile.id;
    expect(()=>f.lantern.read(f.home,stranger)).toThrowError(expect.objectContaining({code:'ACCESS_DENIED'}));
    for(const npcId of ['keeper-ada','spirit-morrow','npc:washer-elsie','arbitrary'])expect(()=>f.incident(npcId)).toThrowError(expect.objectContaining({code:'INVALID_EVENT'}));
    expect(()=>f.act('claim',f.user,{expectedInventoryRevision:NaN})).toThrowError(expect.objectContaining({code:'INVALID_EVENT'}));
  });
  it('fails closed on version, timer, custody and receipt corruption without granting resources',()=>{
    const f=fixture();f.read();
    f.store.db.prepare('UPDATE stolen_lantern_personal SET ward_until=100,ward_ready_at=100 WHERE home_id=?').run(f.home);
    expect(()=>f.read()).toThrowError(expect.objectContaining({code:'CORRUPT_STATE'}));
    f.store.db.prepare('UPDATE stolen_lantern_personal SET ward_until=0,ward_ready_at=0 WHERE home_id=?').run(f.home);
    f.store.db.prepare("UPDATE stolen_lantern_state SET stage='return-lantern' WHERE home_id=?").run(f.home);
    expect(()=>f.read()).toThrowError(expect.objectContaining({code:'CORRUPT_STATE'}));
    f.store.db.prepare("UPDATE stolen_lantern_state SET stage='quiet',version=99 WHERE home_id=?").run(f.home);
    expect(()=>f.read()).toThrowError(expect.objectContaining({code:'UNSUPPORTED_VERSION'}));
    f.store.db.prepare('UPDATE stolen_lantern_state SET version=1 WHERE home_id=?').run(f.home);
    const request={commandId:'receipt-bound',action:'ward' as const,npcId:'spirit-lumen'};f.lantern.act(f.home,f.user,request);
    f.store.db.prepare('UPDATE stolen_lantern_receipts SET receipt_json=? WHERE command_id=?').run('{}',request.commandId);
    expect(()=>f.lantern.act(f.home,f.user,request)).toThrowError(expect.objectContaining({code:'CORRUPT_STATE'}));
  });
});
