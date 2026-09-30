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
  private commandHandler!: (client: AuthorityClient, raw: unknown) => unknown;
  private timestep!: (dt: number) => unknown;
  private intervals: { callback: () => void; ms: number }[] = [];
  private time = Date.now();
  private ticks = 0;
  constructor() {
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

let harness: Harness;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  harness = new Harness();
});
afterEach(() => {
  harness.close();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function expectClearHomeSpawns(room: PartyRoom) {
  const players = [...room.players.values()].filter(
    (player) => player.mode === "home",
  );
  expect(new Set(players.map((player) => `${player.x}:${player.y}`)).size).toBe(
    players.length,
  );
  for (const player of players) {
    expect(HOME_MAP.solids.some((solid) => overlapsPlayer(player, solid))).toBe(
      false,
    );
    for (const other of players)
      if (player.id !== other.id)
        expect(
          Math.hypot(player.x - other.x, player.y - other.y),
        ).toBeGreaterThanOrEqual(2 * GAME_CONFIG.playerRadius);
  }
}

describe("eight-player authoritative party without network listeners", () => {
  it("uses shared furniture anchors for portal range and safely seats all eight avatars", () => {
    const clients = harness.fill();
    const first = clients[0]!;
    harness.send(first, {type: "race.ready", ready: true});
    expect(first.received<ServerNotice>("notice").at(-1)!.code).toBe("TOO_FAR");
    const portal = HOME_MAP.furniture.find((item) => item.id === HOME_MAP.portal.id)!;
    Object.assign(harness.room.players.get(first.auth.userId)!, portal.usePoints[0]);
    harness.send(first, {type: "race.ready", ready: true});
    expect(harness.room.race.readyIds).toEqual([first.auth.userId]);
    harness.send(first, {type: "race.ready", ready: false});
    clients.forEach((client, index) => {
      const seat = HOME_MAP.seats[index]!;
      const player = harness.room.players.get(client.auth.userId)!;
      Object.assign(player, {x: seat.x, y: seat.y + 0.6});
      harness.send(client, {type: "seat", seatId: seat.id});
      expect(player.seatId).toBe(seat.id);
      expect({x: player.x, y: player.y}).toEqual({x: seat.x, y: seat.y});
      expect(HOME_MAP.solids.some((solid) => overlapsPlayer(player, solid))).toBe(false);
    });
    expect(new Set([...harness.room.players.values()].map((player) => player.seatId)).size).toBe(8);
    Object.assign(harness.room.players.get(first.auth.userId)!, HOME_MAP.seats[1]);
    harness.send(first, {type: "seat", seatId: HOME_MAP.seats[1]!.id});
    expect(first.received<ServerNotice>("notice").at(-1)!.code).toBe("SEAT_TAKEN");
  });
  it("admits eight unique avatars, rejects the ninth and rechecks concurrent admissions at join", () => {
    const admitted = harness.identities.map((id) => harness.authenticate(id));
    for (const client of admitted.slice(0, 8))
      harness.room.onJoin(client.authority(), {});
    expect(harness.room.players.size).toBe(8);
    expect(harness.room.maxClients).toBe(9);
    expectClearHomeSpawns(harness.room);
    expect(() => harness.room.onJoin(admitted[8]!.authority(), {})).toThrow(
      /ROOM_FULL/,
    );
    expect(() => harness.authenticate(harness.identities[8]!)).toThrow(
      /ROOM_FULL/,
    );
    for (const client of admitted.slice(0, 8))
      expect(client.snapshot().players).toHaveLength(8);
  });

  it("uses freed authored spawns during churn and finds a clear fallback when moving occupants cover them", () => {
    const clients = harness.fill();
    const departed = harness.room.players.get(clients[2]!.auth.userId)!;
    const freed = { x: departed.x, y: departed.y };
    clients[2]!.leave();
    harness.join(harness.identities[8]!);
    const newcomer = harness.room.players.get(harness.identities[8]!)!;
    expect({ x: newcomer.x, y: newcomer.y }).toEqual(freed);
    expectClearHomeSpawns(harness.room);
    harness.room.onLeave(clients[0]!.authority());
    const occupants = [...harness.room.players.values()];
    // One avatar between the first two authored points covers both .3-radius bodies.
    occupants.forEach((player, index) =>
      Object.assign(
        player,
        index === 0 ? { x: 8.5, y: 12 } : HOME_MAP.spawns[index + 1]!,
      ),
    );
    const returning = harness.join(clients[0]!.auth.userId);
    const fallback = harness.room.players.get(returning.auth.userId)!;
    expect(
      HOME_MAP.spawns.some(
        (point) => point.x === fallback.x && point.y === fallback.y,
      ),
    ).toBe(false);
    expectClearHomeSpawns(harness.room);
  });

  it("replaces a tab at capacity without duplicating identity, movement authority or accepted chat", () => {
    const clients = harness.fill();
    const old = clients[0]!;
    harness.send(old, {
      type: "chat.send",
      commandId: "continued",
      text: "Same accepted message",
    });
    const accepted = old.received<ChatMessage>("chat")[0]!;
    expect(() => harness.join(old.auth.userId)).toThrow(/SESSION_ACTIVE/);
    const replacement = harness.join(old.auth.userId, true);
    expect(old.closedCode).toBe(4011);
    expect(harness.room.players.size).toBe(8);
    harness.send(replacement, {
      type: "chat.send",
      commandId: "continued",
      text: "Same accepted message",
    });
    expect(replacement.received<ChatMessage>("chat")[0]!.id).toBe(accepted.id);
    expect(clients[1]!.received<ChatMessage>("chat")).toHaveLength(1);
    const initial = harness.room.players.get(old.auth.userId)!.x;
    harness.send(old, {
      type: "input",
      input: { seq: 1, axisX: 1, axisY: 0, jump: false },
    });
    harness.advance(3);
    expect(harness.room.players.get(old.auth.userId)!.x).toBe(initial);
    expect(harness.room.clientsByUser.get(old.auth.userId)).toBe(
      replacement.authority(),
    );
  });

  it("reserves disconnected identities, reconnects one avatar and rejects revoked grace sessions", async () => {
    const clients = harness.fill();
    let resolve!: (client: AuthorityClient) => void;
    const reconnection = new Promise<AuthorityClient>((done) => {
      resolve = done;
    });
    const allow = vi
      .spyOn(harness.room, "allowReconnection")
      .mockReturnValue(
        reconnection as unknown as ReturnType<PartyRoom["allowReconnection"]>,
      );
    const client = clients[1]!;
    harness.send(client, {
      type: "input",
      input: { seq: 1, axisX: 1, axisY: 0, jump: false },
    });
    const drop = harness.room.onDrop(client.authority());
    expect(allow).toHaveBeenCalledWith(client.authority(), 30);
    expect(harness.room.players.get(client.auth.userId)!.connected).toBe(false);
    const position = harness.room.players.get(client.auth.userId)!.x;
    harness.advance(120);
    expect(harness.room.players.get(client.auth.userId)!.x).toBe(position);
    expect(() => harness.authenticate(harness.identities[8]!)).toThrow(
      /ROOM_FULL/,
    );
    harness.room.onReconnect(client.authority());
    resolve(client.authority());
    await drop;
    expect(harness.room.players.size).toBe(8);
    expect(harness.room.players.get(client.auth.userId)!.connected).toBe(true);
    const secondDrop = harness.room.onDrop(client.authority());
    harness.store.banMember(
      harness.homeId,
      clients[0]!.auth.userId,
      client.auth.userId,
    );
    expect(harness.room.players.size).toBe(7);
    harness.room.onReconnect(client.authority());
    expect(client.closedCode).toBe(4003);
    expect(harness.room.players.has(client.auth.userId)).toBe(false);
    await secondDrop;
    expectClearHomeSpawns(harness.room);
  });

  it("keeps the reserved slot until the transport reports grace expiry, then safely admits a replacement identity", async () => {
    const clients = harness.fill();
    let reject!: (reason: Error) => void;
    const deferred = new Promise<AuthorityClient>((_resolve, failed) => {
      reject = failed;
    });
    vi.spyOn(harness.room, "allowReconnection").mockReturnValue(
      deferred as unknown as ReturnType<PartyRoom["allowReconnection"]>,
    );
    const client = clients[4]!;
    const drop = harness.room.onDrop(client.authority());
    harness.advance(1_799);
    expect(harness.room.players.size).toBe(8);
    expect(() => harness.authenticate(harness.identities[8]!)).toThrow(
      /ROOM_FULL/,
    );
    harness.advance(1);
    // Colyseus owns the timer and invokes onLeave after rejecting reconnection.
    // This fixture supplies that transport event, rather than claiming a live timer proof.
    reject(new Error("Reconnection expired"));
    await drop;
    harness.room.onLeave(client.authority());
    const next = harness.join(harness.identities[8]!);
    expect(harness.room.players.size).toBe(8);
    expect(harness.room.players.has(client.auth.userId)).toBe(false);
    expect(harness.room.players.has(next.auth.userId)).toBe(true);
    expectClearHomeSpawns(harness.room);
  });

  it("keeps chat, social consent and shared voice settings inside the correct authoritative channel", () => {
    const clients = harness.fill();
    const source = clients[0]!,
      target = clients[1]!,
      spectator = clients[7]!;
    harness.send(source, {
      type: "emote",
      assetId: "high-five",
      targetId: target.auth.userId,
    });
    const proposal = target.received<SocialEffect>("effect")[0]!;
    harness.send(source, { type: "social.accept", proposalId: proposal.id });
    harness.send(target, { type: "social.accept", proposalId: proposal.id });
    expect(
      target
        .received<SocialEffect>("effect")
        .filter((effect) => effect.type === "emote"),
    ).toHaveLength(1);
    harness.ready(clients.slice(0, 7));
    harness.send(source, { type: "voice.mode", mode: "room" });
    harness.send(source, { type: "race.start" });
    harness.send(source, { type: "voice.mode", mode: "proximity" });
    harness.send(spectator, { type: "voice.mode", mode: "proximity" });
    harness.send(source, {
      type: "chat.send",
      commandId: "race-message",
      text: "Racers only",
    });
    harness.send(spectator, {
      type: "chat.send",
      commandId: "home-message",
      text: "Home only",
    });
    harness.snapshots();
    expect(source.snapshot().players).toHaveLength(7);
    expect(spectator.snapshot().players).toHaveLength(1);
    expect(source.snapshot().chat.map((message) => message.text)).toEqual([
      "Racers only",
    ]);
    expect(spectator.snapshot().chat.map((message) => message.text)).toEqual([
      "Home only",
    ]);
    expect(source.snapshot().voiceMode).toBe("proximity");
    expect(spectator.snapshot().voiceMode).toBe("room");
    expect(
      spectator
        .received<ServerNotice>("notice")
        .some((notice) => notice.code === "ACCESS_DENIED"),
    ).toBe(true);
    harness.advance(61);
    harness.send(source, {
      type: "emote",
      assetId: "high-five",
      targetId: spectator.auth.userId,
    });
    expect(
      source
        .received<ServerNotice>("notice")
        .some((notice) => notice.code === "TOO_FAR"),
    ).toBe(true);
  });

  it("runs all eight through equal starting positions, server checkpoints and shared results, then returns to clear home spawns", () => {
    const clients = harness.fill();
    const avatars = clients.map(
      (client) => harness.room.players.get(client.auth.userId)!.avatar,
    );
    harness.ready(clients);
    harness.send(clients[0]!, { type: "race.start" });
    expect(harness.room.race.readyIds).toHaveLength(8);
    for (const player of harness.room.players.values())
      expect({ x: player.x, y: player.y }).toEqual(RACE_MAP.spawn);
    for (const client of clients)
      harness.send(client, {
        type: "input",
        input: { seq: 0, axisX: 1, axisY: 0, jump: true },
      });
    harness.advance(120);
    for (const player of harness.room.players.values())
      expect(player.x).toBe(RACE_MAP.spawn.x);
    harness.advance(61);
    expect(harness.room.race.phase).toBe("running");
    harness.send(clients[0]!, {
      type: "race.finish",
      checkpoint: 4,
      elapsedMs: 1,
    });
    expect(clients[0]!.received<ServerNotice>("notice").at(-1)!.code).toBe(
      "INVALID_COMMAND",
    );
    const obstacles = [
      ...RACE_MAP.hazards,
      ...RACE_MAP.platforms.filter((solid) => solid.y < 16),
    ].sort((a, b) => a.x - b.x);
    const held = new Map<string, boolean>();
    let seq = 1;
    harness.advance(4_300, (tick) => {
      if (tick % 2 || harness.room.race.phase !== "running") return;
      for (const client of clients) {
        const player = harness.room.players.get(client.auth.userId)!;
        if (player.finishedAt) continue;
        const obstacle = obstacles.find(
          (solid) =>
            solid.x + solid.width > player.x + GAME_CONFIG.playerRadius,
        );
        const jump = Boolean(
          player.grounded &&
            !held.get(player.id) &&
            obstacle &&
            obstacle.x - player.x < 1.8,
        );
        harness.send(client, {
          type: "input",
          input: { seq, axisX: 1, axisY: 0, jump },
        });
        held.set(player.id, jump);
      }
      seq++;
    });
    expect(harness.room.race.phase).toBe("results");
    expect(harness.room.race.results).toHaveLength(8);
    expect(
      new Set(harness.room.race.results.map((result) => result.playerId)).size,
    ).toBe(8);
    expect(
      harness.room.race.results.every(
        (result) =>
          !result.dnf &&
          result.rank === 1 &&
          result.elapsedMs! >= 59_000 &&
          result.elapsedMs! < 62_000,
      ),
    ).toBe(true);
    for (const player of harness.room.players.values())
      expect(player.checkpoint).toBe(4);
    for (const client of clients)
      expect(client.snapshot().race!.results).toEqual(
        harness.room.race.results,
      );
    for (const client of clients) harness.send(client, { type: "race.return" });
    harness.snapshots();
    expectClearHomeSpawns(harness.room);
    expect(harness.room.players.size).toBe(8);
    expect(harness.room.race.phase).toBe("lobby");
    clients.forEach((client, index) =>
      expect(harness.room.players.get(client.auth.userId)!.avatar).toEqual(
        avatars[index],
      ),
    );
  });
});


describe("shared reusable social worlds",()=>{
  function propose(client:TestClient,worldId:"forest"|"living-room"="forest",commandId="change"){
    harness.send(client,{type:"world.propose",worldId,commandId,revision:harness.room.worldRevision});
  }
  it("a member can propose; an objection cancels for all eight and retries do not restart a countdown",()=>{
    const clients=harness.fill();propose(clients[3]!);
    const proposal=harness.room.worldProposal!;expect(proposal.endsAt-proposal.startAt).toBe(8000);
    harness.advance(120);propose(clients[3]!);expect(harness.room.worldProposal?.endsAt).toBe(proposal.endsAt);
    harness.send(clients[6]!,{type:"world.object",proposalId:proposal.id});harness.advance(500);
    expect(harness.room.worldId).toBe("living-room");expect(harness.room.worldProposal).toBeNull();expect(harness.room.worldRevision).toBe(0);
    clients.forEach(c=>expect(c.snapshot().worldId).toBe("living-room"));
  });
  it("unopposed changes atomically move eight avatars, clear seats/actions and invalidate old-world inputs",()=>{
    const clients=harness.fill();const oldAvatars=clients.map(c=>harness.room.players.get(c.auth.userId)!.avatar);
    harness.send(clients[0]!,{type:"input",input:{seq:8,axisX:1,axisY:0,jump:false},worldRevision:0});
    propose(clients[4]!);harness.advance(481);
    expect(harness.room.worldId).toBe("forest");expect(harness.room.worldRevision).toBe(1);
    const map=getWorld("forest").map,ps=[...harness.room.players.values()];
    expect(new Set(ps.map(p=>p.x+":"+p.y)).size).toBe(8);
    ps.forEach(p=>{expect(map.solids.some(s=>overlapsPlayer(p,s))).toBe(false);expect(p.mode).toBe("home");expect(p.flashlightOn).toBe(true);expect(p.seatId).toBeUndefined();});
    clients.forEach((c,i)=>{expect(c.snapshot().worldRevision).toBe(1);expect(harness.room.players.get(c.auth.userId)!.avatar).toEqual(oldAvatars[i]);});
    const p=harness.room.players.get(clients[0]!.auth.userId)!,x=p.x;
    harness.send(clients[0]!,{type:"input",input:{seq:9,axisX:1,axisY:0,jump:false},worldRevision:0});harness.advance(5);expect(harness.room.players.get(p.id)!.x).toBe(x);
  });
  it("joins during the countdown see it, late joins enter the active map, and tab replacement retains one avatar",()=>{
    const owner=harness.join(harness.identities[0]!);propose(owner);harness.advance(180);
    const joiner=harness.join(harness.identities[1]!);expect(joiner.snapshot().worldProposal?.id).toBe(harness.room.worldProposal?.id);
    harness.advance(302);const late=harness.join(harness.identities[2]!);expect(late.snapshot().worldId).toBe("forest");
    const replacement=harness.join(joiner.auth.userId,true);expect(harness.room.players.size).toBe(3);expect(replacement.snapshot().worldId).toBe("forest");
    const pos=harness.room.players.get(joiner.auth.userId)!;expect(getWorld("forest").map.solids.some(s=>overlapsPlayer(pos,s))).toBe(false);
  });
  it("a grace-reserved avatar switches too and reconnects into the current world",async()=>{
    const clients=harness.fill();let resolve!:(c:AuthorityClient)=>void;const wait=new Promise<AuthorityClient>(r=>resolve=r);
    vi.spyOn(harness.room,"allowReconnection").mockReturnValue(wait as ReturnType<PartyRoom["allowReconnection"]>);
    const dropped=clients[1]!,drop=harness.room.onDrop(dropped.authority());propose(clients[0]!);harness.advance(481);
    const p=harness.room.players.get(dropped.auth.userId)!;expect(p.connected).toBe(false);expect(p.y).toBeGreaterThan(27);
    harness.room.onReconnect(dropped.authority());resolve(dropped.authority());await drop;expect(dropped.snapshot().worldId).toBe("forest");expect(harness.room.players.size).toBe(8);
  });
  it("stale/concurrent proposals cannot fork worlds and a revoked proposer cancels the transition",()=>{
    const clients=harness.fill();propose(clients[1]!);const first=harness.room.worldProposal?.id;
    propose(clients[2]!,"forest","second");expect(harness.room.worldProposal?.id).toBe(first);
    harness.store.banMember(harness.homeId,clients[0]!.auth.userId,clients[1]!.auth.userId);expect(harness.room.worldProposal).toBeNull();harness.advance(481);expect(harness.room.worldId).toBe("living-room");
  });
  it("all eight fire seats are safe, exclusive and support shared roasting with movement cancelling it",()=>{
    const clients=harness.fill();propose(clients[0]!);harness.advance(481);const map=getWorld("forest").map;
    clients.forEach((c,i)=>{const seat=map.seats[i]!,p=harness.room.players.get(c.auth.userId)!;Object.assign(p,seat);harness.send(c,{type:"seat",seatId:seat.id});harness.send(c,{type:"roast",enabled:true});expect(p.seatId).toBe(seat.id);expect(p.roastingAt).toBeGreaterThan(0);expect(map.solids.some(s=>overlapsPlayer(p,s))).toBe(false);});
    const c=clients[0]!;harness.send(c,{type:"input",input:{seq:10,axisX:1,axisY:0,jump:false},worldRevision:1});harness.advance(2);expect(harness.room.players.get(c.auth.userId)!.roastingAt).toBeUndefined();
    const far=clients[1]!,p=harness.room.players.get(far.auth.userId)!;p.x=2;p.y=2;delete p.roastingAt;harness.send(far,{type:"roast",enabled:true});expect(p.roastingAt).toBeUndefined();
  });
  it("shared video controls require host authority and revision, deduplicate retries, and survive world switches",()=>{
    const clients=harness.fill(),host=clients[0]!,guest=clients[1]!;
    const source={type:"media.control",action:"source",url:"https://example.com/movie.mp4",revision:0,commandId:"video"};
    harness.send(guest,source);expect(harness.room.media.url).toBe("");harness.send(host,source);expect(harness.room.media.revision).toBe(1);harness.send(host,source);expect(harness.room.media.revision).toBe(1);
    harness.send(host,{type:"media.control",action:"play",revision:0,commandId:"stale"});expect(harness.room.media.playing).toBe(false);
    harness.send(host,{type:"media.control",action:"play",revision:1,commandId:"play"});harness.advance(120);
    harness.send(host,{type:"media.control",action:"pause",revision:2,commandId:"pause"});expect(harness.room.media.position).toBeCloseTo(2,1);
    propose(host);harness.advance(481);expect(harness.room.media.url).toBe(source.url);expect(guest.snapshot().media.revision).toBe(3);
    harness.send(host,{type:"media.control",action:"source",url:"http://example.com/bad.mp4",revision:3,commandId:"bad"});expect(harness.room.media.revision).toBe(3);
  });
});
