import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {PartyRoom} from '../../apps/game-server/src/PartyRoom';
import {LocalStore} from '../../packages/data/src';
import {getWorld} from '../../packages/config/src';
import {LANTERN_CAVE,LANTERN_CAVE_ANCHOR,LANTERN_CAVE_DOOR} from '../../packages/config/src/lantern-cave';
import {isHomeWalkable,isHomeSegmentWalkable} from '../../packages/simulation/src';
import type {RoomSnapshot} from '../../packages/contracts/src';
import type {StolenLanternSnapshot} from '../../packages/contracts/src/stolen-lantern';
import type {LivingWorldSnapshot} from '../../packages/contracts/src/living-world';
import type {ForestNPCController} from '../../apps/game-server/src/ForestNPCController';
import type {LivingWorldRoom} from '../../apps/game-server/src/living-world-room';
import type {StolenLanternRoom} from '../../apps/game-server/src/stolen-lantern-room';
type Client=Parameters<PartyRoom['onJoin']>[0];
type Authority={npcs:ForestNPCController;living:LivingWorldRoom;stolen:StolenLanternRoom;sendSnapshots():void};
let db:LocalStore,room:PartyRoom,clients:Client[],ids:string[],home:string,serial:number;
let command:(c:Client,raw:unknown)=>void,tick:(ms:number)=>void;
const authority=()=>room as unknown as Authority;
function latest<T>(i:number,type:string){return vi.mocked(clients[i]!.send).mock.calls.filter(c=>c[0]===type).at(-1)?.[1] as T;}
function send(i:number,payload:Record<string,unknown>){const p=room.players.get(ids[i]!)!;command(clients[i]!,{commandId:`lantern-party-${++serial}`,worldRevision:room.worldRevision,lifeRevision:p.respawnCount??0,zoneRevision:p.zoneRevision??0,...payload});}
function place(i:number,point:{x:number;y:number}){const p=room.players.get(ids[i]!)!;Object.assign(p,point);delete p.seatId;delete p.haloUntil;return p;}
function act(i:number,name:string,action:string){
 const npc=authority().npcs.get(`npc:${name}`)!;
 const point=[{x:npc.x+.5,y:npc.y},{x:npc.x-.5,y:npc.y},{x:npc.x,y:npc.y+.5}].find(p=>isHomeWalkable(p,getWorld('forest').map)&&isHomeSegmentWalkable(p,npc,getWorld('forest').map))!;
 expect(point).toBeDefined();place(i,point);
 send(i,{type:'npc.interact',npcId:npc.id});
 send(i,{type:'npc.action',npcId:npc.id,targetLifeRevision:npc.lifeRevision??0,actionId:`stolen:${action}`,expectedInventoryRevision:latest<LivingWorldSnapshot>(i,'living.snapshot').personal.inventory.revision});
 vi.setSystemTime(Date.now()+1100);
}
beforeEach(()=>{
 vi.useFakeTimers();vi.setSystemTime(1_000_000);serial=0;db=new LocalStore({path:':memory:'});
 ids=Array.from({length:8},(_,i)=>db.createIdentity({name:`Lantern ${i}`}).profile.id);home=db.createHome(ids[0]!,{name:'Lantern home',pin:'123456'}).id;
 db.db.prepare('UPDATE homes SET capacity=8 WHERE id=?').run(home);ids.slice(1).forEach(id=>db.joinHome(home,id,{pin:'123456'}));
 PartyRoom.store=db;room=new PartyRoom();room.worldId='forest';vi.spyOn(room,'setMatchmaking').mockResolvedValue();
 vi.spyOn(room,'onMessage').mockImplementation((type,handler)=>{if(type==='command')command=handler as typeof command;});
 vi.spyOn(room,'setTimestep').mockImplementation(fn=>{tick=fn!;});vi.spyOn(room.clock,'setInterval').mockReturnValue({} as ReturnType<typeof room.clock.setInterval>);
 room.onCreate({homeId:home});clients=ids.map((id,i)=>{const c={sessionId:`lantern-${i}`,send:vi.fn(),leave:vi.fn()} as unknown as Client;c.auth=room.onAuth(c,{homeId:home,ticket:db.issueTicket(home,id).ticket});room.onJoin(c,{});return c;});
});
afterEach(()=>{room.onDispose();room.clock.clear();db.close();vi.restoreAllMocks();vi.useRealTimers();});
it('admits all eight through the real cave door, isolates interiors, fences stale recovery and returns everyone safely',()=>{
 send(0,{type:'interior.enter',interiorId:LANTERN_CAVE.id});expect(room.players.get(ids[0]!)!.zone).toBeUndefined();
 for(let i=0;i<8;i++){place(i,LANTERN_CAVE_DOOR.point);send(i,{type:'interior.enter',interiorId:LANTERN_CAVE.id});expect(room.players.get(ids[i]!)!.zone).toBe(LANTERN_CAVE.id);}
 const positions=[...room.players.values()];expect(new Set(positions.map(p=>`${p.x},${p.y}`)).size).toBe(8);
 authority().sendSnapshots();const state=latest<RoomSnapshot>(0,'snapshot');expect(state.worldId).toBe(LANTERN_CAVE.id);expect(state.players).toHaveLength(8);expect(state.npcs).toBeUndefined();expect(state.members).toHaveLength(8);
 vi.setSystemTime(Date.now()+1600);
 for(let i=0;i<8;i++){place(i,LANTERN_CAVE.exit);send(i,{type:'interior.enter',interiorId:'outside'});expect(room.players.get(ids[i]!)!.zone).toBeUndefined();expect(isHomeWalkable(room.players.get(ids[i]!)!,getWorld('forest').map)).toBe(true);}
 expect(authority().npcs.snapshot()).toHaveLength(32);expect(room.players.size).toBe(8);
});
it('routes the finite quest through actual command admission and broadcasts shared custody with personal inventory receipts',()=>{
 act(0,'washer-elsie','begin');expect(latest<StolenLanternSnapshot>(7,'lantern.snapshot').quest.stage).toBe('ask-pip');
 act(1,'goblin-pip','ask-pip');expect(latest<StolenLanternSnapshot>(0,'lantern.snapshot').quest.stage).toBe('find-cave');
 place(0,LANTERN_CAVE_DOOR.point);send(0,{type:'lantern.recover'});expect(latest<StolenLanternSnapshot>(0,'lantern.snapshot').quest.stage).toBe('find-cave');
 send(0,{type:'interior.enter',interiorId:LANTERN_CAVE.id});place(0,LANTERN_CAVE_ANCHOR);
 send(0,{type:'lantern.recover',zoneRevision:0});expect(latest<StolenLanternSnapshot>(0,'lantern.snapshot').quest.stage).toBe('find-cave');
 send(0,{type:'lantern.recover'});expect(latest<StolenLanternSnapshot>(7,'lantern.snapshot').quest.custody).toBe('home');
 act(2,'washer-elsie','return');act(2,'washer-elsie','claim');
 expect(latest<StolenLanternSnapshot>(0,'lantern.snapshot').personal.reward).toBe('pending');
 expect(latest<StolenLanternSnapshot>(2,'lantern.snapshot').personal).toMatchObject({reward:'claimed',inventory:{apples:2}});
 act(2,'washer-elsie','claim');expect(latest<StolenLanternSnapshot>(2,'lantern.snapshot').personal.inventory.apples).toBe(2);
});
it('shares one navigation search per tick across civilian, road and goblin actors with all eight humans spread out',()=>{
 const points=[{x:64,y:82},{x:99,y:72},{x:46,y:85},{x:91,y:51},{x:124.5,y:22},{x:37.5,y:102},{x:72,y:95},{x:124,y:94}];
 points.forEach((p,i)=>place(i,p));
 for(let i=0;i<40;i++){vi.setSystemTime(Date.now()+100);tick(100);const a=authority();expect(a.npcs.diagnostics().lastPathSearches+a.living.controller.diagnostics().lastPathQueries+a.stolen.patrol.diagnostics().lastPathQueries).toBeLessThanOrEqual(1);}
 expect(room.players.size).toBe(8);expect(authority().stolen.patrol.snapshot().mobs).toHaveLength(2);
});
