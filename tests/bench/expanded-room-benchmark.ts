/** Full PartyRoom CPU/transport harness, isolated from servers, sockets and local data.
 * Node24 --expose-gc --import tsx tests/bench/expanded-room-benchmark.ts --seconds 300
 * --mode integrated requires the actual expanded world + 32 actors; no map/NPC override.
 */
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { PartyRoom } from '../../apps/game-server/src/PartyRoom';
import { LocalStore } from '../../packages/data/src/index';
import { GAME_CONFIG, getWorld, type Point, type WorldMap, type WorldDefinition } from '../../packages/config/src/index';
import { expandAuthoredForest, FOREST_BUILDINGS } from '../../packages/config/src/authored-forest';
import { createAuthoredForestNPCs } from '../../apps/game-server/src/authored-forest-npcs';
import { ForestNPCController, NPC_RULES } from '../../apps/game-server/src/ForestNPCController';
import { ForestEncounter } from '../../apps/game-server/src/ForestStalker';
import { ForestWerewolf } from '../../apps/game-server/src/ForestWerewolf';
import { ForestMimic } from '../../apps/game-server/src/ForestMimic';
import { findHomePath, isHomeWalkable, distance } from '../../packages/simulation/src/index';
import { worldClimateAt, WORLD_CLIMATE_RULES } from '../../apps/game-server/src/world-climate';
import { worldDayAt } from '../../packages/contracts/src/world-climate';
import type { PlayerState, RoomSnapshot } from '../../packages/contracts/src/index';
import { SnapshotDeltaEncoder, applySnapshotFrame, type SnapshotState } from '../../packages/contracts/src/snapshot-delta';
import type { ForestNPC } from '../../packages/contracts/src/forest-npc';

type Client = Parameters<PartyRoom['onJoin']>[0];
type CommandHandler = (client: Client, raw: unknown) => void;
interface Authority {
  npcs: ForestNPCController | null;
  encounter: ForestEncounter | null;
  werewolf: ForestWerewolf | null;
  mimic: ForestMimic | null;
  mapFor(player: PlayerState): WorldMap;
  simulate(dt: number): void;
  sendSnapshots(): void;
}
const serverRequire = createRequire(new URL('../../apps/game-server/package.json', import.meta.url));
const core = serverRequire('@colyseus/core') as { getMessageBytes: { raw(code: number, type: string, message: unknown): Buffer }; Protocol: { ROOM_DATA: number } };
const encodeFrame = (type: string, payload: unknown) => core.getMessageBytes.raw(core.Protocol.ROOM_DATA, type, payload);
const coreRequire = createRequire(serverRequire.resolve('@colyseus/core'));
const msgpack = coreRequire('msgpackr') as { unpack(bytes: Uint8Array): unknown };
const snapshotHeaderBytes = encodeFrame('snapshot', undefined).byteLength;
const deltaHeaderBytes = encodeFrame('snapshot.delta', undefined).byteLength;
const sourceFingerprint = Object.fromEntries(['apps/game-server/src/PartyRoom.ts', 'apps/game-server/src/ForestNPCController.ts', 'packages/simulation/src/index.ts', 'packages/config/src/index.ts', 'packages/config/src/authored-forest.ts', 'tests/bench/expanded-room-benchmark.ts', 'packages/contracts/src/snapshot-delta.ts', 'apps/game-server/src/living-world-room.ts', 'apps/game-server/src/LivingWorldController.ts', 'apps/game-server/src/KnifeFinisher.ts', 'packages/data/src/living-world-store.ts', 'packages/config/src/living-environment.ts', 'apps/game-server/src/GoblinPatrol.ts', 'apps/game-server/src/stolen-lantern-room.ts', 'packages/data/src/stolen-lantern-store.ts', 'packages/config/src/lantern-cave.ts'].map(path => [path, createHash('sha256').update(readFileSync(new URL('../../' + path, import.meta.url))).digest('hex')]));
const args = process.argv.slice(2).filter(a => a !== '--');
const value = (flag: string, fallback: string) => { const at = args.indexOf(flag); return at < 0 ? fallback : args[at + 1] ?? fallback; };
const seconds = Number(value('--seconds', '300'));
const warmupSeconds = Number(value('--warmup', '15'));
const seed = Number(value('--seed', '41'));
const mode = value('--mode', 'fixture');
const scenario = value('--scenario', 'both');
const compareDeltas = args.includes('--delta');
assert(Number.isFinite(seconds) && seconds >= 5 && seconds <= 3600, 'Use 5–3600 simulated seconds.');
assert(Number.isFinite(warmupSeconds) && warmupSeconds >= 0 && warmupSeconds <= 120, 'Use 0–120 warmup seconds.');
assert(Number.isSafeInteger(seed), 'Seed must be an integer.');
assert(mode === 'fixture' || mode === 'integrated', 'Mode must be fixture or integrated.');
assert(['spread', 'cluster', 'both'].includes(scenario), 'Scenario must be spread, cluster or both.');
function randomSource(initial: number) { let state = initial >>> 0; return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; }; }
/** Fixed reservoir: long runs do not retain every timing/serialized payload. */
class Metric {
  private samples = new Float64Array(120_000);
  private retained = 0;
  private random = randomSource(7021);
  count = 0; sum = 0; max = 0;
  add(value: number) {
    this.count++; this.sum += value; this.max = Math.max(this.max, value);
    if (this.retained < this.samples.length) this.samples[this.retained++] = value;
    else { const at = Math.floor(this.random() * this.count); if (at < this.samples.length) this.samples[at] = value; }
  }
  report() {
    const sorted = this.samples.slice(0, this.retained).sort();
    const q = (fraction: number) => Number((sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0).toFixed(4));
    return { count: this.count, samplesRetained: this.retained, quantiles: this.count <= this.retained ? 'exact' : 'deterministic-reservoir',
      mean: Number((this.sum / (this.count || 1)).toFixed(4)), p50: q(.5), p95: q(.95), p99: q(.99), max: Number(this.max.toFixed(4)) };
  }
}
const miB = (bytes: number) => Number((bytes / 1048576).toFixed(2));
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function runScenario(layout: 'spread' | 'cluster') {
  const originalNow = Date.now;
  const started = performance.now();
  // Includes a natural day→dusk→night boundary in a five-minute measured run.
  const epoch = WORLD_CLIMATE_RULES.epochMs + WORLD_CLIMATE_RULES.cycleMs * 3 + Math.round(WORLD_CLIMATE_RULES.cycleMs * .60);
  let now = epoch, measured = false, room: PartyRoom | undefined, store: LocalStore | undefined;
  Date.now = () => now;
  const random = randomSource(seed);
  const metrics = {
    simulationTickMs: new Metric(), inputDispatchBatchMs: new Metric(), snapshotBatchMs: new Metric(),
    jsonSerializePerClientMs: new Metric(), snapshotBytesPerClient: new Metric(),
    transportEncodePerClientMs: new Metric(), transportFrameBytesPerClient: new Metric(),
    npcTickMs: new Metric(), monsterTickMs: new Metric(), botPathPlanningMs: new Metric(),
    diagnosticFullPopulationJsonMs: new Metric(), diagnosticFullPopulationBytes: new Metric(),
    measuredFrameCpuMs: new Metric(), deltaCandidateFrameCpuMs: new Metric(), deltaEncodePerClientMs: new Metric(), deltaTransportEncodeMs: new Metric(), deltaClientApplyMs: new Metric(), deltaFrameBytes: new Metric(), humansBeyondSanctuary: new Metric(), humanSpanTiles: new Metric(),
  };
  const byClient = Array.from({ length: 8 }, () => ({ snapshots: 0, bytes: 0, transportBytes: 0, maximumBytes: 0, maximumVisibleNpcs: 0, inputs: 0, movingTicks: 0, pathRequests: 0, successfulPaths: 0, respawns: 0, movementTiles: 0 }));
  const messages: Record<string, number> = {}, notices: Record<string, number> = {};
  const fieldBytes = new Map<string, { samples: number; total: number; maximum: number }>();
  const measureField = (name: string, value: unknown) => {
    if (value === undefined) return;
    const bytes = Buffer.byteLength(JSON.stringify(value)), prior = fieldBytes.get(name) ?? { samples: 0, total: 0, maximum: 0 };
    prior.samples++; prior.total += bytes; prior.maximum = Math.max(prior.maximum, bytes); fieldBytes.set(name, prior);
  };
  const latestSnapshots: Array<RoomSnapshot | undefined> = Array(8);
  const npcMovement = new Map<string, { x: number; y: number; distance: number; observations: number; movingObservations: number }>();
  const monsterPhases: Record<string, number> = {}, monsterActiveTicks: Record<string, number> = {};
  const memory: Array<{ elapsedSeconds: number; rssMiB: number; heapUsedMiB: number; externalMiB: number; arrayBuffersMiB: number }> = [];
  let otherTransportBytes = 0;
  let comparisonCpuMs = 0, deltaServerCpuMs = 0, baselineEncodeCpuMs = 0, deltaFullFrames = 0, deltaFrames = 0, reconstructed = 0;
  const deltaEncoders = Array.from({ length: 8 }, () => new SnapshotDeltaEncoder<RoomSnapshot>());
  const deltaStates: Array<SnapshotState<RoomSnapshot> | undefined> = Array(8);
  let maxNpcPathPoints = 0, maxNpcSearchesPerTick = 0, measuredNpcTicks = 0, measuredInputs = 0, scheduledSnapshotBatches = 0, projectedBytes = 0, tickBudgetMisses = 0;
  let authority: Authority;
  try {
    const baseWorld = getWorld('forest');
    const expanded = mode === 'fixture' ? expandAuthoredForest(baseWorld.map) : baseWorld.map;
    const map = mode === 'fixture' ? { ...expanded, solids: Object.freeze(expanded.solids.map(s => Object.freeze({ ...s }))) } as unknown as WorldMap : expanded;
    assert.equal(map.width, 144, 'Integrated map is not144 tiles wide yet; use --mode fixture before world integration.');
    assert.equal(map.height, 112, 'Integrated map is not112 tiles tall yet.');
    const world: WorldDefinition = { ...baseWorld, map };
    store = new LocalStore({ path: ':memory:' });
    const ids = Array.from({ length: 8 }, (_, i) => store!.createIdentity({ name: `Profile walker ${i + 1}` }).profile.id);
    const homeId = store.createHome(ids[0]!, { name: `Isolated ${layout} profile`, pin: '123456' }).id;
    store.db.prepare('UPDATE homes SET capacity=8 WHERE id=?').run(homeId);
    for (const id of ids.slice(1)) store.joinHome(homeId, id, { pin: '123456' });
    PartyRoom.store = store;
    room = new PartyRoom(); room.worldId = 'forest'; authority = room as unknown as Authority;
    let command: CommandHandler = () => { throw new Error('Command handler was not registered.'); };
    room.setMatchmaking = (async () => {}) as typeof room.setMatchmaking;
    room.onMessage = ((type: string, handler: CommandHandler) => { if (type === 'command') command = handler; }) as typeof room.onMessage;
    room.setTimestep = (() => {}) as typeof room.setTimestep;
    room.clock.setInterval = (() => ({ clear() {}, active: false })) as unknown as typeof room.clock.setInterval;
    room.onCreate({ homeId });
    if (mode === 'fixture') {
      const priorMapFor = authority.mapFor.bind(room);
      authority.mapFor = p => p.zone ? priorMapFor(p) : map;
      authority.npcs = createAuthoredForestNPCs(world, random);
      authority.encounter = new ForestEncounter(world, random);
      authority.werewolf = new ForestWerewolf(world, random);
      authority.mimic = new ForestMimic(world, random);
    }
    assert(authority.npcs, 'Room did not create NPC authority.');
    assert.equal(authority.npcs.snapshot().length, 32, 'Integrated room does not have32 actors yet; use --mode fixture.');
    const npcUpdate = authority.npcs.update.bind(authority.npcs);
    authority.npcs.update = (at, context) => {
      const t = performance.now();
      npcUpdate(at, mode === 'fixture' ? { phase: worldDayAt(worldClimateAt(Math.round(at), homeId), at).phase } : context);
      if (measured) {
        metrics.npcTickMs.add(performance.now() - t); measuredNpcTicks++;
        const d = authority.npcs!.diagnostics(); maxNpcPathPoints = Math.max(maxNpcPathPoints, d.pathPoints); maxNpcSearchesPerTick = Math.max(maxNpcSearchesPerTick, d.lastPathSearches);
        assert(d.actors === 32 && d.lastPathSearches <= NPC_RULES.maxPathSearchesPerTick && d.pathPoints <= d.actors * NPC_RULES.maxPathPoints, 'NPC work bound exceeded.');
      }
    };
    for (const [kind, monster] of [['clown', authority.encounter], ['werewolf', authority.werewolf], ['mimic', authority.mimic]] as const) {
      if (!monster) continue;
      const update = monster.update.bind(monster);
      monster.update = (at, actors, observers) => {
        const t = performance.now(), result = update(at, actors, observers);
        if (measured) {
          metrics.monsterTickMs.add(performance.now() - t);
          const phase = monster.state?.phase;
          if (phase) { const key = `${kind}:${phase}`; monsterPhases[key] = (monsterPhases[key] ?? 0) + 1; monsterActiveTicks[kind] = (monsterActiveTicks[kind] ?? 0) + 1; }
        }
        return result;
      };
    }
    const clients: Client[] = ids.map((id, index) => {
      const client = {
        sessionId: `profile-client-${index}`,
        send(type: string, payload: unknown) {
          if (type === 'snapshot') {
            const snapshot = payload as RoomSnapshot; latestSnapshots[index] = snapshot;
            if (!measured) return;
            const t = performance.now(), encoded = encodeFrame(type, snapshot), elapsed = performance.now() - t, bytes = encoded.byteLength;
            metrics.transportEncodePerClientMs.add(elapsed); metrics.transportFrameBytesPerClient.add(bytes); baselineEncodeCpuMs += elapsed;
            if (compareDeltas) {
              const comparisonStart = performance.now(), codecStart = performance.now();
              const frame = deltaEncoders[index]!.encode(snapshot, now), codecMs = performance.now() - codecStart;
              const transportStart = performance.now(), packet = encodeFrame('snapshot.delta', frame), transportMs = performance.now() - transportStart;
              deltaServerCpuMs += codecMs + transportMs; metrics.deltaEncodePerClientMs.add(codecMs); metrics.deltaTransportEncodeMs.add(transportMs); metrics.deltaFrameBytes.add(packet.byteLength);
              if (frame.kind === 'full') deltaFullFrames++; else deltaFrames++;
              const clientStart = performance.now(), result = applySnapshotFrame(deltaStates[index], msgpack.unpack(packet.subarray(deltaHeaderBytes)));
              metrics.deltaClientApplyMs.add(performance.now() - clientStart);
              assert(result.ok, 'Delta receiver required resync on an ordered complete stream.');
              deltaStates[index] = result.state;
              // Every actual transport frame must reconstruct the complete wire snapshot,
              // including all eight human roster/minimap entries. No sample-only shortcut.
              assert.deepStrictEqual(result.state.snapshot, msgpack.unpack(encoded.subarray(snapshotHeaderBytes))); reconstructed++;
              comparisonCpuMs += performance.now() - comparisonStart;
            }
            const stats = byClient[index]!; stats.snapshots++; stats.transportBytes += bytes; stats.maximumBytes = Math.max(stats.maximumBytes, bytes); stats.maximumVisibleNpcs = Math.max(stats.maximumVisibleNpcs, snapshot.npcs?.length ?? 0);
          } else if (measured) {
            messages[type] = (messages[type] ?? 0) + 1; otherTransportBytes += encodeFrame(type, payload).byteLength;
            if (type === 'notice') { const code = (payload as { code?: string }).code ?? 'unknown'; notices[code] = (notices[code] ?? 0) + 1; }
          }
        },
        leave() { throw new Error('A benchmark human was unexpectedly removed.'); },
      } as unknown as Client;
      client.auth = room!.onAuth(client, { homeId, ticket: store!.issueTicket(homeId, id).ticket });
      room!.onJoin(client, {}); return client;
    });
    assert.equal(room.players.size, 8);
    const anchors: Point[] = layout === 'spread'
      ? [{ x: 14, y: 45 }, ...FOREST_BUILDINGS.slice(0, 5).map(b => ({ x: b.door.x, y: b.door.y + .8 })), {x:64,y:82}, {x:99,y:72}]
      : map.spawns.map(p => ({ x: p.x, y: p.y }));
    for (const anchor of anchors) assert(isHomeWalkable(anchor, map), `Blocked benchmark anchor ${JSON.stringify(anchor)}`);
    const goals = anchors.map(anchor => Array.from({ length: 8 }, (_, i) => ({ x: anchor.x + Math.cos(i * Math.PI / 4) * 2.2, y: anchor.y + Math.sin(i * Math.PI / 4) * 2.2 })).filter(p => isHomeWalkable(p, map)));
    const bots = anchors.map((anchor, i) => ({ path: [] as Point[], nextRouteAt: epoch + i * 250, routeIndex: i, seq: 0, last: { ...anchor } }));
    ids.forEach((id, i) => {
      const p = room!.players.get(id)!; Object.assign(p, anchors[i], { vx: 0, vy: 0, flashlightOn: i % 3 === 0 });
      delete p.seatId; delete p.haloUntil; delete p.zone;
    });
    const captureMemory = (elapsedSeconds: number) => { const m = process.memoryUsage(); memory.push({ elapsedSeconds, rssMiB: miB(m.rss), heapUsedMiB: miB(m.heapUsed), externalMiB: miB(m.external), arrayBuffersMiB: miB(m.arrayBuffers) }); };
    const startMeasurementTick = Math.ceil(warmupSeconds * 60), totalTicks = startMeasurementTick + Math.ceil(seconds * 60);
    let baselineMemory: ReturnType<typeof process.memoryUsage> | undefined;
    const paced = args.includes('--pace'), paceStarted = performance.now();
    for (let tick = 0; tick < totalTicks; tick++) {
      now = epoch + Math.round(tick * 1000 / 60);
      if (tick === startMeasurementTick) { global.gc?.(); measured = true; baselineMemory = process.memoryUsage(); captureMemory(0); }
      // This input driver models browser-side click path planning. Its A* time is
      // reported separately and excluded from the authoritative frame metric.
      for (let i = 0; i < 8; i++) {
        const p = room.players.get(ids[i]!)!, bot = bots[i]!;
        if (p.respawnAt || now < bot.nextRouteAt) continue;
        bot.nextRouteAt = now + 4000 + i * 73;
        const goal = goals[i]![bot.routeIndex++ % goals[i]!.length] ?? anchors[i]!;
        const t = performance.now(), path = findHomePath(p, goal, map);
        if (measured) { metrics.botPathPlanningMs.add(performance.now() - t); byClient[i]!.pathRequests++; byClient[i]!.successfulPaths += Number(!!path); }
        bot.path = path?.slice(1) ?? [];
      }
      const frameStart = performance.now(), comparisonBeforeFrame = comparisonCpuMs, deltaServerBeforeFrame = deltaServerCpuMs, baselineEncodeBeforeFrame = baselineEncodeCpuMs;
      if (tick % 2 === 0) {
        const inputStart = performance.now();
        for (let i = 0; i < 8; i++) {
          const p = room.players.get(ids[i]!)!, bot = bots[i]!;
          while (bot.path.length && distance(p, bot.path[0]!) < .05) bot.path.shift();
          const target = bot.path[0], length = target ? distance(p, target) : 0, gain = Math.min(1, length * 10);
          command(clients[i]!, { type: 'input', worldRevision: room.worldRevision, lifeRevision: p.respawnCount ?? 0, zoneRevision: p.zoneRevision ?? 0,
            input: { seq: ++bot.seq, axisX: target && length ? (target.x - p.x) / length * gain : 0, axisY: target && length ? (target.y - p.y) / length * gain : 0, jump: false, sprint: layout === 'spread' && tick % 420 < 45 } });
          if (measured) { byClient[i]!.inputs++; measuredInputs++; }
        }
        if (measured) metrics.inputDispatchBatchMs.add(performance.now() - inputStart);
      }
      const tickStart = performance.now(), comparisonBeforeTick = comparisonCpuMs; authority.simulate(1 / 60);
      if (measured) metrics.simulationTickMs.add(performance.now() - tickStart - (comparisonCpuMs - comparisonBeforeTick));
      if (tick % 3 === 0) {
        const snapshotStart = performance.now(), comparisonBeforeSnapshot = comparisonCpuMs; authority.sendSnapshots();
        if (measured) { metrics.snapshotBatchMs.add(performance.now() - snapshotStart - (comparisonCpuMs - comparisonBeforeSnapshot)); scheduledSnapshotBatches++; }
      }
      if (measured) { const frameMs = performance.now() - frameStart - (comparisonCpuMs - comparisonBeforeFrame); metrics.measuredFrameCpuMs.add(frameMs); if (frameMs > 1000 / 60) tickBudgetMisses++;
        if (compareDeltas) metrics.deltaCandidateFrameCpuMs.add(frameMs - (baselineEncodeCpuMs - baselineEncodeBeforeFrame) + (deltaServerCpuMs - deltaServerBeforeFrame)); }
      // Observability and a worst-case full-population JSON baseline occur outside
      // frame timing. They are not additional production work.
      if (measured) for (let i = 0; i < 8; i++) {
        const p = room.players.get(ids[i]!)!, bot = bots[i]!, stats = byClient[i]!;
        stats.movingTicks += Number(Math.hypot(p.vx, p.vy) > .001); stats.respawns = p.respawnCount ?? 0;
        const step = distance(p, bot.last); if (step < 2) stats.movementTiles += step; bot.last = { x: p.x, y: p.y };
      }
      if (measured && tick % 60 === 0) {
        captureMemory((tick - startMeasurementTick) / 60);
        const humans = [...room.players.values()], allNpcs = authority.npcs.snapshot();
        metrics.humansBeyondSanctuary.add(humans.filter(p => p.connected && !p.zone && distance(p, world.fire!) > 9.5).length);
        metrics.humanSpanTiles.add(Math.max(...humans.flatMap(a => humans.map(b => distance(a, b)))));
        for (const npc of allNpcs) {
          const prior = npcMovement.get(npc.id) ?? { x: npc.x, y: npc.y, distance: 0, observations: 0, movingObservations: 0 };
          const step = distance(prior, npc); if (step < 4) prior.distance += step;
          Object.assign(prior, { x: npc.x, y: npc.y, observations: prior.observations + 1, movingObservations: prior.movingObservations + Number(npc.moving) }); npcMovement.set(npc.id, prior);
        }
        const climate = worldClimateAt(now, homeId);
        for (const [clientIndex, snapshot] of latestSnapshots.entries()) if (snapshot) {
          const jsonStart = performance.now(), snapshotJson = JSON.stringify(snapshot), jsonElapsed = performance.now() - jsonStart, jsonBytes = Buffer.byteLength(snapshotJson);
          metrics.jsonSerializePerClientMs.add(jsonElapsed); metrics.snapshotBytesPerClient.add(jsonBytes); byClient[clientIndex]!.bytes += jsonBytes;
          for (const [key, value] of Object.entries(snapshot)) measureField(key, value);
          for (const [key, value] of Object.entries(snapshot.survival ?? {})) measureField(`survival.${key}`, value);
          measureField('players.avatarMetadata', snapshot.players.map(p => p.avatar));
          measureField('members.avatarMetadata', snapshot.members?.map(p => p.avatar));
          measureField('npcs.staticMetadataProjection', snapshot.npcs?.map(n => ({ id: n.id, name: n.name, role: n.role, art: n.art, avatar: n.avatar, maxHealth: n.maxHealth, questHook: n.questHook })));
          measureField('npcs.motionProjection', snapshot.npcs?.map(n => ({ id: n.id, x: n.x, y: n.y, facing: n.facing, phase: n.phase, activity: n.activity, moving: n.moving, health: n.health, respawnAt: n.respawnAt, dialogue: n.dialogue })));
          measureField('members.compactPresenceProjection', snapshot.members?.map(p => ({ id: p.id, x: p.x, y: p.y, name: p.name, connected: p.connected, mode: p.mode, zone: p.zone })));
          const t = performance.now(), json = JSON.stringify({ ...snapshot, npcs: allNpcs, climate }), bytes = Buffer.byteLength(json);
          metrics.diagnosticFullPopulationJsonMs.add(performance.now() - t); metrics.diagnosticFullPopulationBytes.add(bytes); projectedBytes += bytes;
        }
      }
      if (paced && tick % 6 === 5) await sleep(Math.max(0, paceStarted + (tick + 1) * 1000 / 60 - performance.now()));
    }
    const after = process.memoryUsage(); captureMemory(seconds); global.gc?.(); const afterGC = process.memoryUsage();
    const snapshotMean = metrics.snapshotBytesPerClient.sum / (metrics.snapshotBytesPerClient.count || 1);
    const fullMean = metrics.diagnosticFullPopulationBytes.sum / (metrics.diagnosticFullPopulationBytes.count || 1);
    const maxRss = Math.max(...memory.map(m => m.rssMiB));
    return {
      scenario: layout, mode, compareDeltas, node: process.version, simulatedSeconds: seconds, warmupSeconds, paced,
      totalWallSeconds: Number(((performance.now() - started) / 1000).toFixed(3)), seed,
      geometry: { width: map.width, height: map.height, solids: map.solids.length, humans: room.players.size, npcs: authority.npcs.snapshot().length, immutableSolids: Object.isFrozen(map.solids) && map.solids.every(Object.isFrozen) },
      coverage: { usesActualPartyRoom: true, realAdmissionAndInputValidation: true, transport: 'in-memory send sinks, no sockets',
        snapshotHasIntegratedClimate: !!(latestSnapshots[0] as RoomSnapshot & { climate?: unknown })?.climate,
        fixtureOverrides: mode === 'fixture' ? ['per-instance mapFor', '32-actor NPC controller and phase context', 'expanded-map monster controller instances'] : [],
        scheduling: 'explicit 60Hz simulate, 30Hz input batches, 20Hz snapshots; event-triggered snapshots retained',
        browserRenderingMeasured: false, npcPathSearchesMaxPerTick: maxNpcSearchesPerTick, npcPathPointsMaximum: maxNpcPathPoints,
        measuredNpcTicks, measuredInputs, scheduledSnapshotBatches, tickBudgetMissesOver16_67ms: tickBudgetMisses,
        monsterActiveTicks, monsterPhases, npcMovement: [...npcMovement].map(([id, stat]) => ({ id, distanceTiles: Number(stat.distance.toFixed(2)), observations: stat.observations, movingObservations: stat.movingObservations })),
      },
      metrics: Object.fromEntries(Object.entries(metrics).map(([name, metric]) => [name, metric.report()])),
      transportFrames: { encoding: 'Installed Colyseus getMessageBytes.raw ROOM_DATA/msgpackr, including room message header; WebSocket/TLS framing and compression excluded',
        meanBytesPerClientSnapshot: Math.round(metrics.transportFrameBytesPerClient.sum / (metrics.transportFrameBytesPerClient.count || 1)),
        allEightAt20HzBytesPerSecond: Math.round(metrics.transportFrameBytesPerClient.sum / (metrics.transportFrameBytesPerClient.count || 1) * 20 * 8),
        snapshotBytesEncoded: byClient.reduce((sum, client) => sum + client.transportBytes, 0), otherMessageBytesEncoded: otherTransportBytes },
      deltaComparison: compareDeltas ? { encoding: 'Actual Colyseus MessagePack snapshot.delta envelopes; initial + 2-second periodic full snapshots included',
        fullFrames: deltaFullFrames, deltaFrames, completeSnapshotsReconstructedAndCompared: reconstructed,
        bytesEncoded: metrics.deltaFrameBytes.sum, meanBytesPerClientFrame: Math.round(metrics.deltaFrameBytes.sum / (reconstructed || 1)),
        allEightAt20HzBytesPerSecond: Math.round(metrics.deltaFrameBytes.sum / (reconstructed || 1) * 160),
        reductionPercent: Number(((1 - metrics.deltaFrameBytes.sum / metrics.transportFrameBytesPerClient.sum) * 100).toFixed(2)),
        timing: 'Delta encode/transport/client apply are measured separately. Baseline frame and snapshot timings subtract comparison diagnostics; candidate frame CPU replaces full encoding with delta encoding+transport. Client decoding/assertions are not server frame work. Both encodings execute in one process; JIT/GC/cache effects still interact.' } : undefined,
      wireProjection: { encoding: 'raw UTF-8 JSON, no compression, protocol/TLS/WebSocket overhead excluded',
        meanBytesPerClientSnapshot: Math.round(snapshotMean), perClientAt20HzBytesPerSecond: Math.round(snapshotMean * 20), allEightAt20HzBytesPerSecond: Math.round(snapshotMean * 20 * 8),
        jsonDiagnosticSampleBytes: byClient.reduce((sum, client) => sum + client.bytes, 0),
        unfilteredNpcPlusClimateMeanBytes: Math.round(fullMean), unfilteredAllEightAt20HzBytesPerSecond: Math.round(fullMean * 20 * 8), diagnosticSampleBytes: projectedBytes },
      fieldValueBytes: { sampling: 'One sample per client per simulated second; values only, excluding top-level key names/commas. Dotted rows are nested/subset projections and must not be added to parent totals.',
        fields: Object.fromEntries([...fieldBytes].map(([field, stats]) => [field, { samples: stats.samples, mean: Math.round(stats.total / stats.samples), max: stats.maximum }])) },
      clients: byClient.map((stats, i) => ({ client: i + 1, anchor: anchors[i], ...stats, movementTiles: Number(stats.movementTiles.toFixed(2)) })),
      messages, notices,
      memory: { baselineRssMiB: miB(baselineMemory!.rss), sampledPeakRssMiB: maxRss, finalRssMiB: miB(after.rss), finalHeapUsedMiB: miB(after.heapUsed),
        afterGcHeapUsedMiB: miB(afterGC.heapUsed), retainedHeapGrowthMiB: miB(afterGC.heapUsed - baselineMemory!.heapUsed),
        observedHeadroomAgainst512MiB: Number((512 - maxRss).toFixed(2)), samples: memory,
        caveat: 'Single isolated Node process with in-memory SQLite and benchmark instrumentation; excludes HTTP/socket server, OS/container overhead, live DB workload, voice provider, Next.js and browsers. Sampled RSS is not guaranteed peak or deployment capacity.' },
    };
  } finally {
    room?.onDispose(); room?.clock.clear(); store?.close(); Date.now = originalNow;
  }
}
const report = {
  kind: 'expanded-party-room-synthetic-profile', createdAt: new Date().toISOString(), sourceFingerprint,
  limits: { noBrowserFpsClaim: true, noLiveDeploymentTouched: true, noProductionDefaultsChanged: true, metricReservoirEntries: 120_000 },
  scenarios: [] as Awaited<ReturnType<typeof runScenario>>[],
};
for (const layout of scenario === 'both' ? ['spread', 'cluster'] as const : [scenario as 'spread' | 'cluster']) report.scenarios.push(await runScenario(layout));
const json = JSON.stringify(report, null, 2), output = value('--out', '');
if (output) writeFileSync(output, json + '\n');
console.log(json);
