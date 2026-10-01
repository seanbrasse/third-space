import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { DEFAULT_AVATAR, type RoomSnapshot } from '../src/index';
import {
  applySnapshotFrame, createSnapshotDelta, createSnapshotFull, SnapshotDeltaEncoder,
  SNAPSHOT_DELTA_LIMITS, type SnapshotState, type SnapshotFrame,
} from '../src/snapshot-delta';

function fixture(): RoomSnapshot {
  const players = Array.from({ length: 8 }, (_, at) => ({
    id: `p${at}`, name: `Person ${at}`, x: at * 16 + .25, y: at * 10 + .125, vx: 0, vy: 0,
    facing: 'down' as const, mode: 'home' as const, avatar: { ...DEFAULT_AVATAR }, nativeMode: 'off' as const,
    manualMute: false, deafened: false, connected: true, lastInputSeq: 0, checkpoint: 0, zone: undefined,
  }));
  return { epoch: 'epoch-a', serverTime: 1000, worldRevision: 2, homeId: 'home-a', rootWorldId: 'forest', worldId: 'forest',
    instanceId: 'instance-a', players, members: players.map(p => ({ ...p })), npcs: [], idle: undefined,
    survival: { pvpEnabled: true, players: players.map(p => ({ id: p.id, health: 100, hunger: 100, equipped: 'flashlight', slots: ['flashlight', null], selectedSlot: 0, apples: 0 })),
      appleTrees: [{ id: 'tree:1', x: 10, y: 10, readyAt: 0 }], backpacks: [{ id: 'pack:1', x: 12, y: 13 }], events: [] },
    worldProposal: null, media: { revision: 0, url: '', playing: false, position: 0, anchorAt: 1000 }, voiceMode: 'proximity', hostId: 'p0', soundboardEnabled: true, chat: [], race: null };
}
function applied<T extends { epoch: string }>(state: SnapshotState<T> | undefined, frame: SnapshotFrame<T>, epoch?: string): SnapshotState<T>;
function applied<T extends { epoch: string } = RoomSnapshot>(state: SnapshotState<T> | undefined, frame: unknown, epoch?: string): SnapshotState<T>;
function applied<T extends { epoch: string }>(state: SnapshotState<T> | undefined, frame: unknown, epoch?: string): SnapshotState<T> {
  const result = applySnapshotFrame<T>(state, frame, epoch); expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.reason); return result.state;
}
const clone = <T>(value: T): T => structuredClone(value);
const invalid = (state: SnapshotState<RoomSnapshot> | undefined, value: unknown) => expect(applySnapshotFrame(state, value)).toMatchObject({ ok: false, resync: true });

describe('snapshot delta reconstruction', () => {
  it('reconstructs eight humans, exact order, explicit undefined, removals, and all authority through 300 immutable transitions', () => {
    let snapshot = fixture(), state: SnapshotState<RoomSnapshot> | undefined;
    const encoder = new SnapshotDeltaEncoder<RoomSnapshot>();
    for (let step = 0; step < 300; step++) {
      const previousSnapshot = state?.snapshot, saved = previousSnapshot && clone(previousSnapshot);
      snapshot = clone(snapshot); snapshot.serverTime += 50;
      snapshot.players.forEach((p, at) => { p.x += .03125; p.y += at * .015625; p.lastInputSeq++; p.stamina = (step * 13 + at) % 100; });
      snapshot.members = snapshot.players.map(p => clone(p));
      snapshot.survival!.players[step % 8]!.hunger -= .03125;
      if (step % 15 === 0) snapshot.survival!.appleTrees[0]!.readyAt += 100;
      if (step % 22 === 0) snapshot.chat = [{ id: `chat-${step}`, senderId: 'p1', senderName: 'Person 1', text: `At step ${step}`, seq: step, createdAt: snapshot.serverTime }];
      if (step % 30 === 0) snapshot.players.reverse();
      if (step % 12 === 0) delete snapshot.players[0]!.zone;
      if (step % 19 === 0) snapshot.players[0]!.zone = undefined;
      if (step % 40 === 0) snapshot.players[0]!.avatar.hairColor = '#123456';
      const frame = encoder.encode(snapshot, step * 50);
      state = applied(state, frame);
      expect(state.snapshot).toStrictEqual(snapshot);
      expect(state.snapshot.players).toHaveLength(8);
      expect(Object.isFrozen(state.snapshot)).toBe(true); expect(Object.isFrozen(state.snapshot.players[0]!.avatar)).toBe(true);
      if (saved) expect(previousSnapshot).toStrictEqual(saved);
      if (frame.kind === 'delta') {
        expect(frame.changes?.set).not.toHaveProperty('media');
      }
    }
  });
  it('preserves added/reordered/removed entities and avoids repeated static metadata', () => {
    const before = fixture(), after = clone(before);
    after.players = [after.players[7]!, { ...after.players[0]!, id: 'new-player', name: 'New arrival' }, ...after.players.slice(1, 7)];
    after.players[2]!.x += .25; delete after.players[2]!.zone;
    const delta = createSnapshotDelta(before, after, 1);
    expect(delta.entities?.players?.remove).toEqual(['p0']);
    expect(delta.entities?.players?.add?.map(p => p.id)).toEqual(['new-player']);
    expect(delta.entities?.players?.order).toEqual(after.players.map(p => p.id));
    expect(delta.entities?.players?.update).toEqual([['p1', { x: 16.5 }, ['zone']]]);
    expect(applied(applied(undefined, createSnapshotFull(before, 1)), delta).snapshot).toStrictEqual(after);
  });
  it('handles appearance, disappearance, and return of optional arrays and survival', () => {
    const initial = fixture(), encoder = new SnapshotDeltaEncoder<RoomSnapshot>();
    let state = applied(undefined, encoder.encode(initial, 0));
    const next = clone(initial); delete next.npcs; next.members = undefined; delete next.survival;
    state = applied(state, encoder.encode(next, 50)); expect(state.snapshot).toStrictEqual(next);
    state = applied(state, encoder.encode(initial, 100)); expect(state.snapshot).toStrictEqual(initial);
  });
  it('covers NPC dialogue/respawn/removal, inventory slot changes and top-level unchanged metadata', () => {
    const before = { epoch: 'npc-test', players: [], members: [], npcs: [
      { id: 'npc:1', name: 'Keeper', avatar: { color: '#123456' }, x: 10, y: 10, health: 100, dialogue: undefined },
      { id: 'npc:2', name: 'Goblin', x: 90, y: 80, health: 25 },
    ], chat: ['unchanged'], climate: { seed: 4 }, survival: { players: [{ id: 'p1', slots: ['flashlight', null], health: 100 }], appleTrees: [{ id: 'tree', readyAt: 0 }] } };
    const after = clone(before); after.npcs.splice(1, 1); after.npcs[0]!.health = 0;
    Object.assign(after.npcs[0]!, { dialogue: { text: 'They found me.', until: 1200 }, respawnAt: 1800 });
    after.survival.players[0]!.slots = ['flashlight', 'knife'];
    const delta = createSnapshotDelta(before, after, 1);
    expect(delta.changes).toBeUndefined(); expect(delta.entities?.npcs?.update?.[0]?.[1]).not.toHaveProperty('name');
    expect(delta.survival?.changes).toBeUndefined(); expect(applied(applied(undefined, createSnapshotFull(before, 1)), delta).snapshot).toStrictEqual(after);
  });
  it('reconstructs moving interest windows while retaining all eight human positions', () => {
    const population = Array.from({ length: 25 }, (_, at) => ({ id: `npc:${at}`, name: `Walker ${at}`, x: at * 4, y: at, health: 100, metadata: { dialogue: ['The keeper left at dawn.'] } }));
    const initial = { ...fixture(), npcs: population.slice(0, 8) };
    const encoder = new SnapshotDeltaEncoder<typeof initial>();
    let state = applied(undefined, encoder.encode(initial, 0));
    for (let step = 1; step < 100; step++) {
      const next = { ...initial, npcs: population.filter((_, at) => (at + step) % 5 < 2).reverse().map(n => ({ ...n, x: n.x + step / 16 })) };
      state = applied(state, encoder.encode(next, step * 50));
      expect(state.snapshot).toStrictEqual(next); expect(state.snapshot.members).toHaveLength(8); expect(state.snapshot.players).toHaveLength(8);
    }
  });
  it('never aliases snapshots that the room mutates after send', () => {
    const snapshot = fixture(), encoder = new SnapshotDeltaEncoder<RoomSnapshot>();
    const first = encoder.encode(snapshot, 0), before = clone(snapshot);
    snapshot.players[0]!.x = 777; snapshot.players[0]!.avatar.color = '#abcdef'; snapshot.chat.push({ id: 'x', senderId: 'p0', senderName: 'Person 0', text: 'hello', seq: 1, createdAt: 10 });
    const second = encoder.encode(snapshot, 50); snapshot.players[0]!.x = 888;
    const state = applied(undefined, first); expect(state.snapshot).toStrictEqual(before);
    const next = applied(state, second); expect(next.snapshot.players[0]!.x).toBe(777); expect(next.snapshot.players[0]!.avatar.color).toBe('#abcdef');
  });
  it('shares unchanged immutable data only within a recipient and detaches changed values', () => {
    const before = fixture(), after = clone(before); after.players[0]!.x += 1;
    const state = applied(undefined, createSnapshotFull(before, 1));
    const next = applied(state, createSnapshotDelta(before, after, 1));
    expect(next.snapshot.chat).toBe(state.snapshot.chat);
    expect(next.snapshot.players[1]).toBe(state.snapshot.players[1]);
    expect(next.snapshot.players[0]).not.toBe(state.snapshot.players[0]);
  });
  it('preserves empty field names as data when a generic DTO removes them', () => {
    const before: { epoch: string; '': string | undefined; custom?: string } = { epoch: 'generic', '': 'present', custom: undefined };
    const after = { epoch: 'generic', custom: undefined };
    const first = applied(undefined, createSnapshotFull(before, 1));
    expect(applied(first, createSnapshotDelta<{ epoch: string }>(before, after, 1)).snapshot).toStrictEqual(after);
  });
  it('supports arbitrary safe string IDs without interpreting IDs as property keys', () => {
    const before = { epoch: 'id-test', players: [{ id: '__proto__', x: 1 }, { id: 'constructor', x: 2 }] };
    const after = { epoch: 'id-test', players: [{ id: 'constructor', x: 3 }] };
    expect(applied(applied(undefined, createSnapshotFull(before, 1)), createSnapshotDelta(before, after, 1)).snapshot).toStrictEqual(after);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });
  it('round-trips the installed Colyseus MessagePack representation, including undefined properties', () => {
    const serverRequire = createRequire(new URL('../../../apps/game-server/package.json', import.meta.url));
    const coreRequire = createRequire(serverRequire.resolve('@colyseus/core'));
    const msgpack = coreRequire('msgpackr') as { pack(value: unknown): Buffer; unpack(value: Buffer): unknown };
    const encoder = new SnapshotDeltaEncoder<RoomSnapshot>(); const initial = fixture(), next = clone(initial);
    next.players[0]!.caughtAt = undefined; delete next.players[1]!.zone; next.players[2]!.x = 123.125;
    const first = applied<RoomSnapshot>(undefined, msgpack.unpack(msgpack.pack(encoder.encode(initial, 0))));
    const state = applied(first, msgpack.unpack(msgpack.pack(encoder.encode(next, 50))));
    expect(state.snapshot).toStrictEqual(next); expect(Object.hasOwn(state.snapshot.players[0]!, 'caughtAt')).toBe(true);
  });
});

describe('snapshot recovery and connection boundaries', () => {
  it('sends initial and two-second full snapshots, and full on force, world/scope change or clock rollback', () => {
    const encoder = new SnapshotDeltaEncoder<RoomSnapshot>(), initial = fixture();
    expect(encoder.encode(initial, 0).kind).toBe('full'); expect(encoder.encode(initial, 1999).kind).toBe('delta');
    expect(encoder.encode(initial, 2000).kind).toBe('full'); expect(encoder.encode(initial, 2050, true).kind).toBe('full');
    initial.worldRevision++; expect(encoder.encode(initial, 2100).kind).toBe('full');
    initial.instanceId = 'interior'; expect(encoder.encode(initial, 2150).kind).toBe('full');
    expect(encoder.encode(initial, 2100).kind).toBe('full');
    initial.epoch = 'epoch-b'; expect(encoder.encode(initial, 2200).kind).toBe('full');
    encoder.reset(); expect(encoder.encode(initial, 2300).seq).toBe(1);
  });
  it('rejects a dropped base until a new full arrives, without mutating state', () => {
    const encoder = new SnapshotDeltaEncoder<RoomSnapshot>(), snapshot = fixture();
    const state = applied(undefined, encoder.encode(snapshot, 0));
    encoder.encode(snapshot, 50); snapshot.players[0]!.x = 999;
    const missing = encoder.encode(snapshot, 100);
    expect(applySnapshotFrame(state, missing)).toEqual({ ok: false, resync: true, reason: 'missing-base' });
    expect(applySnapshotFrame<RoomSnapshot>(undefined, missing)).toEqual({ ok: false, resync: true, reason: 'missing-base' });
    const recovered = applied(state, encoder.encode(snapshot, 150, true)); expect(recovered.snapshot).toStrictEqual(snapshot);
    const replayed = applySnapshotFrame(recovered, missing); expect(replayed).toEqual({ ok: true, applied: false, state: recovered });
    expect(state.snapshot.players[0]!.x).toBe(.25);
  });
  it('pins the epoch until the newly admitted connection explicitly supplies its epoch', () => {
    const snapshot = fixture(), first = applied(undefined, createSnapshotFull(snapshot, 9));
    snapshot.epoch = 'new-room'; const full = createSnapshotFull(snapshot, 1);
    expect(applySnapshotFrame(first, full)).toEqual({ ok: false, resync: true, reason: 'epoch-mismatch' });
    const second = applied(first, full, 'new-room'); expect(second.epoch).toBe('new-room');
    expect(applySnapshotFrame(second, createSnapshotFull({ ...snapshot, epoch: 'epoch-a' }, 99))).toMatchObject({ ok: false, reason: 'epoch-mismatch' });
  });
  it('keeps independent recipient sequences and full-snapshot state after reset', () => {
    const a = new SnapshotDeltaEncoder<RoomSnapshot>(), b = new SnapshotDeltaEncoder<RoomSnapshot>(), snapshot = fixture();
    a.encode(snapshot, 0); a.encode(snapshot, 50);
    expect(b.encode(snapshot, 100).kind).toBe('full'); expect(b.encode(snapshot, 150).seq).toBe(2);
    a.reset(); expect(a.encode(snapshot, 200).kind).toBe('full');
  });
});

describe('untrusted delta validation', () => {
  const before = fixture(), state = applied(undefined, createSnapshotFull(before, 1));
  const base = () => ({ v: 1, kind: 'delta', epoch: before.epoch, baseSeq: 1, seq: 2 });
  it('rejects prototype keys at any nesting depth without pollution', () => {
    for (const key of ['__proto__', 'constructor', 'prototype']) {
      invalid(state, JSON.parse(`{"v":1,"kind":"delta","epoch":"epoch-a","baseSeq":1,"seq":2,"changes":{"set":{"${key}":{"polluted":true}}}}`));
      invalid(state, { ...base(), entities: { players: { update: [['p0', JSON.parse(`{"avatar":{"${key}":{}}}`)]] } } });
    }
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });
  it('rejects accessors without invoking them, cycles, sparse arrays, exotic objects and nonfinite numbers', () => {
    let called = 0; const getter = { ...base() }; Object.defineProperty(getter, 'changes', { enumerable: true, get() { called++; return {}; } });
    invalid(state, getter); expect(called).toBe(0);
    const cycle: Record<string, unknown> = {}; cycle.self = cycle;
    for (const value of [cycle, new Date(), new Map(), Infinity, NaN, [,,], Symbol('bad')]) invalid(state, { ...base(), changes: { set: { custom: value } } });
  });
  it('rejects invalid sequence, version, snapshot epoch and unknown envelope keys', () => {
    for (const extra of [{ seq: 3 }, { baseSeq: 0 }, { seq: 1.5 }, { seq: Number.MAX_SAFE_INTEGER + 1 }, { v: 2 }, { kind: 'other' }, { unrecognized: true }]) invalid(state, { ...base(), ...extra });
    invalid(undefined, { ...createSnapshotFull(before, 1), epoch: 'wrong' });
    invalid(state, { ...base(), changes: { set: { epoch: 'wrong' } } });
  });
  it('rejects missing, duplicate or conflicting entity operations and incomplete order lists', () => {
    const cases = [
      { update: [['absent', { x: 3 }]] }, { remove: ['absent'], order: [] },
      { update: [['p0', { x: 3 }], ['p0', { y: 3 }]] }, { update: [['p0', { id: 'p8' }]] },
      { update: [['p0', {}, ['id']]] }, { add: [{ id: 'p0', x: 3 }], order: ['p0'] },
      { remove: ['p0'], update: [['p0', { x: 3 }]], order: before.players.slice(1).map(p => p.id) },
      { add: [{ id: 'p8' }] }, { remove: ['p0'] }, { order: ['p0', 'p0'] }, { order: ['absent'] },
    ];
    for (const patch of cases) invalid(state, { ...base(), entities: { players: patch } });
    invalid(state, { ...base(), changes: { set: { players: [] } }, entities: { players: { order: before.players.map(p => p.id) } } });
    invalid(state, { ...base(), survival: { changes: { set: { players: [] } }, players: { update: [['p0', { health: 1 }]] } } });
    invalid(state, { ...base(), changes: { set: { serverTime: 1 }, remove: ['serverTime'] } });
  });
  it('bounds nodes, strings, entity counts, nesting and array lengths', () => {
    invalid(state, { ...base(), changes: { set: { huge: 'x'.repeat(SNAPSHOT_DELTA_LIMITS.string + 1) } } });
    invalid(state, { ...base(), changes: { set: { huge: Array(SNAPSHOT_DELTA_LIMITS.array + 1).fill(0) } } });
    const players = Array.from({ length: SNAPSHOT_DELTA_LIMITS.entities + 1 }, (_, at) => ({ id: String(at) }));
    expect(() => createSnapshotFull({ epoch: 'x', players }, 1)).toThrow();
    let deep: unknown = 1; for (let at = 0; at < 30; at++) deep = { next: deep };
    invalid(state, { ...base(), changes: { set: { deep } } });
    const many = Array.from({ length: 1000 }, () => Array(60).fill(0));
    invalid(state, { ...base(), changes: { set: { many } } });
  });
  it('bounds reconstructed state across individually bounded patches', () => {
    let accumulated = applied(undefined, createSnapshotFull({ epoch: 'growth' }, 1));
    for (let seq = 2; seq < 25; seq++) {
      const set = Object.fromEntries(Array.from({ length: 12 }, (_, at) => [`field-${seq}-${at}`, 'small']));
      const result = applySnapshotFrame(accumulated, { v: 1, kind: 'delta', epoch: 'growth', baseSeq: seq - 1, seq, changes: { set } });
      if (seq < 23) { expect(result.ok).toBe(true); if (result.ok) accumulated = result.state; }
      else { expect(result).toMatchObject({ ok: false, reason: 'invalid-frame' }); break; }
    }
  });
  it('rejects duplicate IDs in full snapshots and stateless encoder inputs', () => {
    const duplicate = fixture(); duplicate.players.push(clone(duplicate.players[0]!));
    expect(() => createSnapshotFull(duplicate, 1)).toThrow(); expect(() => createSnapshotDelta(before, duplicate, 1)).toThrow();
    invalid(undefined, { v: 1, kind: 'full', epoch: duplicate.epoch, seq: 1, snapshot: duplicate });
  });
});
