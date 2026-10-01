import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PartyRoom } from '../../apps/game-server/src/PartyRoom';
import { ForestNPCController } from '../../apps/game-server/src/ForestNPCController';
import { ForestEncounter } from '../../apps/game-server/src/ForestStalker';
import { ForestWerewolf } from '../../apps/game-server/src/ForestWerewolf';
import { ForestMimic } from '../../apps/game-server/src/ForestMimic';
import { LocalStore } from '../../packages/data/src/index';
import { getWorld } from '../../packages/config/src/index';
import type { RoomSnapshot, WorldSoundEvent } from '../../packages/contracts/src/index';
import type { SurvivalInventory } from '../../apps/game-server/src/survival-inventory';

type Client = Parameters<PartyRoom['onJoin']>[0];
interface Authority {
  npcs: ForestNPCController;
  survival: SurvivalInventory;
  encounter: ForestEncounter | null;
  werewolf: ForestWerewolf | null;
  mimic: ForestMimic | null;
  idlePresence: Map<string, unknown>;
  sendSnapshots(): void;
}
let store: LocalStore, room: PartyRoom, clients: Client[], ids: string[], homeId: string, serial: number;
let command: (client: Client, raw: unknown) => void, tick: (ms: number) => void;
const authority = () => room as unknown as Authority;
function send(index: number, payload: Record<string, unknown> = {}, context: Record<string, unknown> = {}) {
  const player = room.players.get(ids[index]!)!;
  command(clients[index]!, { type: 'npc.interact', npcId: authority().npcs.snapshot()[0]!.id, commandId: `npc-room-${++serial}`, worldRevision: room.worldRevision, lifeRevision: player.respawnCount ?? 0, zoneRevision: player.zoneRevision ?? 0, ...payload, ...context });
}
function place(index: number, point: { x: number; y: number }) {
  const player = room.players.get(ids[index]!)!;
  Object.assign(player, { x: point.x, y: point.y });
  delete player.seatId; delete player.haloUntil; delete player.zone;
  return player;
}
function advance(ms: number) { for (let elapsed = 0; elapsed < ms; elapsed += 50) { vi.setSystemTime(Date.now() + 50); tick(50); } }
function snapshot(index: number) {
  authority().sendSnapshots();
  return vi.mocked(clients[index]!.send).mock.calls.filter(c => c[0] === 'snapshot').at(-1)![1] as RoomSnapshot;
}
function admit(index: number, suffix = '') {
  const client = { sessionId: `npc-room-${index}${suffix}`, send: vi.fn(), leave: vi.fn() } as unknown as Client;
  client.auth = room.onAuth(client, { homeId, ticket: store.issueTicket(homeId, ids[index]!).ticket });
  room.onJoin(client, {});
  return client;
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(1_000_000); serial = 0;
  store = new LocalStore({ path: ':memory:' });
  ids = Array.from({ length: 8 }, (_, i) => store.createIdentity({ name: `Human ${i}` }).profile.id);
  homeId = store.createHome(ids[0]!, { name: 'NPC fixture', pin: '123456' }).id;
  store.db.prepare('UPDATE homes SET capacity=8 WHERE id=?').run(homeId);
  ids.slice(1).forEach(id => store.joinHome(homeId, id, { pin: '123456' }));
  PartyRoom.store = store; room = new PartyRoom(); room.worldId = 'forest';
  vi.spyOn(room, 'setMatchmaking').mockResolvedValue();
  vi.spyOn(room, 'onMessage').mockImplementation((type, handler) => { if (type === 'command') command = handler as typeof command; });
  vi.spyOn(room, 'setTimestep').mockImplementation(callback => { tick = callback!; });
  vi.spyOn(room.clock, 'setInterval').mockReturnValue({} as ReturnType<typeof room.clock.setInterval>);
  room.onCreate({ homeId });
  clients = ids.map((_id, index) => admit(index));
  advance(50);
});
afterEach(() => { room.onDispose(); room.clock.clear(); store.close(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('NPC integration through actual eight-human PartyRoom admission', () => {
  it('keeps world actors out of human slots, members, voice, idle tracking and inventories', () => {
    const npcIds = authority().npcs.snapshot().map(n => n.id);
    expect(npcIds).toHaveLength(25);
    expect(room.players.size).toBe(8);
    expect(authority().idlePresence.size).toBe(8);
    const state = snapshot(0);
    expect(state.members).toHaveLength(8);
    expect(state.voiceScope?.participantIds).toHaveLength(8);
    expect(state.survival?.players).toHaveLength(8);
    const humanIds = [...state.members.map(p => p.id), ...state.voiceScope!.participantIds, ...state.survival!.players.map(p => p.id)];
    expect(humanIds.some(id => npcIds.includes(id))).toBe(false);
    expect(npcIds.some(id => room.players.has(id) || authority().idlePresence.has(id))).toBe(false);
  });

  it('shares accepted dialogue and partial health with all nearby humans, including a late join', () => {
    const npc = authority().npcs.snapshot()[0]!;
    for (let i = 0; i < 8; i++) place(i, npc);
    authority().npcs.damage(npc.id, 25, Date.now());
    send(0);
    const expected = snapshot(0).npcs!.find(n => n.id === npc.id)!;
    expect(expected).toMatchObject({ health: 75, phase: 'talking' });
    expect(expected.dialogue?.text).toBeTruthy();
    for (let i = 1; i < 8; i++) expect(snapshot(i).npcs!.find(n => n.id === npc.id)).toEqual(expected);
    room.onLeave(clients[7]!); clients[7] = admit(7, '-late'); place(7, npc);
    expect(snapshot(7).npcs!.find(n => n.id === npc.id)).toEqual(expected);
    expect(room.players.size).toBe(8);
    expect(authority().npcs.snapshot()).toHaveLength(25);
  });

  it('rejects remote, forged, unauthenticated and stale interactions without mutating NPC dialogue', () => {
    const npc = authority().npcs.snapshot()[0]!;
    send(0); expect(authority().npcs.get(npc.id)?.dialogue).toBeUndefined();
    place(0, npc);
    for (const context of [{ worldRevision: 999 }, { lifeRevision: 999 }, { zoneRevision: 999 }, { health: 900 }, { userId: ids[1] }]) send(0, {}, context);
    send(0, { npcId: 'human-not-npc' });
    send(0, { npcId: 'npc:unknown' });
    expect(authority().npcs.get(npc.id)?.dialogue).toBeUndefined();
    const impostor = { sessionId: 'unknown', auth: clients[0]!.auth, send: vi.fn(), leave: vi.fn() } as unknown as Client;
    command(impostor, { type: 'npc.interact', npcId: npc.id, commandId: 'impostor-request', worldRevision: room.worldRevision, lifeRevision: 0, zoneRevision: 0 });
    expect(authority().npcs.get(npc.id)?.dialogue).toBeUndefined();
    send(0); expect(authority().npcs.get(npc.id)?.dialogue).toBeDefined();
  });

  it('does not replay a previously accepted interaction after the actor cooldown expires', () => {
    const npc = authority().npcs.snapshot()[0]!;
    place(0, npc); send(0, { commandId: 'same-npc-command' });
    const first = authority().npcs.get(npc.id)?.dialogue?.id;
    vi.setSystemTime(Date.now() + 7000);
    send(0, { commandId: 'same-npc-command' });
    expect(authority().npcs.get(npc.id)?.dialogue?.id).toBe(first);
    send(0); expect(authority().npcs.get(npc.id)?.dialogue?.id).not.toBe(first);
  });

  it('routes a monster NPC catch to one NPC respawn, without a human knockout or victim sound', () => {
    const npc = authority().npcs.snapshot()[0]!;
    for (let i = 0; i < 8; i++) place(i, npc);
    const humanHealth = authority().survival.snapshot().players.map(p => [p.id, p.health]);
    const encounter = authority().encounter!;
    vi.spyOn(encounter, 'update').mockReturnValue(npc.id);
    // Keep unrelated random encounter scheduling out of a focused catch-routing fixture.
    authority().werewolf = null; authority().mimic = null;
    advance(100);
    expect(authority().npcs.get(npc.id)).toMatchObject({ health: 0, phase: 'respawning' });
    const respawnAt = authority().npcs.get(npc.id)!.respawnAt!;
    expect([...room.players.values()].every(p => !p.caughtAt && !p.respawnAt && !p.respawnCount)).toBe(true);
    expect(authority().survival.snapshot().players.map(p => [p.id, p.health])).toEqual(humanHealth);
    const sounds = vi.mocked(clients[0]!.send).mock.calls.filter(c => c[0] === 'world.sound').map(c => c[1] as WorldSoundEvent);
    expect(sounds).toHaveLength(1);
    expect(sounds[0]).toMatchObject({ kind: 'slash' });
    expect(sounds[0]!.victimId).toBeUndefined();
    expect(authority().npcs.get(npc.id)!.respawnAt).toBe(respawnAt);
    vi.mocked(encounter.update).mockReturnValue(null);
    vi.setSystemTime(respawnAt - 50); advance(100);
    expect(authority().npcs.get(npc.id)).toMatchObject({ health: 100, phase: 'wander' });
    expect(authority().npcs.get(npc.id)?.respawnAt).toBeUndefined();
    expect(snapshot(7).npcs!.find(n => n.id === npc.id)?.health).toBe(100);
  });

  it('keeps NPCs updating without converting a safe watching party into a hunt', () => {
    const fire = getWorld('forest').fire!;
    for (let i = 0; i < 8; i++) place(i, fire);
    const original = authority().npcs.snapshot();
    for (let interval = 0; interval < 15; interval++) {
      advance(5000);
      expect(authority().encounter?.state?.intent).not.toBe('hunt');
      expect(authority().werewolf?.state?.intent).not.toBe('hunt');
      expect(authority().mimic?.state).toBeNull();
      expect(authority().npcs.snapshot().every(n => n.health === n.maxHealth && n.phase !== 'respawning')).toBe(true);
    }
    expect(authority().npcs.snapshot().some((n, i) => n.x !== original[i]!.x || n.y !== original[i]!.y)).toBe(true);
    expect([...room.players.values()].every(p => !p.caughtAt && !p.respawnCount)).toBe(true);
  });

  it('omits outdoor actors indoors and in races without resetting their world state', () => {
    const npc = authority().npcs.snapshot()[0]!;
    place(0, npc); send(0);
    const dialogueId = authority().npcs.get(npc.id)?.dialogue?.id;
    room.players.get(ids[0]!)!.zone = 'asylum';
    expect(snapshot(0).npcs).toBeUndefined();
    send(0);
    expect(authority().npcs.get(npc.id)?.dialogue?.id).toBe(dialogueId);
    delete room.players.get(ids[0]!)!.zone;
    room.players.get(ids[0]!)!.mode = 'race';
    expect(snapshot(0).npcs).toBeUndefined();
    expect(authority().npcs.get(npc.id)?.dialogue?.id).toBe(dialogueId);
  });
});
