import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {LocalStore} from '../../packages/data/src/index';
import {SharedForestStoryStore} from '../../packages/data/src/forest-story-store';
import {LivingWorldStore} from '../../packages/data/src/living-world-store';
import {StolenLanternStore} from '../../packages/data/src/stolen-lantern-store';
import {LivingWorldRoom} from '../../apps/game-server/src/living-world-room';
import {StolenLanternRoom} from '../../apps/game-server/src/stolen-lantern-room';
import {SurvivalInventory} from '../../apps/game-server/src/survival-inventory';
import type {ForestNPCController} from '../../apps/game-server/src/ForestNPCController';
import {createPlayer,isHomeSegmentWalkable,isHomeWalkable} from '../../packages/simulation/src/index';
import {canUseForestStory} from '../../packages/simulation/src/forest-story-access';
import {getWorld} from '../../packages/config/src/index';
import {LANTERN_CAVE,LANTERN_CAVE_ANCHOR,LANTERN_CAVE_DOOR} from '../../packages/config/src/lantern-cave';
import {STOLEN_LANTERN_RECIPIENTS} from '../../packages/config/src/stolen-lantern';
import {parseCommand,type ClientCommand,type PlayerState} from '../../packages/contracts/src/index';
import type {ForestNPC} from '../../packages/contracts/src/forest-npc';
import type {StolenLanternAction,StolenLanternReceipt} from '../../packages/contracts/src/stolen-lantern';
import type {NPCConversationView} from '../../packages/config/src/npc-conversations';

type RoomPlayer=PlayerState&{watching?:boolean};
const opened:LocalStore[]=[],dirs:string[]=[];
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(1_000_000);});
afterEach(()=>{opened.splice(0).forEach(store=>store.close());dirs.splice(0).forEach(dir=>rmSync(dir,{recursive:true,force:true}));vi.restoreAllMocks();vi.useRealTimers();});

function fixture(disk=false){
  const dir=disk?mkdtempSync(join(tmpdir(),'third-space-lantern-room-')):null;if(dir)dirs.push(dir);
  const path=dir?join(dir,'room.sqlite'):':memory:';
  let db=new LocalStore({path});opened.push(db);
  const host=db.createIdentity({name:'Lantern host'}).profile.id,guest=db.createIdentity({name:'Lantern guest'}).profile.id;
  const home=db.createHome(host,{name:'Lantern services',pin:'123456'}).id;db.joinHome(home,guest,{pin:'123456'});
  const point={x:46,y:85};expect(isHomeWalkable(point,getWorld('forest').map)).toBe(true);
  const players=new Map<string,RoomPlayer>([host,guest].map(id=>[id,{...createPlayer(id,id),...point,flashlightOn:false,flashlightBattery:0}]));
  const resident=(id:string):ForestNPC=>({...createPlayer(id,id),...point,art:id.includes('spirit')?'spirit':'villager',role:'Neighbour',phase:'wander',activity:'working',moving:false,health:100,maxHealth:100,lifeRevision:0});
  const residents=new Map(['washer-elsie','goblin-pip','spirit-lumen','spirit-morrow','wizard-orin-vale'].map(name=>[`npc:${name}`,resident(`npc:${name}`)]));
  const npcApi={
    get:vi.fn((id:string)=>residents.get(id)),snapshot:vi.fn(()=>[...residents.values()].map(npc=>({...npc}))),
    damage:vi.fn((id:string,amount:number)=>{const npc=residents.get(id)!;npc.health=Math.max(0,npc.health-amount);if(!npc.health){npc.phase='respawning';npc.lifeRevision=(npc.lifeRevision??0)+1;}return npc.health?'hurt':'caught';}),
    update:vi.fn(),steer:vi.fn(),diagnostics:vi.fn(()=>({lastPathSearches:0})),
  };
  const send=vi.fn<(id:string,type:string,payload:unknown)=>void>(),notice=vi.fn(),revisions=new Map<string,number>();
  let changingWorld=false,worldId='forest',epoch=0,serial=0;
  let inventory:SurvivalInventory,story:SharedForestStoryStore,livingStore:LivingWorldStore,lanternStore:StolenLanternStore,living:LivingWorldRoom,lantern:StolenLanternRoom;
  const admitted=(id:string)=>db.canAccess(home,id);
  const fresh=(p:PlayerState,c:{worldRevision:number;lifeRevision:number;zoneRevision:number})=>canUseForestStory(worldId,changingWorld,p)&&c.worldRevision===7&&c.lifeRevision===(p.respawnCount??0)&&c.zoneRevision===(p.zoneRevision??0);
  const rebuild=()=>{
    inventory=new SurvivalInventory({random:()=>0,spawnPoints:[point,{x:point.x+4,y:point.y}],trees:[],safe:()=>false,walkable:p=>isHomeWalkable(p,getWorld('forest').map),lineOfSight:(a,b)=>isHomeSegmentWalkable(a,b,getWorld('forest').map)});
    for(const id of players.keys())inventory.ensure(id);
    story=new SharedForestStoryStore(db.db,{canAccess:(h,u)=>db.canAccess(h,u),now:()=>Date.now(),chooseCulprit:()=> 'goblin-nib'});
    livingStore=new LivingWorldStore(db.db,{canAccess:(h,u)=>db.canAccess(h,u),now:()=>Date.now()});
    lanternStore=new StolenLanternStore(db.db,{canAccess:(h,u)=>db.canAccess(h,u),now:()=>Date.now()});
    const refreshInventory=()=>{for(const p of players.values())if(p.connected&&admitted(p.id))living.push(p.id);};
    // The same callback wiring as PartyRoom: enduring memory participates in the
    // reputation transaction, and physical damage follows only after success.
    living=new LivingWorldRoom({homeId:home,epoch:`lantern-test-${++epoch}`,store:livingStore,survival:inventory,players:()=>players,npcs:()=>npcApi as unknown as ForestNPCController,keeper:()=>undefined,fresh,canAccess:admitted,story:id=>story.read(home,id),talk:(id,npcId,commandId)=>{story.apply(home,{eventId:`talk:${id}:${commandId}`,actorId:id,kind:'talk',npcId:npcId.slice(4),occurredAt:Date.now()});},refreshStory:refreshInventory,send,notice,inventoryRevision:(id,revision)=>revisions.set(id,revision),knockout:vi.fn(),extendConversation:(id,base)=>lantern.conversation(id,base),extraAction:(id,c,npc)=>lantern.extraAction(id,c,npc),onNpcHit:(id,npcId,commandId)=>lantern.recordNpcHit(id,npcId,commandId)});
    lantern=new StolenLanternRoom({homeId:home,epoch:`lantern-test-${epoch}`,store:lanternStore,survival:inventory,players:()=>players,npcs:()=>npcApi as unknown as ForestNPCController,fresh,canAccess:admitted,protectedNpc:id=>living.protectedNpc(id),damage:(p,now)=>living.damage(p,now),refreshInventory,send,notice,knockout:vi.fn()});
    for(const id of players.keys())if(admitted(id)){living.push(id);lantern.push(id);}
  };
  rebuild();send.mockClear();
  const command=(payload:Record<string,unknown>,id=host)=>{
    const p=players.get(id),raw={commandId:`lantern-room-${++serial}`,worldRevision:7,lifeRevision:p?.respawnCount??0,zoneRevision:p?.zoneRevision??0,...payload};
    const parsed=parseCommand(raw);expect(parsed).not.toBeNull();return parsed!;
  };
  const dispatch=(c:ClientCommand,id=host)=>{if(!lantern.command(id,c))return living.command(id,c);return true;};
  const read=(id=host)=>lanternStore.read(home,id);
  const action=(action:Exclude<StolenLanternAction,'recover'>,id=host,extra:Record<string,unknown>={})=>command({type:'npc.action',npcId:`npc:${STOLEN_LANTERN_RECIPIENTS[action][0]}`,actionId:`stolen:${action}`,targetLifeRevision:0,expectedInventoryRevision:admitted(id)?read(id).personal.inventory.revision:1,...extra},id);
  const act=(kind:Exclude<StolenLanternAction,'recover'>,id=host,extra:Record<string,unknown>={})=>{const c=action(kind,id,extra);dispatch(c,id);return c;};
  const receipts=(id=host)=>send.mock.calls.filter(call=>call[0]===id&&call[1]==='living.receipt').map(call=>call[2] as StolenLanternReceipt);
  const outside=(id=host)=>{const p=players.get(id)!;Object.assign(p,point);delete p.zone;p.zoneRevision=(p.zoneRevision??0)+1;return p;};
  const cave=(id=host)=>{const p=players.get(id)!;Object.assign(p,LANTERN_CAVE_ANCHOR,{zone:LANTERN_CAVE.id,zoneRevision:(p.zoneRevision??0)+1});return p;};
  const recover=(id=host,extra:Record<string,unknown>={})=>{const c=command({type:'lantern.recover',...extra},id);dispatch(c,id);return c;};
  const lead=()=>{act('begin');act('ask-pip');expect(read().quest.stage).toBe('find-cave');};
  const complete=()=>{lead();cave();recover();outside();act('return');expect(read().quest.stage).toBe('complete');};
  const apples=(count=5,id=host)=>{
    let s=story.read(home,id);
    while(s.personal.inventory.apples!==count){const before=s.personal.inventory.apples,after=before+(before<count?1:-1);s=story.changeApples(home,id,{before,after,expectedRevision:s.personal.inventory.revision,cause:after>before?'harvest':'eat'}).snapshot;}
    living.push(id);return s.personal.inventory;
  };
  const arm=(id=host)=>{
    outside(id);inventory.tick(Date.now(),[...players.values()]);const bag=inventory.snapshot().backpacks[0]!;expect(bag).toBeDefined();
    Object.assign(players.get(id)!,{x:bag.x,y:bag.y});expect(inventory.pickup(players.get(id)!,bag.id,Date.now()).ok).toBe(true);expect(inventory.equip(id,'knife').ok).toBe(true);Object.assign(players.get(id)!,point);
  };
  const attack=(npcId='npc:washer-elsie',extra:Record<string,unknown>={})=>{const c=command({type:'npc.attack',npcId,targetLifeRevision:residents.get(npcId)?.lifeRevision??0,...extra});dispatch(c);return c;};
  const restart=(reopen=false)=>{if(reopen){expect(disk).toBe(true);opened.splice(opened.indexOf(db),1);db.close();db=new LocalStore({path});opened.push(db);}rebuild();};
  const pulse=()=>{
    outside();players.get(guest)!.connected=false;Object.assign(residents.get('npc:spirit-morrow')!,point);
    lantern.tick(Date.now(),true);const tell=lantern.patrol.snapshot().pulses[0];expect(tell).toBeDefined();return tell!;
  };
  return {home,host,guest,path,players,residents,npcApi,send,notice,revisions,command,dispatch,read,action,act,receipts,outside,cave,recover,lead,complete,apples,arm,attack,restart,pulse,setChanging:(value:boolean)=>{changingWorld=value;},setWorld:(value:string)=>{worldId=value;},get db(){return db;},get inventory(){return inventory;},get story(){return story;},get livingStore(){return livingStore;},get lanternStore(){return lanternStore;},get living(){return living;},get lantern(){return lantern;}};
}

describe('Stolen Lantern through actual room-service boundaries',()=>{
  it('extends only the recipient’s real NPC conversation and keeps peaceful watching allowed',()=>{
    const f=fixture();f.players.get(f.host)!.watching=true;
    f.dispatch(f.command({type:'npc.interact',npcId:'npc:washer-elsie'}));
    const conversations=f.send.mock.calls.filter(call=>call[1]==='npc.conversation');
    expect(conversations).toHaveLength(1);expect(conversations[0]![0]).toBe(f.host);
    const view=(conversations[0]![2] as {view:NPCConversationView}).view;
    expect(view.offers.some(offer=>offer.actionId==='stolen:begin')).toBe(true);
    expect(f.read().quest.stage).toBe('quiet');f.act('begin');expect(f.read().quest.stage).toBe('ask-pip');
    expect(f.story.read(f.home,f.host).story.chapter).toBe('undiscovered');
    expect(JSON.stringify(conversations)).not.toMatch(/culpritId|confirmedFace|private_json/);
  });

  it('rejects stale player/world/target lives, remote or recovering NPCs, and forged recipients before quest progress',()=>{
    const f=fixture(),p=f.players.get(f.host)!,npc=f.residents.get('npc:washer-elsie')!;
    for(const patch of [{worldRevision:8},{lifeRevision:1},{zoneRevision:1},{targetLifeRevision:1},{npcId:'npc:goblin-pip'},{npcId:'npc:missing'}])f.act('begin',f.host,patch);
    p.x+=10;f.act('begin');f.outside();p.zone='asylum';f.act('begin');delete p.zone;
    p.respawnAt=Date.now()+1000;f.act('begin');delete p.respawnAt;
    p.connected=false;f.act('begin');p.connected=true;p.mode='race';f.act('begin');p.mode='home';
    f.setChanging(true);f.act('begin');f.setChanging(false);f.setWorld('living-room');f.act('begin');f.setWorld('forest');
    npc.phase='respawning';f.act('begin');npc.phase='wander';
    expect(f.read().quest.stage).toBe('quiet');expect(f.receipts()).toEqual([]);
    expect(f.notice.mock.calls.length).toBeGreaterThanOrEqual(10);
    f.act('begin');expect(f.read().quest.stage).toBe('ask-pip');
  });

  it('rechecks real forest LOS and denies an outsider even with valid-looking life and NPC fields',()=>{
    const f=fixture(),map=getWorld('forest').map,obstacle=map.solids.find(rect=>rect.width<1&&rect.height<1)!;
    const a={x:obstacle.x-.35,y:obstacle.y+obstacle.height/2},b={x:obstacle.x+obstacle.width+.35,y:a.y};
    expect(Math.hypot(a.x-b.x,a.y-b.y)).toBeLessThan(2.5);expect(isHomeSegmentWalkable(a,b,map)).toBe(false);
    Object.assign(f.players.get(f.host)!,a);Object.assign(f.residents.get('npc:washer-elsie')!,b);f.act('begin');expect(f.read().quest.stage).toBe('quiet');
    const outsider=f.db.createIdentity({name:'Unadmitted'}).profile.id;
    f.players.set(outsider,{...createPlayer(outsider,'Unadmitted'),...b});f.inventory.ensure(outsider);
    f.act('begin',outsider);expect(f.read().quest.stage).toBe('quiet');
    expect(f.db.db.prepare('SELECT 1 FROM stolen_lantern_personal WHERE home_id=? AND user_id=?').get(f.home,outsider)).toBeUndefined();
    expect(parseCommand({type:'npc.action',npcId:'npc:washer-elsie',actionId:'stolen:claim',targetLifeRevision:0,expectedInventoryRevision:1,worldRevision:7,lifeRevision:0,zoneRevision:0,commandId:'forged-price',apples:999})).toBeNull();
  });

  it('requires the inside cave anchor, range, unobstructed path and fresh life/zone before recovery',()=>{
    const f=fixture();f.lead();const p=f.players.get(f.host)!;
    Object.assign(p,LANTERN_CAVE_DOOR.point);f.recover();
    f.cave();p.y=13.5;f.recover();
    Object.assign(p,{x:9,y:4.1});expect(isHomeWalkable(p,LANTERN_CAVE.map)).toBe(true);expect(isHomeSegmentWalkable(p,LANTERN_CAVE_ANCHOR,LANTERN_CAVE.map)).toBe(false);f.recover();
    f.cave();for(const patch of [{worldRevision:6},{lifeRevision:99},{zoneRevision:99}])f.recover(f.host,patch);
    p.respawnAt=Date.now()+1000;f.recover();delete p.respawnAt;p.connected=false;f.recover();p.connected=true;
    p.zone='asylum';f.recover();f.cave();
    expect(f.read().quest.stage).toBe('find-cave');
    f.outside();f.dispatch(f.command({type:'npc.action',npcId:'npc:washer-elsie',actionId:'stolen:recover',targetLifeRevision:0,expectedInventoryRevision:f.read().personal.inventory.revision}));expect(f.read().quest.stage).toBe('find-cave');
    f.cave();p.watching=true;f.recover();expect(f.read().quest).toMatchObject({stage:'return-lantern',custody:'home',recoveredBy:f.host});
  });

  it('serializes competing room recoveries into shared custody, then another member returns and claims a personal reward',async()=>{
    const f=fixture();f.lead();f.cave();f.cave(f.guest);
    const a=f.command({type:'lantern.recover'}),b=f.command({type:'lantern.recover'},f.guest);
    await Promise.all([Promise.resolve().then(()=>f.dispatch(a)),Promise.resolve().then(()=>f.dispatch(b,f.guest))]);
    const results=[f.receipts().at(-1)!,f.receipts(f.guest).at(-1)!];expect(results.map(result=>result.status).sort()).toEqual(['unchanged','updated']);
    expect(f.read(f.guest).quest).toEqual(f.read().quest);expect(f.inventory.ensure(f.host).slots).not.toContain('lantern');
    f.outside(f.guest);f.act('return',f.guest);expect(f.read().quest.custody).toBe('returned');
    expect(f.read().personal.reward).toBe('pending');expect(f.read(f.guest).personal.reward).toBe('pending');
    const c=f.act('claim',f.guest);expect(f.inventory.ensure(f.guest).apples).toBe(2);expect(f.inventory.ensure(f.host).apples).toBe(0);
    const revision=f.read(f.guest).personal.inventory.revision;f.dispatch(c,f.guest);
    expect(f.inventory.ensure(f.guest).apples).toBe(2);expect(f.read(f.guest).personal.inventory.revision).toBe(revision);
    expect(f.revisions.get(f.guest)).toBe(revision);
  });

  it('keeps earned apples pending for stale revisions/full pockets and synchronizes successful claims to ordinary inventory',()=>{
    const f=fixture();f.complete();f.apples(4);
    f.act('claim');expect(f.receipts().at(-1)!.status).toBe('inventory-full');expect(f.read().personal.reward).toBe('pending');
    f.apples(3);f.act('claim',f.host,{expectedInventoryRevision:f.read().personal.inventory.revision-1});expect(f.receipts().at(-1)!.status).toBe('inventory-conflict');
    const capacity=vi.spyOn(f.inventory,'canStoreItem').mockReturnValue(false);f.act('claim');expect(f.receipts().at(-1)!.status).toBe('inventory-full');capacity.mockRestore();
    f.act('claim');expect(f.read().personal.reward).toBe('claimed');expect(f.inventory.ensure(f.host).apples).toBe(5);
    expect(f.story.read(f.home,f.host).personal.inventory).toEqual(f.read().personal.inventory);
  });
});

describe('atomic NPC harm and personal spirit effects through both room services',()=>{
  it('records a real knife hit as a lasting victim-specific incident and only restitution to that victim resolves it',()=>{
    const f=fixture();f.arm();f.attack('npc:spirit-lumen');
    expect(f.residents.get('npc:spirit-lumen')!.health).toBe(70);
    expect(f.read().personal.incidents.map(incident=>incident.npcId)).toEqual(['spirit-lumen']);expect(f.read(f.guest).personal.incidents).toEqual([]);
    expect(f.livingStore.read(f.home,f.host).personal.trust).toBeLessThan(0);
    vi.setSystemTime(Date.now()+300_000);f.living.push(f.host);
    expect(f.livingStore.read(f.home,f.host).personal.relationships.find(memory=>memory.npcId==='spirit-lumen')).toMatchObject({trust:0,fear:0});
    f.act('ward');expect(f.receipts().at(-1)!.status).toBe('blocked');
    f.apples(5);f.act('restitute');expect(f.read().personal.inventory.apples).toBe(5);expect(f.read().personal.incidents[0]!.resolvedAt).toBe(0);
    f.act('restitute',f.host,{npcId:'npc:spirit-lumen'});expect(f.inventory.ensure(f.host).apples).toBe(3);expect(f.read().personal.incidents[0]!.resolvedAt).toBe(Date.now());
    f.act('ward');expect(f.receipts().at(-1)!.status).toBe('updated');
  });

  it('rolls reputation, incident and both receipts back before physical damage when the inner incident write fails',()=>{
    const f=fixture();f.arm();const before=f.livingStore.read(f.home,f.host).personal;
    f.db.db.exec("CREATE TRIGGER fail_room_incident BEFORE INSERT ON stolen_lantern_receipts BEGIN SELECT RAISE(ABORT,'inner incident failed'); END");
    f.attack();expect(f.npcApi.damage).not.toHaveBeenCalled();expect(f.residents.get('npc:washer-elsie')!.health).toBe(100);
    expect(f.livingStore.read(f.home,f.host).personal).toEqual(before);expect(f.read().personal.incidents).toEqual([]);expect(f.db.db.isTransaction).toBe(false);
    expect(f.db.db.prepare('SELECT count(*) AS n FROM living_world_receipts').get()!.n).toBe(0);expect(f.db.db.prepare('SELECT count(*) AS n FROM stolen_lantern_receipts').get()!.n).toBe(0);
    f.db.db.exec('DROP TRIGGER fail_room_incident');vi.setSystemTime(Date.now()+800);f.attack();
    expect(f.residents.get('npc:washer-elsie')!.health).toBe(70);expect(f.read().personal.incidents).toHaveLength(1);
  });

  it('replays a knife command across real SQLite reopen without another hit or another lasting incident',()=>{
    const f=fixture(true);f.arm();const c=f.attack(),original=f.read().personal.incidents[0]!,trust=f.livingStore.read(f.home,f.host).personal.trust;
    f.dispatch(c);expect(f.npcApi.damage).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now()+1_000);f.restart(true);f.arm();
    // Keep the original command's area fence, as a resumed connection does.
    f.players.get(f.host)!.zoneRevision='zoneRevision' in c?c.zoneRevision:0;
    f.dispatch(c);expect(f.npcApi.damage).toHaveBeenCalledTimes(1);expect(f.residents.get('npc:washer-elsie')!.health).toBe(70);
    expect(f.read().personal.incidents).toEqual([original]);expect(f.livingStore.read(f.home,f.host).personal.trust).toBe(trust);
  });

  it('does not let a watching member strike an NPC while still allowing peaceful quest actions',()=>{
    const f=fixture();f.arm();f.players.get(f.host)!.watching=true;f.attack();
    expect(f.npcApi.damage).not.toHaveBeenCalled();expect(f.read().personal.incidents).toEqual([]);
    f.act('begin');expect(f.read().quest.stage).toBe('ask-pip');
  });

  it('applies an actual Morrow pulse, clears it through Lumen, and preserves the ward deadline across restart',()=>{
    const f=fixture(true),tell=f.pulse();vi.setSystemTime(tell.until);f.lantern.tick(Date.now(),true);
    const snare=f.read().personal.snareUntil;expect(snare).toBe(Date.now()+5_000);expect(f.players.get(f.host)!.spiritEffects?.snareUntil).toBe(snare);
    const wardCommand=f.act('ward'),ward=f.read().personal.wardUntil,ready=f.read().personal.wardReadyAt;
    expect(f.read().personal.snareUntil).toBe(0);expect(ward).toBe(Date.now()+20_000);expect(ready).toBe(Date.now()+60_000);
    vi.setSystemTime(Date.now()+10_000);f.restart(true);f.send.mockClear();f.dispatch(wardCommand);
    expect(f.read().personal.wardUntil).toBe(ward);expect(f.read().personal.wardReadyAt).toBe(ready);
    f.lantern.tick(Date.now(),true);expect(f.lantern.patrol.snapshot().pulses).toEqual([]);
    vi.setSystemTime(ward);f.lantern.tick(Date.now(),true);const next=f.lantern.patrol.snapshot().pulses[0]!;expect(next).toBeDefined();
    vi.setSystemTime(next.until);f.lantern.tick(Date.now(),true);expect(f.read().personal.snareUntil).toBe(next.until+5_000);
  });

  it('does not renew a snare when reopening after its absolute expiry',()=>{
    const f=fixture(true),tell=f.pulse();vi.setSystemTime(tell.until);f.lantern.tick(Date.now(),true);const until=f.read().personal.snareUntil;
    vi.setSystemTime(until+1);f.restart(true);
    expect(f.read().personal.snareUntil).toBe(until);expect(f.players.get(f.host)!.spiritEffects?.snareUntil).toBeLessThan(Date.now());
  });

  it.each(['watching','respawning','disconnected','indoors','new-life','new-zone','race'] as const)('cancels the actual pending snare when the target becomes %s',state=>{
    const f=fixture(),tell=f.pulse(),p=f.players.get(f.host)!;
    if(state==='watching')p.watching=true;
    if(state==='respawning')p.respawnAt=Date.now()+5_000;
    if(state==='disconnected')p.connected=false;
    if(state==='indoors')p.zone=LANTERN_CAVE.id as PlayerState['zone'];
    if(state==='new-life')p.respawnCount=(p.respawnCount??0)+1;
    if(state==='new-zone')p.zoneRevision=(p.zoneRevision??0)+1;
    if(state==='race')p.mode='race';
    vi.setSystemTime(tell.until);f.lantern.tick(Date.now(),true);
    expect(f.read().personal.snareUntil).toBe(0);expect(f.lantern.patrol.snapshot().pulses).toEqual([]);
    expect(f.db.db.prepare('SELECT count(*) AS n FROM stolen_lantern_receipts').get()!.n).toBe(0);
  });
});
