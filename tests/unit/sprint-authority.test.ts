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
  command(client, { type: "input", input: { seq: ++seq, axisX: 1, axisY: 0, jump: false, sprint, ...extra } });
}
function advance(ms: number, held = false) {
  for (let elapsed = 0; elapsed < ms; elapsed += 50) {
    vi.setSystemTime(Date.now() + 50);
    if (held) send(true);
    tick(50);
  }
}
describe("real room hold sprint authority", () => {
  it("integrates hold rather than packet count, releases with reserve and rejects forged resource",()=>{
    const p=room.players.get(id)!;p.x=24;p.y=24;
    send(true,{axisX:1});advance(500,true);
    const reserve=room.players.get(id)!.stamina!;expect(reserve).toBeLessThan(1);expect(reserve).toBeGreaterThan(.8);
    send(false);advance(100);expect(room.players.get(id)!.stamina).toBeCloseTo(reserve);
    send(true,{axisX:1,stamina:1});advance(100);expect(room.players.get(id)!.stamina).toBeCloseTo(reserve);
    send(true,{axisX:1});advance(100);expect(room.players.get(id)!.stamina!).toBeLessThan(reserve);
  });
  it("input.stop and stale intent stop sprint; drop/reconnect preserves reserve",async()=>{
    room.players.get(id)!.x=24;room.players.get(id)!.y=24;
    send(true,{axisX:1});advance(100);
    const reserve=room.players.get(id)!.stamina;
    command(client,{type:"input.stop"});advance(100);expect(room.players.get(id)!.sprinting).toBe(false);expect(room.players.get(id)!.stamina).toBeCloseTo(reserve!);
    vi.spyOn(room,"allowReconnection").mockResolvedValue(client);await room.onDrop(client);advance(1000);
    expect(room.players.get(id)!.stamina).toBeCloseTo(reserve!);room.onReconnect(client);expect(room.players.get(id)!.stamina).toBeCloseTo(reserve!);
  });
  it("keeps two human reserves independent in the same authoritative room",()=>{
    const other=store.createIdentity({name:"Second runner"}).profile.id;
    const second={sessionId:"second-sprint",send:vi.fn(),leave:vi.fn()} as unknown as Client;
    store.joinHome(room.homeId,other,{pin:"123456"});
    second.auth=room.onAuth(second,{homeId:room.homeId,ticket:store.issueTicket(room.homeId,other).ticket});room.onJoin(second,{});
    delete room.players.get(other)!.seatId;room.players.get(id)!.x=24;room.players.get(id)!.y=24;
    send(true,{axisX:1});advance(100);
    expect(room.players.get(id)!.stamina!).toBeLessThan(1);expect(room.players.get(other)!.stamina??1).toBe(1);
    command(second,{type:"input",input:{seq:1,axisX:0,axisY:1,jump:false,sprint:true}});advance(50);
    expect(room.players.get(other)!.stamina!).toBeLessThan(1);
  });
  it("walking velocity uses shared prediction and never accepts input speed",()=>{
    const p=room.players.get(id)!;p.x=24;p.y=24;
    send(true,{axisX:1,speed:100});advance(50);expect(room.players.get(id)!.stamina??1).toBe(1);
    send(true,{axisX:1});advance(100);expect(room.players.get(id)!.vx).toBeCloseTo(GAME_CONFIG.homeSpeed*1.6);
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
