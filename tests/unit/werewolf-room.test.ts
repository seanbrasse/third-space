import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { PartyRoom } from "../../apps/game-server/src/PartyRoom";
import { LocalStore } from "../../packages/data/src/index";
import {
  GAME_CONFIG,
  getWorld,
  HOME_MAP,
  RACE_MAP,
} from "../../packages/config/src/index";
import { overlapsPlayer } from "../../packages/simulation/src/index";
import type {
  ClientCommand,
  RoomSnapshot,
  SocialEffect,
  ChatMessage,
  ServerNotice,
  WorldSoundEvent,
} from "../../packages/contracts/src/index";

type AuthorityClient = Parameters<PartyRoom["onJoin"]>[0];
type Admission = ReturnType<PartyRoom["onAuth"]>;
type Message = { type: string | number; value: unknown };

/** Transport fixture only: all admission, commands, simulation and output policy
 * below execute the actual PartyRoom against the actual SQLite provider. */
class TestClient {
  sessionId = randomUUID();
  auth!: Admission;
  messages: Message[] = [];
  closedCode?: number;
  constructor(private room: PartyRoom) {}
  send(type: string | number, value: unknown) {
    this.messages.push({ type, value: structuredClone(value) });
  }
  leave(code = 1000) {
    this.closedCode = code;
    this.room.onLeave(this.authority());
  }
  authority() {
    return this as unknown as AuthorityClient;
  }
  received<T>(type: string) {
    return this.messages
      .filter((message) => message.type === type)
      .map((message) => message.value as T);
  }
  snapshot() {
    return this.received<RoomSnapshot>("snapshot").at(-1)!;
  }
}

class Harness {
  store = new LocalStore({ path: ":memory:" });
  room = new PartyRoom();
  identities: string[] = [];
  homeId: string;
  clients: TestClient[] = [];
  private pingHandler!: (client: AuthorityClient, raw: unknown) => unknown;
  ping(client: TestClient, raw: unknown) {this.pingHandler(client.authority(),raw);}
  private commandHandler!: (client: AuthorityClient, raw: unknown) => unknown;
  private timestep!: (dt: number) => unknown;
  private intervals: { callback: () => void; ms: number }[] = [];
  private time = Date.now();
  private ticks = 0;
  constructor(worldId: "living-room" | "forest" = "living-room") {
    this.room.worldId = worldId;
    for (let i = 0; i < GAME_CONFIG.partyCapacity + 1; i++)
      this.identities.push(
        this.store.createIdentity({ name: `Friend ${i + 1}` }).profile.id,
      );
    const home = this.store.createHome(this.identities[0]!, {
      name: "Eight friends",
      pin: "123456",
    });
    this.homeId = home.id;
    // The room fixture isolates the authority limit from provider migration tests.
    this.store.db
      .prepare("UPDATE homes SET capacity=? WHERE id=?")
      .run(GAME_CONFIG.partyCapacity, home.id);
    for (const id of this.identities.slice(1))
      this.store.joinHome(home.id, id, { pin: "123456" });
    PartyRoom.store = this.store;
    vi.spyOn(this.room, "setMatchmaking").mockResolvedValue();
    vi.spyOn(this.room, "setTimestep").mockImplementation((callback) => {
      this.timestep = callback!;
    });
    vi.spyOn(this.room, "onMessage").mockImplementation(
      (type: string | number, callback: unknown) => {
        if (type === "connection.ping") this.pingHandler = callback as typeof this.pingHandler;
        if (type === "command")
          this.commandHandler = callback as typeof this.commandHandler;
      },
    );
    vi.spyOn(this.room.clock, "setInterval").mockImplementation(
      (callback: Function, ms: number) => {
        this.intervals.push({ callback: () => callback(), ms });
        return {} as ReturnType<typeof this.room.clock.setInterval>;
      },
    );
    this.room.onCreate({ homeId: home.id });
  }
  authenticate(id: string) {
    const client = new TestClient(this.room);
    client.auth = this.room.onAuth(client.authority(), {
      homeId: this.homeId,
      ticket: this.store.issueTicket(this.homeId, id).ticket,
    });
    return client;
  }
  join(id: string, replaceExisting = false) {
    const client = this.authenticate(id);
    this.room.onJoin(client.authority(), { replaceExisting });
    this.clients.push(client);
    return client;
  }
  fill() {
    return this.identities
      .slice(0, GAME_CONFIG.partyCapacity)
      .map((id) => this.join(id));
  }
  send(client: TestClient, command: ClientCommand | unknown) {
    this.commandHandler(client.authority(), command);
  }
  snapshots() {
    this.intervals
      .find((interval) => interval.ms === 1000 / GAME_CONFIG.snapshotHz)!
      .callback();
  }
  advance(count: number, beforeTick?: (tick: number) => void) {
    for (let i = 0; i < count; i++) {
      this.time += 1000 / GAME_CONFIG.simulationHz;
      vi.setSystemTime(Math.round(this.time));
      beforeTick?.(i);
      this.timestep(1000 / GAME_CONFIG.simulationHz);
      this.ticks++;
      if (this.ticks % 3 === 0) this.snapshots();
      if (this.ticks % GAME_CONFIG.simulationHz === 0)
        this.intervals.find((interval) => interval.ms === 1000)!.callback();
    }
  }
  ready(clients: TestClient[]) {
    for (const client of clients) {
      Object.assign(this.room.players.get(client.auth.userId)!, {
        x: 17,
        y: 12.5,
      });
      this.send(client, { type: "race.ready", ready: true });
    }
  }
  close() {
    this.room.onDispose();
    this.room.clock.clear();
    this.store.close();
  }
}


import { ForestWerewolf } from '../../apps/game-server/src/ForestWerewolf';
import { ForestEncounter } from '../../apps/game-server/src/ForestStalker';
import type { WorldDefinition } from '../../packages/config/src/index';
const wolfWorld: WorldDefinition={...getWorld('forest'),map:{...getWorld('forest').map,solids:[],furniture:[{id:'far-tree',kind:'tree',footprint:{x:43,y:43,width:2,height:3},collider:null,usePoints:[],seats:[]}]}};
let harness: Harness;
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(1000000);harness=new Harness('forest');});
afterEach(()=>{harness.close();vi.restoreAllMocks();vi.useRealTimers();});
function setup(){
 const clients=harness.identities.slice(0,3).map(id=>harness.join(id));
 (harness.room as unknown as {npcs:unknown}).npcs=null;
 const authority=harness.room as unknown as {werewolf:ForestWerewolf|null;encounter:ForestEncounter|null;changeWorld(id:'living-room'|'forest'):void};
 const wolf=new ForestWerewolf(wolfWorld,()=>.5);wolf.reset(Date.now()-150000);authority.werewolf=wolf;authority.encounter=null;
 for(const c of clients)Object.assign(harness.room.players.get(c.auth.userId)!,{x:30,y:45,seatId:undefined});
 harness.room.players.get(clients[2]!.auth.userId)!.mode='race';
 return {clients,authority,wolf};
}
describe('werewolf PartyRoom integration',()=>{
 it('broadcasts reliable clown acquisition once and never replays it to a reconnecting player',()=>{
  const {clients,authority}=setup(); authority.werewolf=null;
  const w={...wolfWorld,map:{...wolfWorld.map,furniture:[{...wolfWorld.map.furniture[0]!,footprint:{x:34,y:43,width:2,height:3}}]}};
  const clown=new ForestEncounter(w,()=>.9); clown.reset(Date.now()-40000); authority.encounter=clown;
  harness.advance(3);
  for(const c of clients.slice(0,2)){const cues=c.received<WorldSoundEvent>('world.sound').filter(e=>e.kind==='giggle');expect(cues).toHaveLength(1);expect(cues[0]?.id).toContain(':clown:');}
  expect(clients[2]!.received<WorldSoundEvent>('world.sound')).toEqual([]);
  harness.advance(3);expect(clients[0]!.received<WorldSoundEvent>('world.sound').filter(e=>e.kind==='giggle')).toHaveLength(1);
  const id=clients[0]!.auth.userId;clients[0]!.leave();const replacement=harness.join(id);harness.snapshots();
  expect(replacement.received<WorldSoundEvent>('world.sound')).toEqual([]);
 });
 it('broadcasts one identical spawn howl, no visible spawn state, no racer cue and no reconnect replay',()=>{
  const {clients,wolf}=setup();harness.advance(3);
  expect(wolf.state).not.toBeNull();
  for(const c of clients.slice(0,2)){expect(c.received<WorldSoundEvent>('world.sound').map(e=>e.kind)).toEqual(['howl']);expect(c.snapshot().werewolf).toBeNull();}
  expect(clients[0]!.received<WorldSoundEvent>('world.sound')[0]!.id).toBe(clients[1]!.received<WorldSoundEvent>('world.sound')[0]!.id);
  expect(clients[2]!.received<WorldSoundEvent>('world.sound')).toEqual([]);
  const id=clients[0]!.auth.userId;clients[0]!.leave();const replacement=harness.join(id);harness.snapshots();
  expect(replacement.received<WorldSoundEvent>('world.sound')).toEqual([]);
  harness.advance(3);expect(clients[1]!.received<WorldSoundEvent>('world.sound').filter(e=>e.kind==='howl')).toHaveLength(1);
 });
 it('shares growls/catch without giggle or knife, then respawns through existing authority',()=>{
  const {clients}=setup();harness.advance(600);
  const sounds=clients.slice(0,2).flatMap(c=>c.received<WorldSoundEvent>('world.sound'));
  expect(sounds.some(e=>e.kind==='growl')).toBe(true);expect(sounds.some(e=>e.kind==='claw')).toBe(true);expect(sounds.filter(e=>e.kind==='claw').every(e=>e.id.includes(':werewolf:')&&e.id.endsWith(':hit:'+e.victimId))).toBe(true);
  expect(sounds.some(e=>e.kind==='giggle'||e.kind==='slash')).toBe(false);
  expect([...harness.room.players.values()].some(p=>(p.respawnCount??0)>0)).toBe(true);
  expect(clients[2]!.received<WorldSoundEvent>('world.sound')).toEqual([]);
 });
 it('never overlaps the clown and discards the wolf on world/race transitions',()=>{
  const {clients,authority,wolf}=setup();const clown=new ForestEncounter(wolfWorld,()=>.5);clown.reset(Date.now());
  clown.state={id:'occupied',x:43,y:45,targetId:clients[0]!.auth.userId,coverId:'tree',phase:'peek',startedAt:Date.now(),phaseUntil:Date.now()+3000};authority.encounter=clown;
  harness.advance(3);expect(wolf.state).toBeNull();expect(clients[0]!.received<WorldSoundEvent>('world.sound')).toEqual([]);
  authority.encounter=null;harness.advance(3);expect(wolf.state).not.toBeNull();
  const target=harness.room.players.get(wolf.state!.targetId)!;target.mode='race';harness.advance(3);expect(wolf.state?.phase).toBe('peek');expect(wolf.state?.targetId).not.toBe(target.id);
  authority.changeWorld('living-room');harness.snapshots();expect(authority.werewolf).toBeNull();expect(clients[1]!.snapshot().werewolf).toBeNull();
 });
});
