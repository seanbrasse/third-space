import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {PartyRoom} from '../../apps/game-server/src/PartyRoom';
import {LocalStore} from '../../packages/data/src/index';
import {getWorld} from '../../packages/config/src/index';
import {isHomeSegmentWalkable} from '../../packages/simulation/src/index';
import type {RoomSnapshot, SurvivalPlayer} from '../../packages/contracts/src/index';
import type {SurvivalInventory} from '../../apps/game-server/src/survival-inventory';

type Client=Parameters<PartyRoom['onJoin']>[0];
let store:LocalStore,room:PartyRoom,clients:Client[],ids:string[],homeId:string,serial:number;
let command:(client:Client,raw:unknown)=>void,tick:(ms:number)=>void;
const authority=()=>room as unknown as {survival:SurvivalInventory;sendSnapshots:()=>void};
const inventory=(id:string)=>authority().survival.snapshot().players.find(p=>p.id===id)!;
function send(index:number, payload:Record<string,unknown>, context:Record<string,unknown>={}) {
  const p=room.players.get(ids[index]!)!;
  command(clients[index]!,{commandId:`survival-test-${++serial}`,worldRevision:room.worldRevision,...(payload.type==='survival.pvp'?{}:{lifeRevision:p.respawnCount??0,zoneRevision:p.zoneRevision??0}),...payload,...context});
}
function advance(ms:number) {for(let elapsed=0;elapsed<ms;elapsed+=50){vi.setSystemTime(Date.now()+50);tick(50);}}
function place(index:number,point:{x:number;y:number}) {const p=room.players.get(ids[index]!)!;Object.assign(p,{x:point.x,y:point.y});delete p.seatId;delete p.haloUntil;delete p.zone;return p;}
function knife(index:number) {const bag=authority().survival.snapshot().backpacks[0]!;place(index,bag);send(index,{type:'survival.pickup',backpackId:bag.id});send(index,{type:'survival.equip',item:'knife'});return bag.id;}
function duel() {
  const a=room.players.get(ids[0]!)!;
  const point=[{x:a.x+.7,y:a.y},{x:a.x-.7,y:a.y},{x:a.x,y:a.y+.7},{x:a.x,y:a.y-.7}].find(b=>isHomeSegmentWalkable(a,b,getWorld('forest').map))!;
  expect(point).toBeDefined();place(1,point);return a;
}
function snapshot(index:number) {authority().sendSnapshots();return (vi.mocked(clients[index]!.send).mock.calls.filter(c=>c[0]==='snapshot').at(-1)![1]) as RoomSnapshot;}
beforeEach(()=>{
  vi.useFakeTimers();vi.setSystemTime(1_000_000);serial=0;
  store=new LocalStore({path:':memory:'});ids=Array.from({length:8},(_,i)=>store.createIdentity({name:`Explorer ${i}`}).profile.id);
  homeId=store.createHome(ids[0]!,{name:'Survival room',pin:'123456'}).id;
  store.db.prepare('UPDATE homes SET capacity=8 WHERE id=?').run(homeId);
  ids.slice(1).forEach(id=>store.joinHome(homeId,id,{pin:'123456'}));
  PartyRoom.store=store;room=new PartyRoom();room.worldId='forest';
  vi.spyOn(room,'setMatchmaking').mockResolvedValue();
  vi.spyOn(room,'onMessage').mockImplementation((type,handler)=>{if(type==='command')command=handler as typeof command;});
  vi.spyOn(room,'setTimestep').mockImplementation(callback=>{tick=callback!;});
  vi.spyOn(room.clock,'setInterval').mockReturnValue({} as ReturnType<typeof room.clock.setInterval>);
  room.onCreate({homeId});
  clients=ids.map((id,i)=>{const client={sessionId:`survival-${i}`,send:vi.fn(),leave:vi.fn()} as unknown as Client;client.auth=room.onAuth(client,{homeId,ticket:store.issueTicket(homeId,id).ticket});room.onJoin(client,{});return client;});
  advance(50);
});
afterEach(()=>{room.onDispose();room.clock.clear();store.close();vi.restoreAllMocks();vi.useRealTimers();});

describe('survival through actual room admission, commands and life transitions',()=>{
  it('admits eight humans and atomically awards one contested backpack without duplicate knives',()=>{
    const bag=authority().survival.snapshot().backpacks[0]!;
    for(let i=0;i<8;i++){place(i,bag);send(i,{type:'survival.pickup',backpackId:bag.id});}
    const state=authority().survival.snapshot();
    expect(state.players.filter(p=>p.knifeId===bag.id)).toHaveLength(1);expect(state.backpacks).toHaveLength(1);
    expect(snapshot(7).survival?.players).toHaveLength(8);expect(snapshot(7).members).toHaveLength(8);
    expect(new Set([...state.players.flatMap(p=>p.knifeId?[p.knifeId]:[]),...state.backpacks.map(p=>p.id)]).size).toBe(2);
  });
  it('rejects remote pickup, client resource forgery and stale world/life/area commands',()=>{
    const bag=authority().survival.snapshot().backpacks[0]!;
    send(0,{type:'survival.pickup',backpackId:bag.id});expect(inventory(ids[0]!).knifeId).toBeUndefined();
    place(0,bag);
    for(const ctx of [{worldRevision:4},{lifeRevision:4},{zoneRevision:4},{health:1000}])send(0,{type:'survival.pickup',backpackId:bag.id},ctx);
    expect(inventory(ids[0]!).knifeId).toBeUndefined();expect(authority().survival.snapshot().backpacks).toHaveLength(2);
    send(0,{type:'survival.pickup',backpackId:bag.id});expect(inventory(ids[0]!).knifeId).toBe(bag.id);
  });
  it('harvests once, eats once and rejects replay after regrowth without granting another apple',()=>{
    const tree=authority().survival.snapshot().appleTrees[0]!;place(0,tree);
    const payload={type:'survival.harvest',treeId:tree.id,commandId:'same-harvest'};
    send(0,payload);send(0,payload);expect(inventory(ids[0]!).apples).toBe(1);
    send(0,{type:'survival.equip',item:'apple'});send(0,{type:'survival.eat',commandId:'same-eat'});send(0,{type:'survival.eat',commandId:'same-eat'});
    expect(inventory(ids[0]!)).toMatchObject({apples:0,hunger:100,equipped:null,selectedSlot:1});
    vi.setSystemTime(Date.now()+46_000);send(0,payload);expect(inventory(ids[0]!).apples).toBe(0);
  });
  it('fences host PvP policy, range, sanctuary, interior and respawn protection',()=>{
    knife(0);const a=duel();
    send(1,{type:'survival.pvp',enabled:false});expect(authority().survival.snapshot().pvpEnabled).toBe(true);
    send(0,{type:'survival.pvp',enabled:false});send(0,{type:'survival.attack',targetId:ids[1]});expect(inventory(ids[1]!).health).toBe(100);
    send(0,{type:'survival.pvp',enabled:true});
    const target=room.players.get(ids[1]!)!;
    for(const state of [{x:40,y:5},{x:24.5,y:24,zone:'asylum'},{x:24.5,y:24,haloUntil:Date.now()+5000}]){
      Object.assign(target,{zone:undefined,haloUntil:undefined},state);send(0,{type:'survival.attack',targetId:ids[1]});expect(inventory(ids[1]!).health).toBe(100);
    }
    const fire=getWorld('forest').fire!;Object.assign(a,fire);Object.assign(target,{...fire,x:fire.x+.5,zone:undefined,haloUntil:undefined});
    send(0,{type:'survival.attack',targetId:ids[1]});expect(inventory(ids[1]!).health).toBe(100);
  });
  it('applies authoritative damage/cooldown, one knockout, a calm cause and an ownership-safe respawn',()=>{
    knife(0);const victimKnife=knife(1);duel();
    send(0,{type:'survival.attack',targetId:ids[1],commandId:'first-swing'});
    send(0,{type:'survival.attack',targetId:ids[1],commandId:'first-swing'});
    send(0,{type:'survival.attack',targetId:ids[1]});expect(inventory(ids[1]!).health).toBe(70);
    for(let hit=0;hit<3;hit++){advance(850);send(0,{type:'survival.attack',targetId:ids[1]});}
    const victim=room.players.get(ids[1]!)!;expect(victim).toMatchObject({caughtBy:'player',respawnCount:1,vx:0,vy:0});expect(victim.respawnAt).toBeGreaterThan(Date.now());
    send(0,{type:'survival.attack',targetId:ids[1]});expect(victim.respawnCount).toBe(1);
    advance(1000);expect(inventory(ids[1]!)).toMatchObject({health:100,hunger:75,equipped:'flashlight',apples:0});expect(inventory(ids[1]!).knifeId).toBeUndefined();
    expect(authority().survival.snapshot().backpacks.some(b=>b.id===victimKnife)).toBe(true);expect(authority().survival.snapshot().backpacks.length).toBeLessThanOrEqual(2);
    expect(room.players.get(ids[1]!)!.haloUntil).toBeGreaterThan(Date.now());
    expect(vi.mocked(clients[1]!.send).mock.calls.filter(c=>c[0]==='world.sound')).toHaveLength(0);
  });
  it('keeps inventory through transport grace and returns its unique knife only on permanent departure',async()=>{
    const owned=knife(0);vi.spyOn(room,'allowReconnection').mockResolvedValue(clients[0]!);
    await room.onDrop(clients[0]!);advance(1000);expect(inventory(ids[0]!).knifeId).toBe(owned);
    room.onReconnect(clients[0]!);expect(inventory(ids[0]!).knifeId).toBe(owned);
    room.onLeave(clients[0]!);expect(authority().survival.snapshot().players.find(p=>p.id===ids[0])).toBeUndefined();
    expect(authority().survival.snapshot().backpacks.filter(b=>b.id===owned)).toHaveLength(1);
  });
  it('shows an authoritative finishing tell, shares the knife cooldown and applies one fenced knockout',()=>{
    knife(0);duel();
    const state=(authority().survival as unknown as {players:Map<string,SurvivalPlayer>}).players.get(ids[1]!)!;
    state.health=55;
    send(0,{type:'survival.finish',targetId:ids[1],targetLifeRevision:0});
    const tell=snapshot(1).survival!.finishers![0]!;
    expect(tell).toMatchObject({attackerId:ids[0],targetId:ids[1],targetLifeRevision:0});
    expect(tell.until-tell.startedAt).toBe(650);
    send(0,{type:'survival.attack',targetId:ids[1]});expect(inventory(ids[1]!).health).toBe(55);
    advance(700);expect(room.players.get(ids[1]!)!.respawnCount).toBe(1);
    expect(snapshot(1).survival!.finishers).toHaveLength(0);
    advance(1000);expect(room.players.get(ids[1]!)!.respawnCount).toBe(1);expect(inventory(ids[1]!).health).toBe(100);
  });
  it('cancels a lunge after attacker movement and rejects stale target life and host-disabled PvP',()=>{
    knife(0);duel();
    const state=(authority().survival as unknown as {players:Map<string,SurvivalPlayer>}).players.get(ids[1]!)!;state.health=55;
    send(0,{type:'survival.finish',targetId:ids[1],targetLifeRevision:99});expect(snapshot(0).survival!.finishers).toHaveLength(0);
    send(0,{type:'survival.finish',targetId:ids[1],targetLifeRevision:0});expect(snapshot(0).survival!.finishers).toHaveLength(1);
    room.players.get(ids[0]!)!.x+=1;advance(700);expect(inventory(ids[1]!).health).toBe(55);expect(snapshot(0).survival!.finishers).toHaveLength(0);
    send(0,{type:'survival.pvp',enabled:false});send(0,{type:'survival.finish',targetId:ids[1],targetLifeRevision:0});expect(snapshot(0).survival!.finishers).toHaveLength(0);
  });
  it('interrupts the lunge on a gear switch even when the knife is restored before the next simulation tick',()=>{
    knife(0);duel();
    const state=(authority().survival as unknown as {players:Map<string,SurvivalPlayer>}).players.get(ids[1]!)!;state.health=55;
    send(0,{type:'survival.finish',targetId:ids[1],targetLifeRevision:0});expect(snapshot(0).survival!.finishers).toHaveLength(1);
    send(0,{type:'survival.equip',item:'flashlight'});send(0,{type:'survival.equip',item:'knife'});
    advance(700);expect(inventory(ids[1]!).health).toBe(55);expect(snapshot(0).survival!.finishers).toHaveLength(0);
  });
  it('harvests authored orchard fruit, pays for and uses an authoritative potion without replay renewal',()=>{
    const trees=authority().survival.snapshot().appleTrees.filter(t=>t.id.startsWith('living:orchard-tree-'));
    expect(trees).toHaveLength(3);
    for(const tree of trees.slice(0,2)){place(0,tree);send(0,{type:'survival.harvest',treeId:tree.id});}
    expect(inventory(ids[0]!).apples).toBe(2);
    const npcs=(room as unknown as {npcs:import('../../apps/game-server/src/ForestNPCController').ForestNPCController}).npcs;
    const orin=npcs.get('npc:wizard-orin-vale')!;place(0,orin);
    send(0,{type:'npc.interact',npcId:orin.id});
    const view=()=>vi.mocked(clients[0]!.send).mock.calls.filter(c=>c[0]==='living.snapshot').at(-1)![1] as import('../../packages/contracts/src/living-world').LivingWorldSnapshot;
    const conversation=vi.mocked(clients[0]!.send).mock.calls.filter(c=>c[0]==='npc.conversation').at(-1)![1] as {view:{offers:import('../../packages/contracts/src/living-world').NPCActionOffer[]}};
    const offer=conversation.view.offers.find(o=>o.kind==='trade'&&o.potion==='strength')!;
    send(0,{type:'npc.action',npcId:orin.id,targetLifeRevision:orin.lifeRevision??0,actionId:offer.actionId,expectedInventoryRevision:view().personal.inventory.revision});
    expect(inventory(ids[0]!)).toMatchObject({apples:0,potions:{strength:1,speed:0}});
    send(0,{type:'survival.equip',item:'strength-potion'});
    const use={type:'living.use',potion:'strength',commandId:'potion-original-receipt',expectedInventoryRevision:view().personal.inventory.revision};
    send(0,use);const effect=room.players.get(ids[0]!)!.potionEffects![0]!;
    expect(effect.expiresAt-effect.startedAt).toBe(20000);expect(inventory(ids[0]!).potions!.strength).toBe(0);
    vi.setSystemTime(Date.now()+1000);send(0,use);
    expect(room.players.get(ids[0]!)!.potionEffects).toEqual([effect]);
    expect(vi.mocked(clients[1]!.send).mock.calls.filter(c=>c[0]==='npc.conversation')).toHaveLength(0);
    expect(snapshot(1).members.find(p=>p.id===ids[0])!.potionEffects).toEqual([effect]);
    expect(JSON.stringify(snapshot(1))).not.toContain('personalTrust');
  });
  it('routes starvation through the same once-only life fence and pauses idle or indoor hunger',()=>{
    const bag=authority().survival.snapshot().backpacks[0]!;place(0,bag);advance(1000);expect(inventory(ids[0]!).hunger).toBe(75);
    const state=(authority().survival as unknown as {players:Map<string,SurvivalPlayer>}).players.get(ids[0]!)!;
    state.hunger=0;state.health=.001;
    command(clients[0]!,{type:'input',input:{seq:1,axisX:1,axisY:0,jump:false}});advance(100);
    expect(room.players.get(ids[0]!)).toMatchObject({caughtBy:'hunger',respawnCount:1});advance(1000);expect(inventory(ids[0]!).health).toBe(100);
  });
});
