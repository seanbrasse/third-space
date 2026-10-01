import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { PartyRoom } from "../../apps/game-server/src/PartyRoom";
import { stepFlashlight } from "../../apps/game-server/src/flashlight";
import { LocalStore } from "../../packages/data/src/index";
import { FLASHLIGHT_SECONDS, GAME_CONFIG } from "../../packages/config/src/index";
import type { ClientCommand, PlayerState } from "../../packages/contracts/src/index";

type Client = Parameters<PartyRoom["onJoin"]>[0];

/** Exercises real admission, command parsing, recharge, fixed ticks and reconnect. */
class FlashlightHarness {
  store = new LocalStore({ path: ":memory:" });
  room = new PartyRoom();
  private commandHandler!: (client: Client, raw: unknown) => unknown;
  private timestep!: (deltaMs: number) => void;
  private now = Date.now();
  client: Client;
  id: string;
  constructor() {
    this.room.worldId = "forest";
    this.id = this.store.createIdentity({ name: "Explorer" }).profile.id;
    const home = this.store.createHome(this.id, { name: "Battery test", pin: "123456" });
    PartyRoom.store = this.store;
    vi.spyOn(this.room, "setMatchmaking").mockResolvedValue();
    vi.spyOn(this.room, "setTimestep").mockImplementation((callback) => { this.timestep = callback!; });
    vi.spyOn(this.room, "onMessage").mockImplementation((type: string | number, callback: unknown) => {
      if (type === "command") this.commandHandler = callback as typeof this.commandHandler;
    });
    vi.spyOn(this.room.clock, "setInterval").mockImplementation(() => ({} as ReturnType<typeof this.room.clock.setInterval>));
    this.room.onCreate({ homeId: home.id });
    this.client = { sessionId: randomUUID(), send: vi.fn(), leave: vi.fn() } as unknown as Client;
    this.client.auth = this.room.onAuth(this.client, { homeId: home.id, ticket: this.store.issueTicket(home.id, this.id).ticket });
    this.room.onJoin(this.client, {});
  }
  get player(): PlayerState { return this.room.players.get(this.id)!; }
  send(command: ClientCommand) { this.commandHandler(this.client, command); }
  ticks(count: number) {
    for (let i = 0; i < count; i++) {
      this.now += 1000 / GAME_CONFIG.simulationHz;
      vi.setSystemTime(Math.round(this.now));
      this.timestep(1000 / GAME_CONFIG.simulationHz);
    }
  }
  elapseWithoutTick(milliseconds: number) {
    this.now += milliseconds;
    vi.setSystemTime(Math.round(this.now));
  }
  travel(worldId: "forest" | "living-room") {
    this.send({ type: "world.propose", worldId, revision: this.room.worldRevision, commandId: randomUUID() });
    this.ticks(481);
  }
  enterAsylum() {
    Object.assign(this.player, { x: 30.5, y: 25.5 });
    delete this.player.seatId;
  }
  charge() {
    Object.assign(this.player, { x: 30.5, y: 23.7 });
    this.send({ type: "seat", seatId: "charger-seat" });
  }
  close() { this.room.onDispose(); this.room.clock.clear(); this.store.close(); }
}

let harness: FlashlightHarness;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  harness = new FlashlightHarness();
});
afterEach(() => { harness.close(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe("authoritative flashlight battery", () => {
  it("spawns charged and OFF, preserving the budget during idle at camp",()=>{
    expect(harness.player.flashlightBattery).toBe(1);
    expect(harness.player.flashlightOn).toBe(false);
    harness.ticks(3600);
    expect(harness.player.flashlightBattery).toBe(1);
  });

  it.each([undefined,"asylum"] as const)("walks into the %s charger without a seat command, preserving OFF",zone=>{
    const dock=zone?{x:16.5,y:9.5}:{x:30.5,y:23.7};
    Object.assign(harness.player,{zone,x:dock.x,y:dock.y+1.1,flashlightBattery:0,flashlightOn:false});
    delete harness.player.seatId;
    harness.ticks(1);expect(harness.player.flashlightBattery).toBe(0);
    for(let seq=0;seq<12;seq++){
      harness.send({type:"input",input:{seq,axisX:0,axisY:-1,jump:false}});
      harness.ticks(1);
    }
    expect(harness.player.flashlightBattery).toBe(1);
    expect(harness.player.flashlightOn).toBe(false);
    expect(harness.player.seatId).toBeUndefined();
    Object.assign(harness.player,{x:dock.x,y:dock.y+1.1});
    harness.send({type:"input.stop"});
    harness.send({type:"flashlight",enabled:true});harness.ticks(60);
    expect(harness.player.flashlightBattery).toBeCloseTo(1-1/30,12);
    Object.assign(harness.player,{x:dock.x,y:dock.y,connected:false,flashlightBattery:.2});
    harness.ticks(1);expect(harness.player.flashlightBattery).toBe(.2);
  });

  it("freshly rejoins charged after leaving, while reserved reconnects keep their remaining charge",()=>{
    Object.assign(harness.player,{flashlightBattery:0,flashlightOn:false});
    harness.room.onLeave(harness.client);
    harness.room.onJoin(harness.client,{});
    expect(harness.player.flashlightBattery).toBe(1);
    expect(harness.player.flashlightOn).toBe(false);
  });

  it("returns from a threat respawn with a full OFF flashlight",()=>{
    Object.assign(harness.player,{flashlightBattery:0,flashlightOn:false,respawnAt:Date.now()+1});
    harness.ticks(1);
    expect(harness.player.flashlightBattery).toBe(1);
    expect(harness.player.flashlightOn).toBe(false);
  });

  it("provides precisely 30 seconds of continuous enabled runtime", () => {
    harness.send({type:"flashlight",enabled:true});
    expect(FLASHLIGHT_SECONDS).toBe(30);
    harness.ticks(1799);
    expect(harness.player.flashlightOn).toBe(true);
    expect(harness.player.flashlightBattery).toBeCloseTo(1 / 1800, 12);
    harness.ticks(1);
    expect(harness.player.flashlightBattery).toBe(0);
    expect(harness.player.flashlightOn).toBe(false);
  });

  it("preserves the exact remaining charge while OFF, including long idle time", () => {
    harness.send({type:"flashlight",enabled:true});
    harness.ticks(420);
    harness.send({ type: "flashlight", enabled: false });
    const remaining = harness.player.flashlightBattery;
    harness.ticks(18_000);
    expect(harness.player.flashlightBattery).toBe(remaining);
    expect(harness.player.flashlightOn).toBe(false);
  });

  it("uses 30 aggregate ON seconds across repeated toggle cycles", () => {
    for (let cycle = 0; cycle < 6; cycle++) {
      harness.send({ type: "flashlight", enabled: true });
      harness.ticks(300);
      harness.send({ type: "flashlight", enabled: false });
      const remaining = harness.player.flashlightBattery;
      harness.ticks(900);
      expect(harness.player.flashlightBattery).toBe(remaining);
    }
    expect(harness.player.flashlightBattery).toBe(0);
    expect(harness.player.flashlightOn).toBe(false);
    harness.send({ type: "flashlight", enabled: true });
    expect(harness.player.flashlightOn).toBe(false);
  });

  it("keeps an OFF flashlight OFF through group travel and resumes only on command", () => {
    harness.send({type:"flashlight",enabled:true});
    harness.ticks(120);
    harness.send({ type: "flashlight", enabled: false });
    const remaining = harness.player.flashlightBattery;
    harness.travel("living-room");
    expect(harness.player.flashlightOn).toBe(false);
    harness.travel("forest");
    expect(harness.player.flashlightOn).toBe(false);
    harness.ticks(600);
    expect(harness.player.flashlightBattery).toBe(remaining);
    harness.send({ type: "flashlight", enabled: true });
    harness.ticks(60);
    expect(harness.player.flashlightBattery).toBeCloseTo(remaining! - 1 / 30, 12);
  });

  it("freezes charge throughout disconnect grace and resumes without timestamp catch-up", async () => {
    harness.send({type:"flashlight",enabled:true});
    harness.ticks(120);
    const remaining = harness.player.flashlightBattery;
    const reserve = new Promise<Client>(() => {});
    vi.spyOn(harness.room, "allowReconnection").mockReturnValue(reserve as unknown as ReturnType<PartyRoom["allowReconnection"]>);
    void harness.room.onDrop(harness.client);
    expect(harness.player.connected).toBe(false);
    harness.ticks(900);
    expect(harness.player.flashlightBattery).toBe(remaining);
    harness.elapseWithoutTick(60_000);
    const reconnected = { ...harness.client, send: vi.fn(), leave: vi.fn() } as Client;
    harness.room.onReconnect(reconnected);
    harness.client = reconnected;
    expect(harness.player.connected).toBe(true);
    expect(harness.player.flashlightBattery).toBe(remaining);
    harness.ticks(60);
    expect(harness.player.flashlightBattery).toBeCloseTo(remaining! - 1 / 30, 12);
  });

  it("preserves OFF and partial charge through session replacement", () => {
    harness.send({type:"flashlight",enabled:true});
    harness.ticks(180);
    harness.send({ type: "flashlight", enabled: false });
    const remaining = harness.player.flashlightBattery;
    const replacement = { ...harness.client, sessionId: randomUUID(), send: vi.fn(), leave: vi.fn() } as Client;
    harness.room.onJoin(replacement, { replaceExisting: true });
    harness.client = replacement;
    harness.ticks(300);
    expect(harness.player.flashlightBattery).toBe(remaining);
    expect(harness.player.flashlightOn).toBe(false);
  });

  it("reconnects an OFF flashlight without refilling partial or empty charge", () => {
    vi.spyOn(harness.room, "allowReconnection").mockReturnValue(
      new Promise<Client>(() => {}) as unknown as ReturnType<PartyRoom["allowReconnection"]>,
    );
    for (const charge of [0.317123456789, 0]) {
      Object.assign(harness.player, { flashlightBattery: charge, flashlightOn: false });
      void harness.room.onDrop(harness.client);
      harness.ticks(600);
      const reconnected = { ...harness.client, send: vi.fn(), leave: vi.fn() } as Client;
      harness.room.onReconnect(reconnected);
      harness.client = reconnected;
      harness.ticks(60);
      expect(harness.player.flashlightBattery).toBe(charge);
      expect(harness.player.flashlightOn).toBe(false);
    }
  });

  it("charges instantly only at the reachable camper charger and preserves the OFF toggle", () => {
    harness.player.flashlightBattery = 0;
    harness.player.flashlightOn = false;
    harness.send({ type: "seat", seatId: "charger-seat" });
    expect(harness.player.flashlightBattery).toBe(0);
    harness.enterAsylum();
    harness.send({ type: "seat", seatId: "charger-seat" });
    expect(harness.player.flashlightBattery).toBe(0);
    harness.charge();
    expect(harness.player.flashlightBattery).toBe(1);
    expect(harness.player.flashlightOn).toBe(false);
    harness.ticks(600);
    expect(harness.player.flashlightBattery).toBe(1);
    harness.send({ type: "flashlight", enabled: true });
    harness.enterAsylum();
    harness.ticks(1800);
    expect(harness.player.flashlightBattery).toBe(0);
    expect(harness.player.flashlightOn).toBe(false);
  });

  it("resets the runtime budget when an enabled partially charged light is recharged", () => {
    harness.send({type:"flashlight",enabled:true});
    harness.ticks(600);
    harness.enterAsylum();
    const before = harness.player.flashlightBattery;
    harness.ticks(60);
    expect(harness.player.flashlightBattery).toBeCloseTo(before! - 1 / 30, 12);
    harness.charge();
    expect(harness.player.flashlightBattery).toBe(1);
    expect(harness.player.flashlightOn).toBe(true);
    harness.enterAsylum();
    harness.ticks(1799);
    expect(harness.player.flashlightOn).toBe(true);
    harness.ticks(1);
    expect(harness.player.flashlightBattery).toBe(0);
    expect(harness.player.flashlightOn).toBe(false);
  });

  it("retains the existing bright-room pause and has no wall-clock drain while OFF", () => {
    harness.room.worldId="living-room";
    const remaining = harness.player.flashlightBattery;
    harness.ticks(600);
    expect(harness.player.flashlightBattery).toBe(remaining);
    harness.send({ type: "flashlight", enabled: false });
    harness.elapseWithoutTick(86_400_000);
    harness.ticks(1);
    expect(harness.player.flashlightBattery).toBe(remaining);
  });
});

describe("pure flashlight runtime update", () => {
  it("depletes after 30 seconds with whole, uneven and 60 Hz steps", () => {
    for (const steps of [[30], [7.25, 2.75, 0.01, 19.99], Array<number>(1800).fill(1 / 60)]) {
      let state = { flashlightBattery: 1, flashlightOn: true };
      for (const elapsed of steps) state = stepFlashlight(state, elapsed);
      expect(state).toEqual({ flashlightBattery: 0, flashlightOn: false });
    }
  });

  it("keeps charge available until the last frame and never revives or overdraws an empty light", () => {
    let state = stepFlashlight({ flashlightBattery: 1, flashlightOn: true }, 30 - 1 / 60);
    expect(state.flashlightOn).toBe(true);
    expect(state.flashlightBattery).toBeCloseTo(1 / 1800, 12);
    state = stepFlashlight(state, 1 / 60);
    expect(state).toEqual({ flashlightBattery: 0, flashlightOn: false });
    expect(stepFlashlight(state, 60)).toBe(state);
    expect(stepFlashlight({ flashlightBattery: 0.01, flashlightOn: true }, 30))
      .toEqual({ flashlightBattery: 0, flashlightOn: false });
  });

  it("preserves arbitrary partial charge exactly while OFF or when elapsed time is invalid", () => {
    const off = { flashlightBattery: 0.123456789012345, flashlightOn: false };
    expect(stepFlashlight(off, 86_400)).toBe(off);
    const on = { ...off, flashlightOn: true };
    for (const elapsed of [0, -1, NaN, Infinity]) expect(stepFlashlight(on, elapsed)).toBe(on);
  });
});
