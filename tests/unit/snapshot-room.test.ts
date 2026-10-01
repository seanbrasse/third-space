import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {PartyRoom} from '../../apps/game-server/src/PartyRoom';
import {LocalStore} from '../../packages/data/src/index';
import {FOREST_INTERIORS} from '../../packages/config/src/authored-forest';
import type {PlayerState, RoomSnapshot} from '../../packages/contracts/src/index';
import {applySnapshotFrame, type SnapshotDeltaEncoder, type SnapshotFrame, type SnapshotState} from '../../packages/contracts/src/snapshot-delta';

type Client = Parameters<PartyRoom['onJoin']>[0];
type Handler = (client: Client, payload: unknown) => void;
type Stream = {encoder: SnapshotDeltaEncoder<RoomSnapshot>; forceFull: boolean; resyncAt: number};
interface Authority {
  snapshotStreams: Map<Client, Stream>;
  sendSnapshots(): void;
  changeWorld(id: 'living-room' | 'forest'): void;
}
interface Delivery {type: string; payload: unknown}

let store: LocalStore, room: PartyRoom, clients: Client[], ids: string[], homeId: string, serial: number;
let handlers: Map<string, Handler>, deliveries: Map<Client, Delivery[]>;
const authority = () => room as unknown as Authority;
const player = (index: number) => room.players.get(ids[index]!)!;
const events = (client: Client, type: string) => deliveries.get(client)!.filter(event => event.type === type).map(event => event.payload);
const frames = (client: Client) => events(client, 'snapshot.delta') as SnapshotFrame<RoomSnapshot>[];
const lastFrame = (client: Client) => frames(client).at(-1)!;
const skip = (ms: number) => vi.setSystemTime(Date.now() + ms);
function send(client: Client, type: string, payload: unknown = {v: 1}) { handlers.get(type)!(client, payload); }
function snapshot() { authority().sendSnapshots(); }
function receive(client: Client, type: string, payload: unknown) {
  // A real socket serializes immediately. Retaining mutable room DTO references
  // in this fake transport would hide deleted fields and corrupt old baselines.
  deliveries.get(client)!.push({type, payload: structuredClone(payload)});
}
function makeClient(sessionId: string) {
  const client = {sessionId, send: vi.fn(), leave: vi.fn()} as unknown as Client;
  deliveries.set(client, []);
  vi.mocked(client.send).mockImplementation((type, payload) => receive(client, String(type), payload));
  return client;
}
function admit(index: number, suffix = '', replaceExisting = false) {
  const client = makeClient(`snapshot-${index}${suffix}`);
  client.auth = room.onAuth(client, {homeId, ticket: store.issueTicket(homeId, ids[index]!).ticket});
  room.onJoin(client, {replaceExisting});
  return client;
}
function enable(client: Client) {
  send(client, 'snapshot.delta-ready');
  expect(authority().snapshotStreams.has(client)).toBe(true);
}
function observeInput(client: Client) {
  const encoder = authority().snapshotStreams.get(client)!.encoder;
  const original = encoder.encode.bind(encoder);
  let expected: RoomSnapshot;
  vi.spyOn(encoder, 'encode').mockImplementation((value, now, forceFull) => {
    expected = structuredClone(value);
    return original(value, now, forceFull);
  });
  return () => expected;
}
function reconstruct(client: Client, state?: SnapshotState<RoomSnapshot>) {
  const result = applySnapshotFrame(state, lastFrame(client), room.epoch);
  expect(result.ok, `valid frame for ${client.sessionId}`).toBe(true);
  if (!result.ok) throw new Error(result.reason);
  expect(result.applied).toBe(true);
  return result.state;
}
function command(index: number, payload: Record<string, unknown>) {
  const p = player(index);
  send(clients[index]!, 'command', {commandId: `snapshot-command-${++serial}`, worldRevision: room.worldRevision, lifeRevision: p.respawnCount ?? 0, zoneRevision: p.zoneRevision ?? 0, ...payload});
}
function place(index: number, x: number, y: number, zone?: PlayerState['zone']) {
  const p = player(index);
  Object.assign(p, {x, y, vx: 0, vy: 0, mode: 'home', zone});
  delete p.seatId;
  return p;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  serial = 0; handlers = new Map(); deliveries = new Map();
  store = new LocalStore({path: ':memory:'});
  ids = Array.from({length: 8}, (_, i) => store.createIdentity({name: `Snapshot friend ${i}`}).profile.id);
  homeId = store.createHome(ids[0]!, {name: 'Snapshot fixture', pin: '123456'}).id;
  store.db.prepare('UPDATE homes SET capacity=8 WHERE id=?').run(homeId);
  ids.slice(1).forEach(id => store.joinHome(homeId, id, {pin: '123456'}));
  PartyRoom.store = store; room = new PartyRoom(); room.worldId = 'forest';
  vi.spyOn(room, 'setMatchmaking').mockResolvedValue();
  vi.spyOn(room, 'onMessage').mockImplementation((type, handler) => {handlers.set(String(type), handler as unknown as Handler);});
  vi.spyOn(room, 'setTimestep').mockImplementation(() => {});
  vi.spyOn(room.clock, 'setInterval').mockReturnValue({} as ReturnType<typeof room.clock.setInterval>);
  room.onCreate({homeId});
  clients = ids.map((_id, i) => admit(i));
});
afterEach(() => {room.onDispose(); room.clock.clear(); store.close(); vi.restoreAllMocks(); vi.useRealTimers();});

describe('snapshot transport through the actual eight-human PartyRoom', () => {
  it('keeps legacy clients on complete snapshots until each current admitted socket explicitly opts in', () => {
    skip(50); snapshot();
    for (const client of clients) {
      const latest = events(client, 'snapshot').at(-1) as RoomSnapshot;
      expect(latest).toMatchObject({epoch: room.epoch, worldId: 'forest', serverTime: Date.now()});
      expect(latest.members).toHaveLength(8);
      expect(frames(client)).toEqual([]);
    }
    const opted = clients[0]!, legacyCount = events(opted, 'snapshot').length;
    enable(opted); snapshot();
    expect(lastFrame(opted)).toMatchObject({v: 1, kind: 'full', seq: 1, epoch: room.epoch});
    expect(events(opted, 'snapshot')).toHaveLength(legacyCount);
    expect(authority().snapshotStreams.size).toBe(1);
    expect(frames(clients[1]!)).toEqual([]);
  });

  it('rejects malformed opt-ins and forged, unadmitted, disconnected or revoked sockets', () => {
    const current = clients[1]!;
    for (const raw of [undefined, null, false, 1, '1', [], [1], {}, {v: 0}, {v: 2}, {v: '1'}, {v: 1, extra: true}]) {
      handlers.get('snapshot.delta-ready')!(current, raw);
      expect(authority().snapshotStreams.has(current)).toBe(false);
    }
    const forged = makeClient('forged-current-auth'); forged.auth = current.auth;
    const unadmitted = makeClient('no-auth');
    send(forged, 'snapshot.delta-ready'); send(unadmitted, 'snapshot.delta-ready');
    player(1).connected = false; send(current, 'snapshot.delta-ready'); player(1).connected = true;
    expect(authority().snapshotStreams.size).toBe(0);
    // Also check fresh membership, independently of access-change cleanup.
    const access = vi.spyOn(store, 'canAccess').mockReturnValue(false);
    send(current, 'snapshot.delta-ready'); expect(authority().snapshotStreams.size).toBe(0); access.mockRestore();
    enable(current); store.banMember(homeId, ids[0]!, ids[1]!);
    send(current, 'snapshot.delta-ready'); send(current, 'snapshot.resync');
    expect(authority().snapshotStreams.has(current)).toBe(false);
    expect(current.leave).toHaveBeenCalledWith(4003);
    expect(events(forged, 'snapshot.delta')).toEqual([]);
  });

  it('reconstructs independent recipient snapshots exactly across movement, removals and far-apart interests', () => {
    const positions = [[28, 24], [46, 85], [97, 40], [124, 24], [108, 71], [124, 94], [72, 95], [38, 102]];
    positions.forEach(([x, y], i) => place(i, x!, y!));
    enable(clients[0]!); snapshot(); snapshot();
    clients.slice(1, 7).forEach(enable);
    const expected = clients.slice(0, 7).map(observeInput);
    snapshot();
    const states = clients.slice(0, 7).map((client, i) => {
      // Client zero has already received two frames; reconstruct its full history.
      let state: SnapshotState<RoomSnapshot> | undefined;
      for (const frame of frames(client)) {
        const result = applySnapshotFrame(state, frame, room.epoch);
        if (!result.ok) throw new Error(result.reason);
        state = result.state;
      }
      expect(state!.snapshot).toStrictEqual(expected[i]!());
      return state!;
    });
    expect(states.map(s => s.seq)).toEqual([3, 1, 1, 1, 1, 1, 1]);
    expect(states[0]!.snapshot.npcs?.map(n => n.id)).not.toEqual(states[5]!.snapshot.npcs?.map(n => n.id));
    expect(new Set([...authority().snapshotStreams.values()].map(s => s.encoder)).size).toBe(7);
    for (let step = 0; step < 8; step++) {
      skip(50); player(0).x += .05; player(5).y += .1;
      if (step === 1) {player(2).manualMute = true; player(2).sprintUntil = Date.now() + 100;}
      if (step === 2) {player(2).manualMute = false; delete player(2).sprintUntil;}
      if (step === 3) {player(3).roastingAt = Date.now(); player(3).flashlightOn = true;}
      if (step === 4) {delete player(3).roastingAt; player(3).flashlightOn = false;}
      snapshot();
      clients.slice(0, 7).forEach((client, i) => {
        const prior = states[i]!, preserved = structuredClone(prior.snapshot);
        states[i] = reconstruct(client, prior);
        expect(lastFrame(client).kind).toBe('delta');
        expect(states[i]!.snapshot).toStrictEqual(expected[i]!());
        expect(prior.snapshot).toStrictEqual(preserved);
      });
    }
    expect(frames(clients[7]!)).toEqual([]);
    expect((events(clients[7]!, 'snapshot').at(-1) as RoomSnapshot).members).toHaveLength(8);
  });

  it('rate-limits valid resyncs per socket, preserves sequence monotonicity, and ignores repeat opt-in', () => {
    const client = clients[0]!; enable(client); snapshot();
    let state = reconstruct(client);
    const encoder = authority().snapshotStreams.get(client)!.encoder;
    send(client, 'snapshot.delta-ready');
    expect(authority().snapshotStreams.get(client)!.encoder).toBe(encoder);
    for (const raw of [null, [], {v: 2}, {v: 1, seq: 999}]) send(client, 'snapshot.resync', raw);
    skip(50); snapshot(); expect(lastFrame(client)).toMatchObject({kind: 'delta', seq: 2}); state = reconstruct(client, state);
    send(client, 'snapshot.resync'); snapshot(); expect(lastFrame(client)).toMatchObject({kind: 'full', seq: 3}); state = reconstruct(client, state);
    skip(999); send(client, 'snapshot.resync'); snapshot(); expect(lastFrame(client)).toMatchObject({kind: 'delta', seq: 4}); state = reconstruct(client, state);
    skip(1); send(client, 'snapshot.resync'); snapshot(); expect(lastFrame(client)).toMatchObject({kind: 'full', seq: 5}); state = reconstruct(client, state);
    expect(state.seq).toBe(5);
    expect(authority().snapshotStreams.size).toBe(1);
  });

  it('does not let forged or suspended clients force an admitted stream to resync', () => {
    const client = clients[0]!; enable(client); snapshot();
    const forged = makeClient('borrowed-session'); forged.auth = client.auth;
    send(forged, 'snapshot.resync');
    player(0).connected = false; send(client, 'snapshot.resync'); player(0).connected = true;
    const access = vi.spyOn(store, 'canAccess').mockReturnValue(false); send(client, 'snapshot.resync'); access.mockRestore();
    snapshot(); expect(lastFrame(client)).toMatchObject({kind: 'delta', seq: 2});
    expect(authority().snapshotStreams.get(client)!.resyncAt).toBe(0);
  });

  it('keeps resync quotas and full-baseline requests independent for each recipient', () => {
    const [first, second] = clients;
    enable(first!); enable(second!); snapshot();
    send(first!, 'snapshot.resync'); snapshot();
    expect(lastFrame(first!)).toMatchObject({kind: 'full', seq: 2});
    expect(lastFrame(second!)).toMatchObject({kind: 'delta', seq: 2});
    skip(50); send(first!, 'snapshot.resync'); send(second!, 'snapshot.resync'); snapshot();
    expect(lastFrame(first!)).toMatchObject({kind: 'delta', seq: 3});
    expect(lastFrame(second!)).toMatchObject({kind: 'full', seq: 3});
    send(clients[7]!, 'snapshot.resync');
    expect(authority().snapshotStreams.size).toBe(2);
  });

  it('recovers from a missed delta with a fresh higher-sequence full frame', () => {
    const client = clients[0]!; enable(client); const expected = observeInput(client); snapshot();
    const initial = reconstruct(client);
    player(0).x += .1; skip(50); snapshot(); // Packet two never reaches this decoder.
    player(0).x += .1; skip(50); snapshot();
    expect(applySnapshotFrame(initial, lastFrame(client), room.epoch)).toEqual({ok: false, resync: true, reason: 'missing-base'});
    send(client, 'snapshot.resync'); snapshot();
    expect(lastFrame(client)).toMatchObject({kind: 'full', seq: 4});
    const recovered = reconstruct(client, initial); expect(recovered.snapshot).toStrictEqual(expected());
    const late = applySnapshotFrame(recovered, frames(client)[1], room.epoch);
    expect(late).toMatchObject({ok: true, applied: false, state: recovered});
  });

  it('periodically refreshes full baselines even without a resync request', () => {
    const client = clients[0]!; enable(client); snapshot(); let state = reconstruct(client);
    skip(1_999); snapshot(); expect(lastFrame(client).kind).toBe('delta'); state = reconstruct(client, state);
    skip(1); snapshot(); expect(lastFrame(client)).toMatchObject({kind: 'full', seq: 3}); state = reconstruct(client, state);
    skip(50); snapshot(); expect(lastFrame(client)).toMatchObject({kind: 'delta', baseSeq: state.seq, seq: 4});
  });

  it('isolates a failed delta send, keeps seven other recipients current, and recovers the failed socket with full state', () => {
    clients.forEach(enable); const expected = clients.map(observeInput); snapshot();
    const states = clients.map(client => reconstruct(client));
    const bad = clients[0]!;
    vi.mocked(bad.send).mockImplementationOnce(() => {throw new Error('fixture socket send failure');});
    skip(50); player(6).x += .25;
    expect(snapshot).not.toThrow();
    expect(lastFrame(bad).seq).toBe(1);
    clients.slice(1).forEach((client, offset) => {
      const i = offset + 1; states[i] = reconstruct(client, states[i]);
      expect(lastFrame(client)).toMatchObject({kind: 'delta', seq: 2});
      expect(states[i]!.snapshot).toStrictEqual(expected[i]!());
    });
    snapshot(); expect(lastFrame(bad)).toMatchObject({kind: 'full', seq: 3});
    expect(reconstruct(bad, states[0]).snapshot).toStrictEqual(expected[0]!());
    for (const client of clients.slice(1)) expect(lastFrame(client)).toMatchObject({kind: 'delta', seq: 3});
  });

  it('isolates a throwing legacy transport from every opted-in recipient', () => {
    clients.slice(1).forEach(enable); snapshot();
    vi.mocked(clients[0]!.send).mockImplementationOnce(() => {throw new Error('fixture legacy socket failure');});
    expect(snapshot).not.toThrow();
    for (const client of clients.slice(1)) expect(lastFrame(client)).toMatchObject({kind: 'delta', seq: 2});
  });

  it('drops old baselines on reconnect and starts the recreated admitted socket at a new full baseline', async () => {
    const old = clients[1]!, other = clients[0]!; enable(old); enable(other); snapshot(); snapshot();
    let resolve!: (client: Client) => void;
    const reconnection = new Promise<Client>(done => {resolve = done;});
    vi.spyOn(room, 'allowReconnection').mockReturnValue(reconnection as unknown as ReturnType<PartyRoom['allowReconnection']>);
    const drop = room.onDrop(old);
    expect(authority().snapshotStreams.has(old)).toBe(false);
    send(old, 'snapshot.delta-ready'); expect(authority().snapshotStreams.has(old)).toBe(false);
    const fresh = makeClient(old.sessionId); fresh.auth = old.auth;
    room.onReconnect(fresh); resolve(fresh); await drop; clients[1] = fresh;
    expect(player(1).connected).toBe(true);
    expect(events(fresh, 'welcome')).toHaveLength(1);
    expect(events(fresh, 'snapshot')).toHaveLength(1);
    expect(frames(fresh)).toEqual([]);
    send(old, 'snapshot.delta-ready'); send(old, 'snapshot.resync');
    enable(fresh); const expected = observeInput(fresh); snapshot();
    expect(lastFrame(fresh)).toMatchObject({kind: 'full', seq: 1});
    expect(reconstruct(fresh).snapshot).toStrictEqual(expected());
    expect(lastFrame(other).seq).toBeGreaterThan(2);
    room.onLeave(old); snapshot();
    expect(room.players.has(ids[1]!)).toBe(true);
    expect(lastFrame(fresh)).toMatchObject({kind: 'delta', seq: 2});
    expect(authority().snapshotStreams.has(old)).toBe(false);
  });

  it('starts an explicitly replacing tab in legacy mode, rejects the displaced tab, and clears streams on final leave', async () => {
    const old = clients[2]!; enable(old); snapshot(); snapshot();
    const fresh = admit(2, '-new-tab', true); clients[2] = fresh;
    expect(old.leave).toHaveBeenCalledWith(4011);
    expect(authority().snapshotStreams.has(old)).toBe(false);
    expect(events(fresh, 'snapshot')).toHaveLength(1);
    send(old, 'snapshot.delta-ready'); send(old, 'snapshot.resync');
    enable(fresh); snapshot(); expect(lastFrame(fresh)).toMatchObject({kind: 'full', seq: 1});
    await room.onDrop(old); room.onLeave(old); snapshot();
    expect(lastFrame(fresh)).toMatchObject({kind: 'delta', seq: 2});
    expect(room.players.size).toBe(8);
    room.onLeave(fresh); expect(authority().snapshotStreams.has(fresh)).toBe(false);
    expect(room.players.has(ids[2]!)).toBe(false);
    const returning = admit(2, '-later'); enable(returning); snapshot();
    expect(lastFrame(returning)).toMatchObject({kind: 'full', seq: 1});
    room.onDispose(); expect(authority().snapshotStreams.size).toBe(0);
  });

  it('rejects a mismatched reconnect session and a revoked reserved session without creating delta streams', () => {
    const old = clients[1]!; enable(old); snapshot();
    const stranger = makeClient('not-the-reserved-session'); stranger.auth = old.auth;
    room.onReconnect(stranger); send(stranger, 'snapshot.delta-ready');
    expect(stranger.leave).toHaveBeenCalledWith(4011);
    expect(events(stranger, 'welcome')).toEqual([]); expect(frames(stranger)).toEqual([]);
    expect(authority().snapshotStreams.has(old)).toBe(true);
    store.banMember(homeId, ids[0]!, ids[1]!);
    const revoked = makeClient(old.sessionId); revoked.auth = old.auth;
    room.onReconnect(revoked); send(revoked, 'snapshot.delta-ready');
    expect(revoked.leave).toHaveBeenCalledWith(4003);
    expect(events(revoked, 'welcome')).toEqual([]); expect(frames(revoked)).toEqual([]);
    expect(authority().snapshotStreams.size).toBe(0);
  });

  it('forces full frames for world transitions and reconstructs removed forest-only fields', () => {
    clients.slice(0, 2).forEach(enable); const expected = clients.slice(0, 2).map(observeInput); snapshot();
    const states = clients.slice(0, 2).map(client => reconstruct(client));
    authority().changeWorld('living-room');
    clients.slice(0, 2).forEach((client, i) => {
      expect(lastFrame(client)).toMatchObject({kind: 'full', seq: 2}); states[i] = reconstruct(client, states[i]);
      expect(states[i]!.snapshot).toStrictEqual(expected[i]!());
      expect(states[i]!.snapshot).toMatchObject({worldId: 'living-room', rootWorldId: 'living-room'});
      expect(states[i]!.snapshot.survival).toBeUndefined(); expect(states[i]!.snapshot.climate).toBeUndefined();
    });
    authority().changeWorld('forest');
    clients.slice(0, 2).forEach((client, i) => {
      expect(lastFrame(client)).toMatchObject({kind: 'full', seq: 3});
      expect(reconstruct(client, states[i]).snapshot).toStrictEqual(expected[i]!());
    });
  });

  it('forces full state only for the actor entering or leaving an interior, while exterior deltas remove and restore that actor', () => {
    const interior = FOREST_INTERIORS[0]!;
    place(0, interior.returnPoint.x, interior.returnPoint.y);
    clients.slice(0, 2).forEach(enable); const expected = clients.slice(0, 2).map(observeInput); snapshot();
    const states = clients.slice(0, 2).map(client => reconstruct(client));
    command(0, {type: 'interior.enter', interiorId: interior.id});
    expect(player(0).zone).toBe(interior.id);
    expect(lastFrame(clients[0]!)).toMatchObject({kind: 'full', seq: 2});
    expect(lastFrame(clients[1]!)).toMatchObject({kind: 'delta', seq: 2});
    clients.slice(0, 2).forEach((client, i) => {states[i] = reconstruct(client, states[i]); expect(states[i]!.snapshot).toStrictEqual(expected[i]!());});
    expect(states[0]!.snapshot.players.map(p => p.id)).toEqual([ids[0]]);
    expect(states[0]!.snapshot.npcs).toBeUndefined();
    expect(states[1]!.snapshot.players.map(p => p.id)).not.toContain(ids[0]);
    expect(states[1]!.snapshot.members).toHaveLength(8);
    skip(1_501); place(0, interior.exit.x, interior.exit.y, interior.id as PlayerState['zone']);
    command(0, {type: 'interior.enter', interiorId: 'outside'});
    expect(player(0).zone).toBeUndefined();
    expect(lastFrame(clients[0]!)).toMatchObject({kind: 'full', seq: 3});
    expect(lastFrame(clients[1]!)).toMatchObject({kind: 'delta', seq: 3});
    clients.slice(0, 2).forEach((client, i) => {states[i] = reconstruct(client, states[i]); expect(states[i]!.snapshot).toStrictEqual(expected[i]!());});
    expect(states[1]!.snapshot.players.map(p => p.id)).toContain(ids[0]);
  });
});
