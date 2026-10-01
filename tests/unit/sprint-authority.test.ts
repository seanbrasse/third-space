import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PartyRoom } from "../../apps/game-server/src/PartyRoom";
import { LocalStore } from "../../packages/data/src/index";
import { GAME_CONFIG } from "../../packages/config/src/index";

type Client = Parameters<PartyRoom["onJoin"]>[0];
let store: LocalStore, room: PartyRoom, client: Client, id: string;
let command: (client: Client, raw: unknown) => void;
let tick: (ms: number) => void;
let seq = 0;
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(1_000_000); seq = 0;
  store = new LocalStore({ path: ":memory:" });
  id = store.createIdentity({ name: "Runner" }).profile.id;
  const home = store.createHome(id, { name: "Sprint fixture", pin: "123456" });
  PartyRoom.store = store; room = new PartyRoom(); room.worldId = "forest";
  vi.spyOn(room, "setMatchmaking").mockResolvedValue();
  vi.spyOn(room, "onMessage").mockImplementation((type, handler) => {
    if (type === "command") command = handler as typeof command;
  });
  vi.spyOn(room, "setTimestep").mockImplementation(callback => { tick = callback!; });
  vi.spyOn(room.clock, "setInterval").mockReturnValue({} as ReturnType<typeof room.clock.setInterval>);
  room.onCreate({ homeId: home.id });
  client = { sessionId: "sprint-session", send: vi.fn(), leave: vi.fn() } as unknown as Client;
  client.auth = room.onAuth(client, { homeId: home.id, ticket: store.issueTicket(home.id, id).ticket });
  room.onJoin(client, {});
  delete room.players.get(id)!.seatId;
});
afterEach(() => { room.onDispose(); room.clock.clear(); store.close(); vi.restoreAllMocks(); vi.useRealTimers(); });
function send(sprint: boolean, extra = {}) {
  command(client, { type: "input", input: { seq: ++seq, axisX: 0, axisY: 0, jump: false, sprint, ...extra } });
}
function advance(ms: number, held = false) {
  for (let elapsed = 0; elapsed < ms; elapsed += 50) {
    vi.setSystemTime(Date.now() + 50);
    if (held) send(true);
    tick(50);
  }
}
describe("real room sprint authority", () => {
  it("distinguishes rapid release/repress from held packets without a sampled neutral frame", () => {
    send(true, { sprintPress: 1 });
    advance(6_600);
    send(true, { sprintPress: 1 });
    expect(room.players.get(id)!.sprintUntil).toBe(1_001_500);
    send(true, { sprintPress: 2 });
    expect(room.players.get(id)!.sprintUntil).toBe(Date.now() + 1_500);
    send(true, { sprintPress: 3 }); // spent charge: consume the denied edge
    const until = room.players.get(id)!.sprintUntil;
    advance(6_600);
    send(true, { sprintPress: 3 });
    expect(room.players.get(id)!.sprintUntil).toBe(until);
    send(true, { sprintPress: 4 });
    expect(room.players.get(id)!.sprintUntil).toBe(Date.now() + 1_500);
  });
  it("accepts one boost per press; held Space never retriggers when recharge completes", () => {
    send(true);
    const until = room.players.get(id)!.sprintUntil;
    expect(until).toBe(1_001_500);
    advance(6_600, true);
    expect(room.players.get(id)!.sprintUntil).toBe(until);
    send(false); send(true);
    expect(room.players.get(id)!.sprintUntil).toBe(Date.now() + 1_500);
  });
  it("rejects forged speed/timing packets and stale world/zone/life inputs", () => {
    for (const extra of [{ speed: 100 }, { sprintUntil: Date.now() + 100_000 }, { dt: 10 }]) send(true, extra);
    expect(room.players.get(id)!.sprintUntil).toBeUndefined();
    for (const stale of [{ worldRevision: 1 }, { zoneRevision: 1 }, { lifeRevision: 1 }])
      command(client, { type: "input", ...stale, input: { seq: ++seq, axisX: 1, axisY: 0, jump: false, sprint: true } });
    expect(room.players.get(id)!.sprintUntil).toBeUndefined();
    send(true);
    expect(room.players.get(id)!.sprintUntil).toBe(Date.now() + 1_500);
  });
  it("blocks seated boosts and verifies authority speed against normal movement", () => {
    let p = room.players.get(id)!;
    p.seatId = "test-seat"; send(true);
    expect(p.sprintUntil).toBeUndefined();
    delete p.seatId; send(false); send(true);
    // Clear forest spawn corridor, away from colliders.
    p.x = 24; p.y = 24;
    command(client, { type: "input", input: { seq: ++seq, axisX: 1, axisY: 0, jump: false, sprint: true } });
    const x = p.x; advance(100);
    p = room.players.get(id)!;
    expect(p.vx).toBeCloseTo(GAME_CONFIG.homeSpeed * 1.6);
    // Fixed-timestep accumulation may retain one floating-point boundary tick.
    expect(p.x - x).toBeGreaterThan(GAME_CONFIG.homeSpeed * 1.6 * .08);
    expect(p.x - x).toBeLessThanOrEqual(GAME_CONFIG.homeSpeed * 1.6 * .1 + 1e-8);
  });
  it("cancels active boost on world change without gifting a full charge", () => {
    send(true); advance(1_000);
    const authority = room as unknown as { changeWorld: (world: "forest" | "living-room") => void };
    authority.changeWorld("living-room");
    const p = room.players.get(id)!;
    expect(p.sprintUntil).toBe(Date.now());
    expect(p.sprintReadyAt).toBe(Date.now() + 5_000);
    send(true);
    expect(p.sprintReadyAt).toBe(Date.now() + 5_000);
  });
  it("preserves spent charge during transport drop and reconnect", async () => {
    send(true); advance(1_000);
    vi.spyOn(room, "allowReconnection").mockResolvedValue(client);
    await room.onDrop(client);
    const p = room.players.get(id)!;
    expect(p.connected).toBe(false);
    expect(p.sprintUntil).toBe(Date.now());
    const readyAt = p.sprintReadyAt;
    room.onReconnect(client);
    expect(p.connected).toBe(true);
    expect(p.sprintReadyAt).toBe(readyAt);
    send(true);
    expect(p.sprintReadyAt).toBe(readyAt);
  });
});

// Accepted transport sequences must remain independent of movement integration.
describe("input acknowledgements without movement", () => {
  it("acknowledges accepted neutral packets while seated, including after intent cleanup", () => {
    const p = room.players.get(id)!; p.seatId = "camp-seat-0";
    for (const seq of [5000, 10000, 15000])
      command(client, { type: "input", input: { seq, axisX: 0, axisY: 0, jump: false } });
    expect(p.lastInputSeq).toBe(15000);
    (room as unknown as { intents: Map<string, unknown> }).intents.delete(id);
    command(client, { type: "input", input: { seq: 15001, axisX: 0, axisY: 0, jump: false } });
    expect(p.lastInputSeq).toBe(15001);
    expect(p.seatId).toBe("camp-seat-0");
  });
  it("keeps seated acknowledgement through a real drop/reconnect", async () => {
    room.players.get(id)!.seatId = "camp-seat-0";
    command(client, { type: "input", input: { seq: 9000, axisX: 0, axisY: 0, jump: false } });
    vi.spyOn(room, "allowReconnection").mockResolvedValue(client);
    await room.onDrop(client);
    room.onReconnect(client);
    command(client, { type: "input", input: { seq: 10001, axisX: 0, axisY: 0, jump: false } });
    expect(room.players.get(id)!.lastInputSeq).toBe(10001);
    expect(room.players.get(id)!.connected).toBe(true);
  });
  it("acknowledges frozen race lobby but still rejects oversized and stale inputs", () => {
    const p = room.players.get(id)!; p.mode = "race";
    command(client, { type: "input", input: { seq: 5000, axisX: 0, axisY: 0, jump: false } });
    expect(p.lastInputSeq).toBe(5000);
    command(client, { type: "input", input: { seq: 5001, axisX: 0, axisY: 0, jump: false }, worldRevision: -1 });
    expect(p.lastInputSeq).toBe(5000);
    command(client, { type: "input", input: { seq: 15001, axisX: 0, axisY: 0, jump: false } });
    expect(p.lastInputSeq).toBe(5000);
    expect(client.send).toHaveBeenCalledWith("notice", expect.objectContaining({code:"INVALID_INPUT"}));
  });
});
