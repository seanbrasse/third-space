import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createIdlePresence, idleStatus, IDLE_POLICY, recordActivity, recordWatching } from '../../apps/game-server/src/idle-policy';
import { PartyRoom } from '../../apps/game-server/src/PartyRoom';
import { LocalStore } from '../../packages/data/src/index';
import { GAME_CONFIG } from '@third-space/config';
import type { RoomSnapshot } from '@third-space/contracts';
type Client = Parameters<PartyRoom['onJoin']>[0];
let store: LocalStore, room: PartyRoom, clients: Client[], ids: string[], command: (client: Client, raw: unknown) => void;
const internal = () => room as unknown as { revalidate(): void; sendSnapshots(): void; hostId: string | null; idlePresence: Map<string, ReturnType<typeof createIdlePresence>> };
function at(ms: number) { vi.setSystemTime(ms); internal().revalidate(); internal().sendSnapshots(); }
function latest(index=0) { return vi.mocked(clients[index].send).mock.calls.filter(([name])=>name==='snapshot').at(-1)![1] as RoomSnapshot; }
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(1_000_000);
  store = new LocalStore({ path: ':memory:' });
  ids = ['Owner', 'Friend'].map(name=>store.createIdentity({name}).profile.id);
  const home = store.createHome(ids[0], { name:'Idle fixture', pin:'123456' }); store.joinHome(home.id, ids[1], {pin:'123456'});
  PartyRoom.store = store; room = new PartyRoom();
  vi.spyOn(room,'setMatchmaking').mockResolvedValue(); vi.spyOn(room,'setTimestep').mockImplementation(()=>{}); vi.spyOn(room.clock,'setInterval').mockImplementation(()=>({} as never));
  vi.spyOn(room,'onMessage').mockImplementation((type,handler)=>{if(type==='command')command=handler as typeof command;}); room.onCreate({homeId:home.id});
  clients=ids.map(id=>({sessionId:id,auth:room.onAuth({} as Client,{homeId:home.id,ticket:store.issueTicket(home.id,id).ticket}),send:vi.fn(),leave:vi.fn()} as unknown as Client));
  clients.forEach(client=>room.onJoin(client,{}));
});
afterEach(()=>{room.onDispose();store.close();vi.restoreAllMocks();vi.useRealTimers();});
describe('authoritative idle lifecycle',()=>{
  it('warns exactly at 15 minutes and removes presence at 18, with a separate kick code',()=>{
    const start=Date.now(); at(start+IDLE_POLICY.warningMs-1); expect(latest().idle!.warningAt).toBe(start+IDLE_POLICY.warningMs); expect(clients[0].leave).not.toHaveBeenCalled();
    at(start+IDLE_POLICY.warningMs); expect(idleStatus(internal().idlePresence.get(ids[0])!,Date.now()).warned).toBe(true);
    at(start+IDLE_POLICY.warningMs+IDLE_POLICY.graceMs-1);expect(room.players.has(ids[0])).toBe(true);
    at(start+IDLE_POLICY.warningMs+IDLE_POLICY.graceMs);expect(room.players.has(ids[0])).toBe(false);expect(clients[0].leave).toHaveBeenCalledWith(4012);
  });
  it('late resumed-tab input and playback reports cannot revive an expired deadline before the periodic sweep',()=>{
    room.players.get(ids[0])!.zone='asylum';room.media={revision:1,url:'https://youtu.be/abc123def45',playing:true,playbackId:'video',position:0,anchorAt:Date.now()};
    vi.setSystemTime(Date.now()+IDLE_POLICY.warningMs+IDLE_POLICY.graceMs);
    command(clients[0],{type:'presence.watching',playbackId:'video'});
    expect(room.players.has(ids[0])).toBe(false);expect(clients[0].leave).toHaveBeenCalledWith(4012);
    command(clients[1],{type:'presence.stay'});expect(room.players.has(ids[1])).toBe(false);
  });
  it('reconnecting after the idle deadline cannot reset it or briefly restore a ghost',async()=>{
    vi.spyOn(room,'allowReconnection').mockResolvedValue(clients[0] as never);await room.onDrop(clients[0]);
    vi.setSystemTime(Date.now()+IDLE_POLICY.warningMs+IDLE_POLICY.graceMs);room.onReconnect(clients[0]);
    expect(room.players.has(ids[0])).toBe(false);expect(clients[0].leave).toHaveBeenCalledWith(4012);
  });
  it('neutral repeated input and transport/snapshot updates do not cancel a warning',()=>{
    const start=Date.now();at(start+IDLE_POLICY.warningMs);
    for(let seq=1;seq<=10;seq++)command(clients[0],{type:'input',input:{seq,axisX:0,axisY:0,jump:false}});
    internal().sendSnapshots();expect(latest().idle!.warningAt).toBe(start+IDLE_POLICY.warningMs);
  });
  it('accepted movement and explicit I am here cancel the warning and reset both deadlines',()=>{
    const start=Date.now();at(start+IDLE_POLICY.warningMs);command(clients[0],{type:'presence.stay'}); internal().sendSnapshots();expect(latest().idle!.warningAt).toBe(Date.now()+IDLE_POLICY.warningMs);
    at(Date.now()+IDLE_POLICY.warningMs);command(clients[0],{type:'input',input:{seq:1,axisX:1,axisY:0,jump:false}});internal().sendSnapshots();expect(latest().idle!.warningAt).toBe(Date.now()+IDLE_POLICY.warningMs);
  });
  it('rejects stale movement/world commands as activity and rejects client timestamps',()=>{
    const start=Date.now();at(start+IDLE_POLICY.warningMs);command(clients[0],{type:'input',input:{seq:1,axisX:1,axisY:0,jump:false},worldRevision:999});command(clients[0],{type:'presence.activity',now:999999999});internal().sendSnapshots();expect(latest().idle!.warningAt).toBe(start+IDLE_POLICY.warningMs);
  });
  it('shared playback alone, wrong playback IDs, and outside avatars never extend idle time',()=>{
    room.media={revision:1,url:'https://youtu.be/abc123def45',playing:true,playbackId:'video',position:0,anchorAt:Date.now()};const start=Date.now();at(start+IDLE_POLICY.warningMs);
    command(clients[0],{type:'presence.watching',playbackId:'video'});room.players.get(ids[0])!.zone='asylum';command(clients[0],{type:'presence.watching',playbackId:'old'});internal().sendSnapshots();expect(latest().idle!.warningAt).toBe(start+IDLE_POLICY.warningMs);
  });
  it('visible actual-player heartbeats protect long watching, but stopped/hidden heartbeats expire',()=>{
    const start=Date.now();room.players.get(ids[0])!.zone='asylum';room.media={revision:1,url:'https://youtu.be/abc123def45',playing:true,playbackId:'video',position:0,anchorAt:start};
    for(let elapsed=5000;elapsed<=20*60_000;elapsed+=5000){vi.setSystemTime(start+elapsed);command(clients[0],{type:'presence.watching',playbackId:'video'});internal().revalidate();}
    expect(room.players.has(ids[0])).toBe(true);const last=Date.now();at(last+IDLE_POLICY.warningMs);expect(room.players.has(ids[0])).toBe(true);at(last+IDLE_POLICY.warningMs+IDLE_POLICY.graceMs);expect(clients[0].leave).toHaveBeenCalledWith(4012);
  });
  it('paused media cannot renew watching exemption',()=>{
    room.players.get(ids[0])!.zone='asylum';room.media={revision:1,url:'https://youtu.be/abc123def45',playing:false,playbackId:'video',position:0,anchorAt:Date.now()};const start=Date.now();at(start+IDLE_POLICY.warningMs);command(clients[0],{type:'presence.watching',playbackId:'video'});expect(internal().idlePresence.get(ids[0])!.lastActivityAt).toBe(start);
  });
  it('disconnect immediately marks avatar reconnecting and uses existing bounded 30 second reservation',async()=>{
    let reject!:()=>void;vi.spyOn(room,'allowReconnection').mockImplementation((_client,seconds)=>{expect(seconds).toBe(GAME_CONFIG.reconnectGraceMs/1000);return new Promise((_resolve,rejectPromise)=>{reject=()=>rejectPromise(new Error('expired'));}) as never;});
    const drop=room.onDrop(clients[0]);expect(room.players.get(ids[0])!.connected).toBe(false);expect(latest(1).members!.find(p=>p.id===ids[0])!.connected).toBe(false);expect(GAME_CONFIG.reconnectGraceMs).toBe(30_000);
    reject();await drop;room.onLeave(clients[0]);expect(room.players.has(ids[0])).toBe(false);
  });
  it('valid reconnect within grace retains the same player and idle deadline',async()=>{
    const player=room.players.get(ids[0])!, deadline=latest().idle!.kickAt;vi.spyOn(room,'allowReconnection').mockResolvedValue(clients[0] as never);
    await room.onDrop(clients[0]);vi.setSystemTime(Date.now()+20_000);room.onReconnect(clients[0]);expect(room.players.get(ids[0])).toBe(player);expect(player.connected).toBe(true);expect(latest().idle!.kickAt).toBe(deadline);
  });
  it('idle host removal transfers to an eligible connected participant; fresh rejoin creates new deadline',()=>{
    room.roles.set(ids[1],'moderator');const start=Date.now();at(start+IDLE_POLICY.warningMs+IDLE_POLICY.graceMs-1000);command(clients[1],{type:'presence.stay'});at(start+IDLE_POLICY.warningMs+IDLE_POLICY.graceMs);expect(internal().hostId).toBe(ids[1]);
    room.onJoin(clients[0],{});expect(room.players.get(ids[0])!.connected).toBe(true);expect(internal().idlePresence.get(ids[0])!.lastActivityAt).toBe(Date.now());expect(store.canAccess(room.homeId,ids[0])).toBe(true);
  });
});
describe('idle policy clock boundaries',()=>{
  it('preserves server-time deadlines and clears grace with activity',()=>{const p=createIdlePresence(100);expect(idleStatus(p,100+IDLE_POLICY.warningMs).warned).toBe(true);recordActivity(p,200);expect(idleStatus(p,200).warned).toBe(false);recordWatching(p,300);expect(p.lastActivityAt).toBe(300);expect(idleStatus(p,300+IDLE_POLICY.warningMs+IDLE_POLICY.graceMs).expired).toBe(true);});
});
