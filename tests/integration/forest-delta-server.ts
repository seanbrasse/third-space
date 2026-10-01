/** Child-process fixture for forest-delta.test.ts. No production data or ports. */
import { createGameServer } from '../../apps/game-server/src/server';
import { PartyRoom } from '../../apps/game-server/src/PartyRoom';
import { getWorld, type Point } from '../../packages/config/src/index';
import { FOREST_INTERIORS } from '../../packages/config/src/authored-forest';
import { isHomeWalkable, isHomeSegmentWalkable, distance } from '../../packages/simulation/src/index';
import type { RoomSnapshot } from '../../packages/contracts/src/index';
import type { SnapshotDeltaEncoder } from '../../packages/contracts/src/snapshot-delta';
import type { ForestNPCController } from '../../apps/game-server/src/ForestNPCController';

if (!process.send) throw new Error('This ephemeral test fixture requires a parent IPC connection.');
const runtime = createGameServer({ dataPath: ':memory:', origins: ['http://localhost:3000'] });
const captured = new Map<string, Map<string, RoomSnapshot>>();
const watched = new WeakSet<object>();
let captureEnabled = true;
function detached<T>(value: T): T {
  if (typeof value === 'number') return (Object.is(value, -0) ? 0 : value) as T;
  if (Array.isArray(value)) return value.map(detached) as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, detached(item)])) as T;
  return value;
}
function retain(id: string, key: string, snapshot: RoomSnapshot) {
  if (!captureEnabled) return;
  const history = captured.get(id) ?? new Map<string, RoomSnapshot>();
  history.set(key, detached(snapshot));
  while (history.size > 32) history.delete(history.keys().next().value!);
  captured.set(id, history);
}
interface Inspection {
  npcs: ForestNPCController;
  clientsByUser: Map<string, { send(type: string, payload: unknown): void }>;
  snapshotStreams: Map<object, { encoder: SnapshotDeltaEncoder<RoomSnapshot> }>;
  storyAuthority?: { mystery: { culpritId: string } };
}
function observe(room: PartyRoom) {
  const authority = room as unknown as Inspection;
  for (const [id, client] of authority.clientsByUser) {
    if (!watched.has(client)) {
      const send = client.send.bind(client);
      client.send = (type, payload) => { if (type === 'snapshot') retain(id, `legacy:${(payload as RoomSnapshot).serverTime}`, payload as RoomSnapshot); send(type, payload); };
      watched.add(client);
    }
    const encoder = authority.snapshotStreams.get(client)?.encoder;
    if (!encoder || watched.has(encoder)) continue;
    const encode = encoder.encode.bind(encoder);
    encoder.encode = (snapshot, now, forceFull) => { const frame = encode(snapshot, now, forceFull); retain(id, String(frame.seq), snapshot); return frame; };
    watched.add(encoder);
  }
}
function nearest(point: Point, occupied: Point[] = []): Point {
  const map = getWorld('forest').map;
  for (const radius of [0, .6, 1.2, 1.8, 2.4, 3]) for (let i = 0; i < 16; i++) {
    const candidate = { x: point.x + Math.cos(i * Math.PI / 8) * radius, y: point.y + Math.sin(i * Math.PI / 8) * radius };
    if (isHomeWalkable(candidate, map) && occupied.every(other => distance(candidate, other) > .7)) return candidate;
  }
  throw new Error('No clear placement fixture point.');
}
let placed = false;
process.on('message', async (raw: unknown) => {
  const message = raw as { requestId: number; type: string; homeId?: string; ids?: string[]; userId?: string; seq?: string };
  try {
    let result: unknown;
    if (message.type === 'shutdown') {
      await runtime.server.gracefullyShutdown(false); runtime.store.close();
      process.send!({ requestId: message.requestId, result: { closed: true } }); process.disconnect(); return;
    }
    const room = PartyRoom.liveRooms.get(message.homeId!);
    if (!room) throw new Error('Expected the real admitted room.');
    const authority = room as unknown as Inspection;
    if (message.type === 'place') {
      if (placed) throw new Error('Placement is allowed once, during setup only.'); placed = true;
      if (room.players.size !== 8 || message.ids?.length !== 8) throw new Error('Expected eight actually admitted humans.');
      const orin = authority.npcs.get('npc:wizard-orin-vale'); if (!orin) throw new Error('Missing authored wizard.');
      const interior = FOREST_INTERIORS.find(i => i.buildingId === 'bramble-inn')!;
      const anchors = [{ x: orin.x + .8, y: orin.y }, { x: interior.returnPoint.x, y: interior.returnPoint.y + .6 }, { x: 97, y: 45 }, { x: 124.5, y: 22 }, { x: 108, y: 71 }, { x: 37.5, y: 102 }, { x: 72, y: 95 }, { x: 124, y: 94 }];
      const positions: Point[] = [];
      message.ids.forEach((id, index) => {
        const player = room.players.get(id)!; const point = nearest(anchors[index]!, positions); positions.push(point);
        Object.assign(player, point, { vx: 0, vy: 0 }); delete player.seatId; delete player.roastingAt;
      });
      const mover = room.players.get(message.ids[2]!)!;
      const movementGoal = [{ x: mover.x + .9, y: mover.y }, { x: mover.x, y: mover.y + .9 }, { x: mover.x - .9, y: mover.y }].find(point => isHomeSegmentWalkable(mover, point, getWorld('forest').map));
      if (!movementGoal) throw new Error('No clear input route in placement fixture.');
      observe(room);
      result = { positions, movementGoal, interiorId: interior.id, exit: interior.exit, npcs: authority.npcs.snapshot().length,
        privateMysteryExists: typeof authority.storyAuthority?.mystery.culpritId === 'string' };
    } else if (message.type === 'capture') {
      result = captured.get(message.userId!)?.get(message.seq!);
      if (!result) throw new Error('Requested sequence fell outside the bounded capture window.');
    } else if (message.type === 'observe') { observe(room); result = { watching: true }; }
    else if (message.type === 'memory') {
      captureEnabled = false; captured.clear(); global.gc?.(); const usage = process.memoryUsage();
      result = { pid: process.pid, node: process.version, humans: room.players.size, npcs: authority.npcs.snapshot().length,
        rssMiB: usage.rss / 1048576, heapUsedMiB: usage.heapUsed / 1048576, externalMiB: usage.external / 1048576,
        fixtureCaptureEntries: 0, clientSdkInProcess: false, comparisonReservoirs: false,
        caveat: 'Isolated Node HTTP/WebSocket server plus in-memory SQLite and small fixture wrappers; no SDK clients/test runner, live disk workload, voice, Next.js, container overhead or deployment capacity guarantee.' };
    } else throw new Error('Unknown fixture inspection request.');
    process.send!({ requestId: message.requestId, result });
  } catch (error) { process.send!({ requestId: message.requestId, error: error instanceof Error ? error.message : String(error) }); }
});
await runtime.server.listen(0, '127.0.0.1');
const address = runtime.httpServer.address();
if (!address || typeof address === 'string') throw new Error('No ephemeral loopback port.');
process.send!({ type: 'ready', port: address.port, node: process.version });
