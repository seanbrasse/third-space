import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {PartyRoom} from '../../apps/game-server/src/PartyRoom';
import {ForestNPCController} from '../../apps/game-server/src/ForestNPCController';
import {ForestCombatEncounters} from '../../apps/game-server/src/ForestCombatEncounters';
import type {SurvivalInventory} from '../../apps/game-server/src/survival-inventory';
import {LocalStore} from '../../packages/data/src/index';
import {SharedForestStoryStore} from '../../packages/data/src/forest-story-store';
import {FOREST_INTERIORS,WARD_CACHE_ANCHORS} from '../../packages/config/src/authored-forest';
import {getWorld,type Point} from '../../packages/config/src/index';
import {isHomeSegmentWalkable,isHomeWalkable} from '../../packages/simulation/src/index';
import {STORY_GUARDIAN,STORY_RAIDERS,STORY_REWARDS,STORY_SUSPECTS} from '../../packages/simulation/src/forest-story';
import type {PlayerState,RoomSnapshot} from '../../packages/contracts/src/index';
import type {ForestStorySnapshot} from '../../packages/contracts/src/forest-story';
import type {ForestMob} from '../../packages/contracts/src/forest-mobs';

type Client=Parameters<PartyRoom['onJoin']>[0];
interface Authority {
  npcs:ForestNPCController;
  combat:ForestCombatEncounters;
  survival:SurvivalInventory;
  encounter:unknown;
  werewolf:unknown;
  mimic:unknown;
  sendSnapshots():void;
}
let store:LocalStore,storyStore:SharedForestStoryStore,room:PartyRoom,clients:Client[],ids:string[],homeId:string,serial:number;
let command:(client:Client,raw:unknown)=>void,tick:(ms:number)=>void;
const authority=()=>room as unknown as Authority;
const player=(index:number)=>room.players.get(ids[index]!)!;
const inventory=(index:number)=>authority().survival.snapshot().players.find(p=>p.id===ids[index])!;
const state=()=>storyStore.readAuthority(homeId)!;
const events=(index:number,type:string)=>vi.mocked(clients[index]!.send).mock.calls.filter(call=>call[0]===type).map(call=>call[1]);
function latestStory(index:number){const value=events(index,'story.snapshot').at(-1);expect(value,`reliable story snapshot for ${index}`).toBeDefined();return value as ForestStorySnapshot;}
function latestWorld(index:number){authority().sendSnapshots();return events(index,'snapshot').at(-1) as RoomSnapshot;}
function latestNotice(index:number){return events(index,'notice').at(-1) as {code:string;message:string;commandId?:string};}
function envelope(index:number,payload:Record<string,unknown>,context:Record<string,unknown>={}){
  const p=player(index);return{commandId:`shared-room-${++serial}`,worldRevision:room.worldRevision,lifeRevision:p.respawnCount??0,zoneRevision:p.zoneRevision??0,...payload,...context};
}
function send(index:number,payload:Record<string,unknown>,context:Record<string,unknown>={}){command(clients[index]!,envelope(index,payload,context));}
function place(index:number,point:Point,zone?:PlayerState['zone']){
  const p=player(index);Object.assign(p,{x:point.x,y:point.y,vx:0,vy:0,mode:'home',zone});delete p.seatId;delete p.haloUntil;delete p.respawnAt;
  room.intents.delete(p.id);return p;
}
function skip(ms:number){vi.setSystemTime(Date.now()+ms);}
function advance(ms:number){for(let n=0;n<ms;n+=50){skip(50);tick(50);}}
function admit(index:number,suffix=''){
  const client={sessionId:`shared-story-${index}${suffix}`,send:vi.fn(),leave:vi.fn()} as unknown as Client;
  client.auth=room.onAuth(client,{homeId,ticket:store.issueTicket(homeId,ids[index]!).ticket});room.onJoin(client,{});return client;
}
function createRoom(){
  PartyRoom.store=store;room=new PartyRoom();room.worldId='forest';
  vi.spyOn(room,'setMatchmaking').mockResolvedValue();
  vi.spyOn(room,'onMessage').mockImplementation((type,handler)=>{if(type==='command')command=handler as typeof command;});
  vi.spyOn(room,'setTimestep').mockImplementation(callback=>{tick=callback!;});
  vi.spyOn(room.clock,'setInterval').mockReturnValue({} as ReturnType<typeof room.clock.setInterval>);
  room.onCreate({homeId});
  // Keep unrelated rare horror scheduling out of deterministic story/combat tests.
  authority().encounter=null;authority().werewolf=null;authority().mimic=null;
  clients=ids.map((_id,index)=>admit(index));advance(50);
}
function talk(index:number,narrativeId:string){
  skip(7000);const npc=authority().npcs.get(`npc:${narrativeId}`);expect(npc,`authored actor ${narrativeId}`).toBeDefined();place(index,npc!);send(index,{type:'npc.interact',npcId:npc!.id});
}
function startMain(){talk(0,'wizard-orin-vale');expect(state().state.chapter).toBe('wards');}
function equipKnife(index:number){
  const bag=authority().survival.snapshot().backpacks[0]!;expect(bag).toBeDefined();place(index,bag);send(index,{type:'survival.pickup',backpackId:bag.id});
  send(index,{type:'survival.equip',item:'knife'});expect(inventory(index).equipped).toBe('knife');
}
function nearMob(index:number,mob:ForestMob){
  const world=getWorld('forest').map;
  const point=[{x:mob.x-.8,y:mob.y},{x:mob.x+.8,y:mob.y},{x:mob.x,y:mob.y+.8},mob].find(p=>isHomeWalkable(p,world)&&isHomeSegmentWalkable(p,mob,world))!;
  expect(point).toBeDefined();place(index,point);
}
function finishEncounter(index:number,encounterId:string){
  let hits=0;
  while(true){
    const mob=authority().combat.snapshot().mobs.find(m=>m.encounterId===encounterId&&m.health>0);if(!mob)break;
    expect(hits++,'bounded solo encounter completion').toBeLessThan(32);nearMob(index,mob);skip(850);
    send(index,{type:'mob.attack',mobId:mob.id,targetLifeRevision:mob.lifeRevision});advance(100);
  }
  advance(150);
}
function restoreWards(){
  startMain();for(const [index,cache]of WARD_CACHE_ANCHORS.entries()){place(index,cache);send(index,{type:'story.recover',supplyId:cache.id});}
  equipKnife(0);advance(100);for(const encounterId of STORY_RAIDERS)finishEncounter(0,encounterId);
  expect(state().state.defeated).toEqual(expect.arrayContaining([...STORY_RAIDERS]));
  talk(0,'wizard-orin-vale');expect(state().state.chapter).toBe('inquiry');
}
function inspect(index:number,evidenceId:'ada-journal'|'ward-rubbing'){
  const zone=evidenceId==='ada-journal'?'interior:keeper-house':'interior:hollow-observatory';
  place(index,{x:5.5,y:7.5},zone);send(index,{type:'story.inspect',evidenceId});
}
function completeInquiry(){
  restoreWards();inspect(0,'ada-journal');inspect(1,'ward-rubbing');
  for(const [index,suspect]of STORY_SUSPECTS.entries())talk(index,suspect.id);
  const orin=authority().npcs.get('npc:wizard-orin-vale')!;place(0,orin);
  send(0,{type:'story.accuse',suspectId:state().mystery.culpritId});expect(state().state.chapter).toBe('rescue');
}

beforeEach(()=>{
  vi.useFakeTimers();vi.setSystemTime(1_000_000);serial=0;
  store=new LocalStore({path:':memory:'});ids=Array.from({length:8},(_,i)=>store.createIdentity({name:`Story friend ${i}`}).profile.id);
  homeId=store.createHome(ids[0]!,{name:'Shared story fixture',pin:'123456'}).id;store.db.prepare('UPDATE homes SET capacity=8 WHERE id=?').run(homeId);
  ids.slice(1).forEach(id=>store.joinHome(homeId,id,{pin:'123456'}));
  storyStore=new SharedForestStoryStore(store.db,{canAccess:(home,user)=>store.canAccess(home,user),chooseCulprit:()=>STORY_SUSPECTS[0].id});
  // Initialize the private mystery through its server dependency before room startup.
  storyStore.read(homeId,ids[0]!);createRoom();
});
afterEach(()=>{room.onDispose();room.clock.clear();store.close();vi.restoreAllMocks();vi.useRealTimers();});

describe('shared story through the actual eight-human PartyRoom authority',()=>{
  it('sends reliable discovered-only story on admission without repeating it in tick snapshots, and shares one climate across split actors',()=>{
    const points=[{x:28,y:24},{x:46,y:85},{x:97,y:40},{x:124,y:24},{x:108,y:71},{x:124,y:94},{x:72,y:95},{x:38,y:102}];
    points.forEach((point,index)=>place(index,point));
    const counts=clients.map((_c,i)=>events(i,'story.snapshot').length),first=latestStory(0).story;
    expect(first).toMatchObject({chapter:'undiscovered',leads:[],evidence:[],suspects:[]});
    for(let i=0;i<8;i++){
      expect(latestStory(i).story).toEqual(first);const world=latestWorld(i);
      expect(world.members).toHaveLength(8);expect(world.climate).toEqual(latestWorld(0).climate);
      expect(world).not.toHaveProperty('story');expect(world).not.toHaveProperty('personal');
      expect(JSON.stringify(latestStory(i))).not.toMatch(/"(?:culpritId|private_json|mystery|confirmedFace)"/);
    }
    for(let n=0;n<5;n++)authority().sendSnapshots();
    expect(clients.map((_c,i)=>events(i,'story.snapshot').length)).toEqual(counts);
    send(0,{type:'story.read'});expect(events(0,'story.snapshot')).toHaveLength(counts[0]!+1);
  });

  it('records two concurrent recoveries once, converges all eight worlds, rejects replay and catches up a returning member',()=>{
    startMain();const cache=WARD_CACHE_ANCHORS[0],before=state().revision;
    place(0,cache);place(1,cache);send(0,{type:'story.recover',supplyId:cache.id,commandId:'contested-seal'});send(1,{type:'story.recover',supplyId:cache.id});
    expect(state().state.seals).toEqual([cache.id]);expect(state().revision).toBe(before+1);
    for(let i=0;i<8;i++)expect(latestStory(i).story.objectives.find(o=>o.id==='recover-seals')?.current).toBe(1);
    room.onLeave(clients[7]!);
    place(0,WARD_CACHE_ANCHORS[1]);send(0,{type:'story.recover',supplyId:WARD_CACHE_ANCHORS[1].id,commandId:'contested-seal'});
    expect(state().state.seals).toHaveLength(1);send(2,{type:'story.recover',supplyId:WARD_CACHE_ANCHORS[1].id});expect(state().state.seals).toHaveLength(1);
    place(2,WARD_CACHE_ANCHORS[1]);send(2,{type:'story.recover',supplyId:WARD_CACHE_ANCHORS[1].id});
    clients[7]=admit(7,'-return');expect(latestStory(7).story).toEqual(latestStory(0).story);expect(latestStory(7).personal.catchUp.length).toBeGreaterThan(0);
    expect(room.players.size).toBe(8);expect(state().state.seals).toHaveLength(2);
    const revision=latestStory(7).story.revision;send(7,{type:'story.seen',seenRevision:revision});expect(latestStory(7).personal.catchUp).toEqual([]);
    send(7,{type:'story.seen',seenRevision:revision+999});expect(storyStore.read(homeId,ids[7]!).personal.catchUp).toEqual([]);
  });

  it('rejects forged payloads and every stale world, life and interior revision before any story mutation or private read',()=>{
    startMain();place(0,WARD_CACHE_ANCHORS[0]);const before=state(),messages=events(0,'story.snapshot').length;
    const payloads=[{type:'story.read'},{type:'story.seen',seenRevision:0},{type:'story.recover',supplyId:'brass-seal-a'},{type:'story.inspect',evidenceId:'ada-journal'},{type:'story.accuse',suspectId:STORY_SUSPECTS[0].id},{type:'story.reward',rewardId:'wards-restored'},{type:'mob.attack',mobId:`mob:${STORY_RAIDERS[0]}:0`,targetLifeRevision:0}];
    for(const payload of payloads)for(const context of[{worldRevision:999},{lifeRevision:999},{zoneRevision:999},{userId:ids[1]},{health:999,damage:999}])send(0,payload,context);
    for(const payload of[{type:'story.defeat',encounterId:STORY_RAIDERS[0]},{type:'mob.clear',encounterId:STORY_RAIDERS[0]},{type:'story.recover',supplyId:'brass-seal-a',chapter:'complete'},{type:'story.reward',rewardId:'wards-restored',apples:5,claimFor:ids[1]}])send(0,payload);
    expect(state()).toEqual(before);expect(events(0,'story.snapshot')).toHaveLength(messages);
    expect(inventory(0).apples).toBe(0);
    const stolen={sessionId:'unadmitted-transport',auth:clients[0]!.auth,send:vi.fn(),leave:vi.fn()} as unknown as Client;
    command(stolen,envelope(0,{type:'story.read'}));expect(stolen.leave).toHaveBeenCalledWith(4003);expect(vi.mocked(stolen.send).mock.calls.some(c=>c[0]==='story.snapshot')).toBe(false);
  });

  it('discovers flexible side plots before Orin, rewards offline members personally once, and rehydrates after room recreation',()=>{
    room.onLeave(clients[7]!);talk(0,'cheesemonger-merrit');talk(1,'goblin-pip');talk(2,'cheesemonger-merrit');
    expect(state().state.chapter).toBe('undiscovered');expect(latestStory(0).story.leads.map(l=>l.id)).toEqual(['a-fair-rind']);
    expect(latestStory(0).story.leads[0]?.status).toBe('complete');
    send(0,{type:'story.reward',rewardId:'fair-rind',commandId:'claim-side'});send(0,{type:'story.reward',rewardId:'fair-rind',commandId:'claim-side'});send(0,{type:'story.reward',rewardId:'fair-rind'});
    expect(inventory(0).apples).toBe(STORY_REWARDS['fair-rind'].apples);expect(inventory(1).apples).toBe(0);
    expect(store.db.prepare('SELECT count(*) AS n FROM forest_story_reward_claims WHERE home_id=? AND user_id=?').get(homeId,ids[0]!)).toMatchObject({n:1});
    clients[7]=admit(7,'-offline-return');expect(latestStory(7).personal.rewards).toEqual(expect.arrayContaining([expect.objectContaining({id:'fair-rind',status:'pending'})]));
    const progress=latestStory(0).story;room.onDispose();room.clock.clear();createRoom();
    expect(latestStory(0).story).toEqual(progress);expect(inventory(0).apples).toBe(1);expect(latestStory(0).personal.rewards.find(r=>r.id==='fair-rind')?.status).toBe('claimed');
    send(0,{type:'story.reward',rewardId:'fair-rind'});expect(inventory(0).apples).toBe(1);
  });

  it('revokes story reads, mutations and private inventory together when membership ends',()=>{
    startMain();const raw=envelope(7,{type:'story.read'}),count=events(7,'story.snapshot').length,before=state().revision;
    store.banMember(homeId,ids[0]!,ids[7]!);expect(room.players.has(ids[7]!)).toBe(false);expect(clients[7]!.leave).toHaveBeenCalledWith(4003);
    command(clients[7]!,raw);command(clients[7]!,{...raw,type:'story.recover',supplyId:'brass-seal-a'});
    expect(events(7,'story.snapshot')).toHaveLength(count);expect(state().revision).toBe(before);
    expect(()=>storyStore.read(homeId,ids[7]!)).toThrow(/membership|access/i);
    const stranger=store.createIdentity({name:'Outside reader'}).profile.id;expect(()=>storyStore.read(homeId,stranger)).toThrow(/membership|access/i);
  });

  it('projects knife ownership and health server-side, fences target lives and shares one cooldown across mobs and human PvP',()=>{
    startMain();equipKnife(0);advance(100);const initial=authority().combat.snapshot().mobs[0]!;expect(initial).toBeDefined();nearMob(0,initial);
    for(const extra of[{damage:999},{armed:true,health:999},{participantIds:[ids[1]],defeated:true},{targetLifeRevision:initial.lifeRevision+1}])send(0,{type:'mob.attack',mobId:initial.id,targetLifeRevision:initial.lifeRevision},extra);
    expect(authority().combat.snapshot().mobs.find(m=>m.id===initial.id)?.health).toBe(initial.health);
    send(0,{type:'mob.attack',mobId:initial.id,targetLifeRevision:initial.lifeRevision,commandId:'one-world-swing'});
    const after=authority().combat.snapshot().mobs.find(m=>m.id===initial.id)!;expect(after.health).toBe(after.maxHealth-30);
    send(0,{type:'mob.attack',mobId:initial.id,targetLifeRevision:initial.lifeRevision,commandId:'one-world-swing'});expect(authority().combat.snapshot().mobs.find(m=>m.id===initial.id)?.health).toBe(after.health);
    place(1,{x:player(0).x,y:player(0).y+.5});send(0,{type:'survival.attack',targetId:ids[1]});expect(inventory(1).health).toBe(100);
    skip(850);send(0,{type:'survival.attack',targetId:ids[1]});expect(inventory(1).health).toBe(70);
    send(0,{type:'mob.attack',mobId:initial.id,targetLifeRevision:initial.lifeRevision});expect(authority().combat.snapshot().mobs.find(m=>m.id===initial.id)?.health).toBe(after.health);
    expect(state().state.defeated).toEqual([]);expect(room.players.size).toBe(8);
  });

  it('namespaces client command IDs away from mob receipts, commits a real clear once, and retries a failed transaction',()=>{
    const reservedReceipt=`forest-encounter:${STORY_RAIDERS[0]}:clear:v1`;
    place(0,authority().npcs.get('npc:wizard-orin-vale')!);send(0,{type:'npc.interact',npcId:'npc:wizard-orin-vale',commandId:reservedReceipt});
    expect(state().state.chapter).toBe('wards');
    expect(store.db.prepare('SELECT count(*) AS n FROM forest_story_events WHERE home_id=? AND event_id=?').get(homeId,reservedReceipt)).toMatchObject({n:0});
    equipKnife(0);advance(100);
    send(0,{type:'mob.defeated',encounterId:STORY_RAIDERS[0],defeatId:'clear-v1',participantIds:ids});expect(state().state.defeated).toEqual([]);
    store.db.exec("CREATE TEMP TRIGGER fixture_fail_story_clear BEFORE INSERT ON forest_story_events WHEN NEW.event_id LIKE '%forest-encounter:%' BEGIN SELECT RAISE(ABORT,'fixture-story-write-failed'); END");
    finishEncounter(0,STORY_RAIDERS[0]);expect(state().state.defeated).not.toContain(STORY_RAIDERS[0]);expect(authority().combat.pendingDefeats()).toHaveLength(1);
    store.db.exec('DROP TRIGGER fixture_fail_story_clear');advance(250);
    expect(state().state.defeated).toEqual([STORY_RAIDERS[0]]);expect(authority().combat.pendingDefeats()).toEqual([]);
    const revision=state().revision;advance(500);expect(state().revision).toBe(revision);
    expect(store.db.prepare('SELECT count(*) AS n FROM forest_story_defeats WHERE home_id=? AND encounter_id=?').get(homeId,STORY_RAIDERS[0])).toMatchObject({n:1});
    for(let i=0;i<8;i++)expect(latestStory(i).story.objectives.find(o=>o.id==='disperse-raiders')?.current).toBe(1);
  });

  it('finishes local harvest and eating after durable commits even when the private notification transport throws',()=>{
    const tree=authority().survival.snapshot().appleTrees[0]!;place(0,tree);
    const throwOneNotification=()=>{let failed=false;vi.mocked(clients[0]!.send).mockImplementation((type)=>{if(type==='story.snapshot'&&!failed){failed=true;throw new Error('fixture private notification failed');}});return()=>failed;};
    const harvestFailure=throwOneNotification();
    expect(()=>send(0,{type:'survival.harvest',treeId:tree.id})).not.toThrow();
    expect(harvestFailure()).toBe(true);expect(storyStore.read(homeId,ids[0]!).personal.inventory.apples).toBe(1);expect(inventory(0).apples).toBe(1);
    expect(authority().survival.snapshot().appleTrees.find(t=>t.id===tree.id)?.readyAt).toBeGreaterThan(Date.now());
    vi.mocked(clients[0]!.send).mockImplementation(()=>{});send(0,{type:'survival.equip',item:'apple'});
    const eatFailure=throwOneNotification();expect(()=>send(0,{type:'survival.eat'})).not.toThrow();
    expect(eatFailure()).toBe(true);expect(storyStore.read(homeId,ids[0]!).personal.inventory.apples).toBe(0);
    expect(inventory(0)).toMatchObject({apples:0,hunger:100});
  });

  it('refreshes the committed story and every other client when the initiating NPC notice transport fails',()=>{
    let failed=false;
    vi.mocked(clients[0]!.send).mockImplementation(type=>{
      if(type==='notice'&&!failed){failed=true;throw new Error('fixture NPC notice failed');}
    });
    expect(()=>talk(0,'wizard-orin-vale')).not.toThrow();
    expect(failed).toBe(true);expect(state().state.chapter).toBe('wards');
    for(let i=1;i<8;i++)expect(latestStory(i).story.chapter).toBe('wards');
    expect(authority().combat.snapshot().mobs.map(m=>m.encounterId)).toEqual(expect.arrayContaining([...STORY_RAIDERS]));
    expect(events(0,'notice').some(value=>(value as {code?:string})?.code==='STORY_SAVE_FAILED')).toBe(false);
  });

  it('requires evidence in the correct interior, at a walkable anchor and across clear line of sight',()=>{
    restoreWards();const before=state().revision,point={x:5.5,y:7.5};
    place(0,point);send(0,{type:'story.inspect',evidenceId:'ada-journal'});
    place(0,point,'interior:orin-tower');send(0,{type:'story.inspect',evidenceId:'ada-journal'});
    place(0,{x:8,y:11},'interior:keeper-house');send(0,{type:'story.inspect',evidenceId:'ada-journal'});
    const blocked=place(0,{x:4.6,y:6.5},'interior:keeper-house'),map=getWorld('interior:keeper-house').map;
    expect(isHomeWalkable(blocked,map)).toBe(true);expect(isHomeSegmentWalkable(blocked,point,map)).toBe(false);send(0,{type:'story.inspect',evidenceId:'ada-journal'});
    expect(state().revision).toBe(before);expect(state().state.evidence).toEqual([]);
    inspect(0,'ada-journal');expect(state().state.evidence).toEqual(['ada-journal']);
    place(1,point,'interior:orin-tower');send(1,{type:'story.inspect',evidenceId:'ward-rubbing'});expect(state().state.evidence).toHaveLength(1);
    inspect(1,'ward-rubbing');expect(state().state.evidence).toHaveLength(2);
    expect(latestStory(7).story.evidence.find(e=>e.id==='ward-rubbing')?.text).toContain(STORY_SUSPECTS[0].mark);
    expect(JSON.stringify(latestStory(7))).not.toContain('culpritId');
  });

  it('requires every clue and testimony plus real Orin proximity before exposing the next stage',()=>{
    restoreWards();const orin=authority().npcs.get('npc:wizard-orin-vale')!,culprit=state().mystery.culpritId;
    place(0,orin);send(0,{type:'story.accuse',suspectId:culprit,commandId:'need-evidence'});expect(state().state.chapter).toBe('inquiry');
    expect(latestNotice(0)).toMatchObject({code:'STORY_UPDATE',commandId:'need-evidence'});
    inspect(0,'ada-journal');inspect(1,'ward-rubbing');for(const [i,npc]of STORY_SUSPECTS.entries())talk(i,npc.id);
    place(0,{x:28,y:24});send(0,{type:'story.accuse',suspectId:culprit,commandId:'far-away'});expect(state().state.chapter).toBe('inquiry');
    expect(latestNotice(0)).toMatchObject({code:'TOO_FAR',commandId:'far-away'});
    place(0,authority().npcs.get('npc:wizard-orin-vale')!);const wrong=STORY_SUSPECTS.find(s=>s.id!==culprit)!.id;
    send(0,{type:'story.accuse',suspectId:wrong,commandId:'wrong-face'});expect(state().state.wrongAccusations).toEqual([wrong]);expect(state().state.evidence).toHaveLength(2);
    expect(latestNotice(0)).toMatchObject({code:'STORY_UPDATE',commandId:'wrong-face'});
    const revision=state().revision;
    send(0,{type:'story.accuse',suspectId:wrong,commandId:'already-ruled-out'});
    expect(state().revision).toBe(revision);expect(latestNotice(0)).toMatchObject({code:'STORY_UPDATE',commandId:'already-ruled-out',message:expect.stringContaining('ruled out')});
    send(0,{type:'story.accuse',suspectId:culprit,commandId:'too-soon'});expect(state().state.chapter).toBe('inquiry');
    expect(latestNotice(0)).toMatchObject({code:'STORY_UPDATE',commandId:'too-soon',message:expect.stringContaining('Take a breath')});
    skip(10_001);send(0,{type:'story.accuse',suspectId:culprit,commandId:'correct-face'});expect(state().state.chapter).toBe('rescue');
    expect(latestNotice(0)).toMatchObject({code:'STORY_UPDATE',commandId:'correct-face'});
    expect(latestStory(7).story.leads.some(l=>l.id==='keeper-rescue')).toBe(true);
    expect(authority().npcs.get(`npc:${wrong}`)?.health).toBeGreaterThan(0);
  });

  it('acknowledges failed saves and actions arriving during respawn with the original command id',()=>{
    startMain();place(0,authority().npcs.get('npc:wizard-orin-vale')!);const before=state().revision;
    vi.spyOn(SharedForestStoryStore.prototype,'apply').mockImplementationOnce(()=>{throw new Error('fixture storage failure');});
    send(0,{type:'story.accuse',suspectId:STORY_SUSPECTS[0].id,commandId:'failed-save'});
    expect(latestNotice(0)).toMatchObject({code:'STORY_SAVE_FAILED',commandId:'failed-save'});expect(state().revision).toBe(before);
    player(0).respawnAt=Date.now()+2000;
    send(0,{type:'story.reward',rewardId:'wards-restored',commandId:'caught-in-flight'});
    expect(latestNotice(0)).toMatchObject({code:'STORY_STALE',commandId:'caught-in-flight'});
  });

  it('returns a correlated full-inventory result and preserves a reward for one intentional later claim',()=>{
    talk(0,'cheesemonger-merrit');talk(1,'goblin-pip');talk(0,'cheesemonger-merrit');
    for(let before=0;before<5;before++)storyStore.changeApples(homeId,ids[0]!,{before,after:before+1,expectedRevision:before+1,cause:'harvest'});
    send(0,{type:'story.read'});send(0,{type:'story.reward',rewardId:'fair-rind',commandId:'full-pockets'});
    expect(latestNotice(0)).toMatchObject({code:'STORY_REWARD',commandId:'full-pockets',message:expect.stringContaining('this reward will wait')});
    expect(latestStory(0).personal.rewards.find(r=>r.id==='fair-rind')?.status).toBe('pending');expect(inventory(0).apples).toBe(5);
    storyStore.changeApples(homeId,ids[0]!,{before:5,after:4,expectedRevision:6,cause:'eat'});send(0,{type:'story.read'});
    send(0,{type:'story.reward',rewardId:'fair-rind',commandId:'room-now'});
    expect(latestNotice(0)).toMatchObject({code:'STORY_REWARD',commandId:'room-now'});
    send(0,{type:'story.reward',rewardId:'fair-rind',commandId:'late-retry'});
    expect(latestNotice(0)).toMatchObject({code:'STORY_REWARD',commandId:'late-retry'});expect(inventory(0).apples).toBe(5);
    expect(store.db.prepare('SELECT count(*) AS n FROM forest_story_reward_claims WHERE home_id=? AND user_id=?').get(homeId,ids[0]!)).toMatchObject({n:1});
  });

  it('admits all eight into each interior with safe unique spawns and returns everyone through natural exits',()=>{
    for(const interior of FOREST_INTERIORS){
      skip(1600);for(let i=0;i<8;i++){place(i,interior.returnPoint);send(i,{type:'interior.enter',interiorId:interior.id});expect(player(i).zone,interior.id).toBe(interior.id);}
      const positions=ids.map((_id,i)=>({...player(i)}));expect(room.players.size).toBe(8);
      for(let i=0;i<8;i++){expect(isHomeWalkable(positions[i]!,interior.map),interior.id).toBe(true);for(const other of positions.slice(i+1))expect(Math.hypot(positions[i]!.x-other.x,positions[i]!.y-other.y)).toBeGreaterThan(.65);}
      const inside=latestWorld(0);expect(inside.players).toHaveLength(8);expect(inside.npcs).toBeUndefined();expect(inside.mobs).toBeUndefined();expect(inside.voiceScope?.participantIds).toHaveLength(8);
      skip(1600);for(let i=0;i<8;i++){place(i,interior.exit,interior.id);send(i,{type:'interior.enter',interiorId:'outside'});expect(player(i).zone).toBeUndefined();expect(isHomeWalkable(player(i),getWorld('forest').map)).toBe(true);}
    }
  });

  it('keeps eight separated interiors isolated for entities and voice while shared climate and story remain room-wide',()=>{
    for(let i=0;i<8;i++){const interior=FOREST_INTERIORS[i]!;place(i,interior.returnPoint);send(i,{type:'interior.enter',interiorId:interior.id});}
    const climates=ids.map((_id,i)=>latestWorld(i).climate);expect(climates[0]).toBeDefined();
    for(let i=0;i<8;i++){const world=latestWorld(i);expect(world.players.map(p=>p.id)).toEqual([ids[i]]);expect(world.members).toHaveLength(8);expect(world.voiceScope?.participantIds).toEqual([ids[i]]);expect(world.npcs).toBeUndefined();expect(world.mobs).toBeUndefined();expect(world.climate).toEqual(climates[0]);}
    // An outdoor conversation remains authoritative while seven clients render other maps.
    skip(1600);const first=FOREST_INTERIORS[0]!;place(0,first.exit,first.id);send(0,{type:'interior.enter',interiorId:'outside'});talk(0,'wizard-orin-vale');
    for(let i=0;i<8;i++)expect(latestStory(i).story.chapter).toBe('wards');
  });

  it('keeps Ada locked behind the live guardian clear, then completes the shared rescue once and moves her safely to camp',()=>{
    completeInquiry();advance(100);place(0,{x:126,y:98});const adaBefore=latestWorld(0).npcs?.find(n=>n.id==='npc:keeper-ada');
    // Ada can be represented as a static room actor rather than the wandering controller.
    send(0,{type:'npc.interact',npcId:'npc:keeper-ada'});expect(state().state.chapter).toBe('rescue');
    expect(adaBefore).toMatchObject({id:'npc:keeper-ada',x:126,y:98});
    finishEncounter(0,STORY_GUARDIAN);expect(state().state.defeated).toContain(STORY_GUARDIAN);
    skip(7000);place(0,{x:126,y:98});send(0,{type:'npc.interact',npcId:'npc:keeper-ada',commandId:'bring-ada-home'});expect(state().state.chapter).toBe('complete');
    const revision=state().revision;send(0,{type:'npc.interact',npcId:'npc:keeper-ada',commandId:'bring-ada-home'});expect(state().revision).toBe(revision);
    place(0,{x:31,y:26});const ada=latestWorld(0).npcs?.find(n=>n.id==='npc:keeper-ada');expect(ada).toMatchObject({x:31,y:26});
    for(let i=0;i<8;i++)expect(latestStory(i).personal.rewards.some(r=>r.id==='keeper-rescued')).toBe(true);
    expect(room.players.size).toBe(8);
  });
});
