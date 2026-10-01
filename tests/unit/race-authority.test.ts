import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PartyRoom } from '../../apps/game-server/src/PartyRoom';
import { LocalStore } from '../../packages/data/src/index';
import { GAME_CONFIG, RACE_BOOST, RACE_MAP } from '@third-space/config';
import type { RoomSnapshot } from '@third-space/contracts';
type Client = Parameters<PartyRoom['onJoin']>[0];
let store: LocalStore, room: PartyRoom, clients: Client[], ids: string[];
let command: (client: Client, raw: unknown) => void;
let tick: (ms: number) => void;
let seq = 0;
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(1_000_000); seq = 0;
  store = new LocalStore({ path: ':memory:' });
  ids = ['One', 'Two'].map(name => store.createIdentity({ name }).profile.id);
  const home = store.createHome(ids[0], { name: 'Race fixture', pin: '123456' });
  store.joinHome(home.id, ids[1], { pin: '123456' });
  PartyRoom.store = store; room = new PartyRoom(); room.worldId = 'forest';
  vi.spyOn(room, 'setMatchmaking').mockResolvedValue();
  vi.spyOn(room, 'onMessage').mockImplementation((type, handler) => { if (type === 'command') command = handler as typeof command; });
  vi.spyOn(room, 'setTimestep').mockImplementation(callback => { tick = callback!; });
  vi.spyOn(room.clock, 'setInterval').mockReturnValue({} as ReturnType<typeof room.clock.setInterval>);
  room.onCreate({ homeId: home.id });
  clients = ids.map((id, i) => {
    const client = { sessionId: `race-session-${i}`, send: vi.fn(), leave: vi.fn() } as unknown as Client;
    client.auth = room.onAuth(client, { homeId: home.id, ticket: store.issueTicket(home.id, id).ticket });
    room.onJoin(client, {}); return client;
  });
  // This lane tests authority after admission; lead owns entrance/lobby commands.
  (room as unknown as { startRace(ids: string[]): void }).startRace(ids);
  vi.setSystemTime(1_003_000); tick(1000 / 60); tick(1000 / 60);
});
afterEach(() => { room.onDispose(); room.clock.clear(); store.close(); vi.restoreAllMocks(); vi.useRealTimers(); });
function send(index: number, jump = false, axisX = 0, extra = {}) {
  command(clients[index], { type: 'input', input: { seq: ++seq, axisX, axisY: 0, jump, ...extra } });
}
function advance(ms: number) {
  for (let elapsed = 0; elapsed < ms; elapsed += 1000 / 60) {
    vi.setSystemTime(Date.now() + 1000 / 60); tick(1000 / 60);
  }
}
describe('real room racing authority', () => {
  it('clears active boost power when returning home or finishing', () => {
    Object.assign(room.players.get(ids[0])!, { raceSpeedBoostSeconds: 4, raceJumpBoostSeconds: 4 });
    command(clients[0], { type: 'race.return' });
    expect(room.players.get(ids[0])!.mode).toBe('home');
    expect(room.players.get(ids[0])!.raceSpeedBoostSeconds).toBe(0);
    const p = room.players.get(ids[1])!;
    Object.assign(p, { x: RACE_MAP.finish.x, checkpoint: 4, raceSpeedBoostSeconds: 4, raceJumpBoostSeconds: 4 });
    advance(50);
    expect(room.players.get(ids[1])!.finishedAt).toBeDefined();
    expect(room.players.get(ids[1])!.raceJumpBoostSeconds).toBe(0);
  });
  it('rejects forged boosts, pickup claims and counters', () => {
    for (const extra of [{ raceSpeedBoostSeconds: 99 }, { racePickupIds: ['speed-0'] }, { raceJumpCount: 100 }]) send(0, false, 0, extra);
    const p = room.players.get(ids[0])!;
    expect(p.raceSpeedBoostSeconds).toBe(0); expect(p.racePickupIds).toEqual([]); expect(p.raceJumpCount).toBe(0);
    command(clients[0], { type: 'race.pickup', id: 'speed-0' }); advance(20);
    expect(room.players.get(ids[0])!.racePickupCount).toBe(0);
  });
  it('collects personal pickups equally and sends their shared authoritative state in snapshots', () => {
    for (const id of ids) { const p = room.players.get(id)!; p.x = 5; p.y = 15.7; }
    send(0, false, 1); send(1, false, 1); advance(50);
    const a = room.players.get(ids[0])!, b = room.players.get(ids[1])!;
    expect(a.racePickupIds).toEqual(['speed-0']); expect(b.racePickupIds).toEqual(a.racePickupIds);
    expect(a.x).toBeCloseTo(b.x, 9); expect(a.vx).toBe(GAME_CONFIG.raceSpeed * RACE_BOOST.speedMultiplier);
    (room as unknown as { sendSnapshots(): void }).sendSnapshots();
    const snapshot = (vi.mocked(clients[0].send).mock.calls.filter(([type]) => type === 'snapshot').at(-1)![1]) as RoomSnapshot;
    expect(snapshot.players.find(p => p.id === ids[1])!.racePickupIds).toEqual(['speed-0']);
    expect(snapshot.race!.id).toBe(room.race.id);
  });
  it('records launch and death once, clears boosts and resumes at the saved checkpoint', () => {
    const p = room.players.get(ids[0])!; p.x = 34;
    send(0, true); advance(50);
    expect(room.players.get(ids[0])!.raceJumpCount).toBe(1);
    advance(50); expect(room.players.get(ids[0])!.raceJumpCount).toBe(1);
    Object.assign(room.players.get(ids[0])!, { x: 114.5, y: 15.7, vy: 0, grounded: true, checkpoint: 1, raceSpeedBoostSeconds: 4 });
    send(0, false, 1); advance(50);
    expect(room.players.get(ids[0])!.raceDeathCount).toBe(1);
    expect(room.players.get(ids[0])!.raceSpeedBoostSeconds).toBe(0);
    advance(650);
    const respawned = room.players.get(ids[0])!;
    expect(respawned.raceDeathCount).toBe(1); expect(respawned.respawnTimer).toBe(0);
    expect(respawned.x).toBe(RACE_MAP.checkpoints[0].spawn.x);
  });
});
