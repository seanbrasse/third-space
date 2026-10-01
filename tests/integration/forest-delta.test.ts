/** Run with Node24: node node_modules/vitest/vitest.mjs run tests/integration/forest-delta.test.ts
 * Requires loopback socket permission. Optional FOREST_DELTA_REPORT writes a JSON
 * evidence report; neither process reads or writes the user's persistent data.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fork, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Client, type Room } from '@colyseus/sdk';
import type { ChatMessage, ClientCommand, PlayerState, RoomSnapshot, ServerNotice } from '../../packages/contracts/src/index';
import type { ForestStorySnapshot } from '../../packages/contracts/src/forest-story';
import { applySnapshotFrame, type SnapshotFrame, type SnapshotState } from '../../packages/contracts/src/snapshot-delta';
import { distance } from '../../packages/simulation/src/index';

type Identity = { id: string; cookie: string };
type Peer = {
  room: Room; identity: Identity; snapshot?: RoomSnapshot; state?: SnapshotState<RoomSnapshot>;
  legacyFrames: number; fullFrames: number; deltaFrames: number; accepted: number; packetCount: number;
  dropNextDelta: boolean; droppedSeq?: number; failedBase?: string; resyncRequests: number; recoveredSeq?: number;
  story?: ForestStorySnapshot; storyPackets: number; chats: ChatMessage[]; notices: ServerNotice[]; errors: string[];
  inputSeq: number; left: boolean; receivedKinds: Array<{ kind: 'full' | 'delta'; seq: number; worldId?: string }>;
};
let child: ChildProcess | undefined, base = '', homeId = '', requests = 0, serverLog = '';
const peers: Peer[] = [];
const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
async function until<T>(read: () => T | undefined | false, reason: string, timeout = 5000): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const errors = peers.flatMap(p => p.errors); if (errors.length) throw new Error(errors.join('\n'));
    const result = read(); if (result) return result as T; await pause(15);
  }
  throw new Error(`${reason}; notices=${JSON.stringify(peers.flatMap(p => p.notices))}; server=${serverLog.slice(-1000)}`);
}
function inspect<T = unknown>(type: string, extra: Record<string, unknown> = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    const requestId = ++requests;
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`Fixture ${type} timed out.`)); }, 5000);
    pending.set(requestId, { resolve: value => resolve(value as T), reject, timer });
    child!.send({ requestId, type, homeId, ...extra });
  });
}
async function request(path: string, identity?: Identity, body?: unknown) {
  const response = await fetch(`${base}/api${path}`, { method: body === undefined ? 'GET' : 'POST',
    headers: { Origin: 'http://localhost:3000', ...(identity ? { Cookie: identity.cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await response.json(); return { response, data };
}
/** Inspect every received gameplay packet, not just rendered story data. */
function privateKeys(value: unknown, path = ''): string[] {
  if (!value || typeof value !== 'object') return [];
  const found: string[] = [];
  for (const [key, item] of Object.entries(value)) {
    if (['culpritId', 'mystery', 'mysterySeed', 'privateMystery', 'privateState', 'confirmedFace'].includes(key)) found.push(`${path}.${key}`);
    found.push(...privateKeys(item, `${path}.${key}`));
  }
  return found;
}
function observePacket(peer: Peer, type: string, packet: unknown) {
  peer.packetCount++; const leaked = privateKeys(packet); if (leaked.length) peer.errors.push(`${type} exposed private keys: ${leaked.join(', ')}`);
}
async function connect(identity: Identity, delta: boolean): Promise<Peer> {
  const joined = await request(`/homes/${homeId}/join`, identity, { pin: '123456' }); expect(joined.response.status).toBe(200);
  const admitted = await request(`/homes/${homeId}/ticket`, identity, {}); expect(admitted.response.status).toBe(200);
  const room = await new Client(base.replace('http:', 'ws:')).joinOrCreate('party', { homeId, ticket: admitted.data.ticket });
  const peer: Peer = { room, identity, legacyFrames: 0, fullFrames: 0, deltaFrames: 0, accepted: 0, packetCount: 0, dropNextDelta: false,
    resyncRequests: 0, storyPackets: 0, chats: [], notices: [], errors: [], inputSeq: 0, left: false, receivedKinds: [] };
  peers.push(peer);
  room.onMessage('snapshot', (snapshot: RoomSnapshot) => { observePacket(peer, 'snapshot', snapshot); peer.snapshot = snapshot; peer.legacyFrames++; });
  room.onMessage('snapshot.delta', (frame: SnapshotFrame<RoomSnapshot>) => {
    observePacket(peer, 'snapshot.delta', frame);
    if (frame.kind === 'full') peer.fullFrames++; else peer.deltaFrames++;
    peer.receivedKinds.push({ kind: frame.kind, seq: frame.seq, ...(frame.kind === 'full' ? { worldId: frame.snapshot.worldId } : {}) });
    if (peer.receivedKinds.length > 300) peer.receivedKinds.shift();
    if (peer.dropNextDelta && frame.kind === 'delta') { peer.dropNextDelta = false; peer.droppedSeq = frame.seq; return; }
    const result = applySnapshotFrame(peer.state, frame, peer.snapshot?.epoch);
    if (!result.ok) {
      peer.failedBase = result.reason;
      if (peer.resyncRequests === 0) { peer.resyncRequests++; room.send('snapshot.resync', { v: 1 }); }
      return;
    }
    if (result.applied) { peer.state = result.state; peer.snapshot = result.state.snapshot; peer.accepted++;
      if (peer.failedBase && frame.kind === 'full') peer.recoveredSeq = frame.seq; }
  });
  room.onMessage('story.snapshot', (story: ForestStorySnapshot) => { observePacket(peer, 'story.snapshot', story); peer.story = story; peer.storyPackets++; });
  room.onMessage('chat', (chat: ChatMessage) => { observePacket(peer, 'chat', chat); peer.chats.push(chat); });
  room.onMessage('notice', (notice: ServerNotice) => { observePacket(peer, 'notice', notice); peer.notices.push(notice); });
  for (const type of ['welcome', 'transition', 'world.sound', 'effect', 'board.changed']) room.onMessage(type, value => observePacket(peer, type, value));
  room.onMessage('*', (type, value) => observePacket(peer, String(type), value));
  room.onLeave(() => { peer.left = true; });
  await until(() => peer.snapshot, 'Missing initial legacy snapshot.');
  if (delta) { room.send('snapshot.delta-ready', { v: 1 }); await until(() => peer.state, 'Missing first opted-in full snapshot.'); }
  return peer;
}
function self(peer: Peer): PlayerState { return peer.snapshot!.players.find(p => p.id === peer.identity.id)!; }
function action(peer: Peer, command: Record<string, unknown>) {
  const player = self(peer); peer.room.send('command', { ...command, commandId: randomUUID(), worldRevision: peer.snapshot!.worldRevision,
    lifeRevision: player.respawnCount ?? 0, zoneRevision: player.zoneRevision ?? 0 });
}
async function walk(peer: Peer, goal: { x: number; y: number }, timeout = 5000, transitionTo?: string) {
  const start = Date.now();
  try {
    while (peer.snapshot?.worldId !== transitionTo && distance(self(peer), goal) > .15) {
      if (Date.now() - start > timeout) throw new Error('Real authoritative input did not reach its goal.');
      const p = self(peer), d = distance(p, goal), gain = Math.min(1, d * 2.4);
      const command: ClientCommand = { type: 'input', worldRevision: peer.snapshot!.worldRevision, lifeRevision: p.respawnCount ?? 0, zoneRevision: p.zoneRevision ?? 0,
        input: { seq: ++peer.inputSeq, axisX: (goal.x - p.x) / d * gain, axisY: (goal.y - p.y) / d * gain, jump: false } };
      peer.room.send('command', command); await pause(40);
    }
  } finally { peer.room.send('command', { type: 'input.stop' }); }
}
async function exactCaptured(peer: Peer) {
  const snapshot = peer.snapshot!, seq = peer.state ? String(peer.state.seq) : `legacy:${snapshot.serverTime}`;
  const expected = await inspect<RoomSnapshot>('capture', { userId: peer.identity.id, seq });
  expect(snapshot).toStrictEqual(expected);
}

describe('real forest delta transport and authority', () => {
  beforeAll(async () => {
    child = fork(fileURLToPath(new URL('./forest-delta-server.ts', import.meta.url)), [], { execArgv: ['--expose-gc', '--import', 'tsx'], serialization: 'advanced', stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    child.stdout?.on('data', chunk => { serverLog = (serverLog + String(chunk)).slice(-12000); });
    child.stderr?.on('data', chunk => { serverLog = (serverLog + String(chunk)).slice(-12000); });
    const ready = new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Ephemeral server startup timed out: ${serverLog}`)), 10000);
      child!.on('message', raw => {
        const message = raw as { type?: string; port?: number; requestId?: number; result?: unknown; error?: string };
        if (message.type === 'ready') { clearTimeout(timeout); resolve(message.port!); }
        if (message.requestId !== undefined) { const request = pending.get(message.requestId); if (request) { clearTimeout(request.timer); pending.delete(message.requestId); if (message.error) request.reject(new Error(message.error)); else request.resolve(message.result); } }
      });
      child!.on('exit', code => { clearTimeout(timeout); if (!base) reject(new Error(`Ephemeral server exited ${code}: ${serverLog}`)); });
    });
    base = `http://127.0.0.1:${await ready}`;
    expect((await fetch(base + '/ready')).status).toBe(200);
  }, 15000);
  afterAll(async () => {
    await Promise.all(peers.filter(p => !p.left).map(p => p.room.leave().catch(() => {})));
    if (child?.connected) await inspect('shutdown').catch(() => {});
    if (child && child.exitCode === null) child.kill('SIGTERM');
    for (const request of pending.values()) clearTimeout(request.timer); pending.clear();
  });

  it('preserves eight spread humans across legacy/deltas, real actions, scope transitions and missed-base recovery', async () => {
    const identities: Identity[] = [];
    for (let at = 0; at < 8; at++) {
      const { response, data } = await request('/identity', undefined, { name: `Forest socket ${at + 1}` }); expect(response.status).toBe(201);
      identities.push({ id: data.profile.id, cookie: response.headers.get('set-cookie')!.split(';')[0]! });
    }
    const created = await request('/homes', identities[0], { name: 'Isolated forest delta transport', pin: '123456' }); expect(created.response.status).toBe(201);
    homeId = created.data.home.id;
    for (let at = 0; at < 8; at++) await connect(identities[at]!, at < 7);
    const legacy = peers[7]!, speaker = peers[0]!, visitor = peers[1]!, mover = peers[2]!;
    const setup = await inspect<{ positions: { x: number; y: number }[]; movementGoal: { x: number; y: number }; interiorId: string; exit: { x: number; y: number }; npcs: number; privateMysteryExists: boolean }>('place', { ids: identities.map(p => p.id) });
    expect(setup.npcs).toBe(32); expect(setup.privateMysteryExists).toBe(true);
    await until(() => peers.every((p, at) => p.snapshot?.members?.length === 8 && distance(self(p), setup.positions[at]!) < .1), 'Spread placement did not arrive at all clients.');
    expect(Math.max(...setup.positions.flatMap(a => setup.positions.map(b => distance(a, b))))).toBeGreaterThan(90);
    expect(peers.every(p => p.snapshot!.climate && p.snapshot!.survival)).toBe(true);
    expect(new Set(peers.map(p => p.snapshot!.npcs?.map(n => n.id).join(','))).size).toBeGreaterThan(1);

    action(speaker, { type: 'npc.interact', npcId: 'npc:wizard-orin-vale' });
    await until(() => speaker.snapshot?.npcs?.find(n => n.id === 'npc:wizard-orin-vale')?.dialogue?.text, 'Accepted NPC talk did not reach the reconstructed snapshot.');
    await until(() => peers.every(p => p.story?.story.chapter === 'wards'), 'Shared accepted story discovery did not reach all peers.');
    const readCount = speaker.storyPackets; action(speaker, { type: 'story.read' });
    await until(() => speaker.storyPackets > readCount, 'story.read did not return a private-safe story view.');
    expect(Object.keys(speaker.story!).sort()).toEqual(['personal', 'story']);

    const beforeMove = { ...self(mover) }; await walk(mover, setup.movementGoal);
    expect(distance(beforeMove, self(mover))).toBeGreaterThan(.65);
    await until(() => peers.every(p => distance(p.snapshot!.members!.find(m => m.id === mover.identity.id)!, setup.movementGoal) < .2), 'Far clients lost authoritative human/minimap movement.');
    await Promise.all(peers.map(exactCaptured));

    const entrySeq = visitor.state!.seq; action(visitor, { type: 'interior.enter', interiorId: setup.interiorId });
    await until(() => visitor.snapshot?.worldId === setup.interiorId, 'Accepted interior entry did not transition the delta client.');
    expect(visitor.receivedKinds.some(f => f.seq > entrySeq && f.kind === 'full' && f.worldId === setup.interiorId)).toBe(true);
    expect(visitor.snapshot!.members).toHaveLength(8); expect(visitor.snapshot!.players.map(p => p.id)).toEqual([visitor.identity.id]);
    expect(visitor.snapshot!.npcs).toBeUndefined();
    await until(() => peers.filter(p => p !== visitor).every(p => p.snapshot!.players.length === 7 && p.snapshot!.members?.length === 8), 'Outdoor scope did not preserve roster while excluding interior actors.');
    await exactCaptured(visitor);
    const exitSeq = visitor.state!.seq;
    // The real doorway completes the exit after its cooldown; no delayed
    // synthetic exit command should be needed once the walk reaches it.
    await walk(visitor, setup.exit, 5000, 'forest');
    await until(() => visitor.snapshot?.worldId === 'forest' && peers.every(p => p.snapshot?.players.length === 8), 'Real interior exit did not restore shared outdoor snapshots.');
    expect(visitor.receivedKinds.some(f => f.seq > exitSeq && f.kind === 'full' && f.worldId === 'forest')).toBe(true);

    const chatId = randomUUID(); speaker.room.send('command', { type: 'chat.send', commandId: chatId, text: 'The same forest reaches every window.' });
    await until(() => peers.every(p => p.chats.some(m => m.commandId === chatId) && p.snapshot?.chat.some(m => m.commandId === chatId)), 'Reliable chat and reconstructed snapshot chat diverged.');
    const storyCounts = peers.map(p => p.storyPackets), fullBefore = speaker.fullFrames;
    await until(() => speaker.fullFrames > fullBefore, 'Periodic full recovery frame did not arrive.', 3000);
    expect(peers.map(p => p.storyPackets)).toEqual(storyCounts); // story is not resent at 20 Hz
    const legacyBefore = legacy.legacyFrames; legacy.room.send('snapshot.delta-ready', { v: 2 });
    legacy.room.send('snapshot.delta-ready', { v: 1, extra: true }); await pause(150);
    expect(legacy.legacyFrames).toBeGreaterThan(legacyBefore); expect(legacy.deltaFrames + legacy.fullFrames).toBe(0);

    // Drop one real received delta immediately after a periodic full, so the next
    // missing-base rejection and fast full must use the actual resync request.
    speaker.dropNextDelta = true;
    await until(() => !!speaker.droppedSeq, 'The requested delta was not dropped.');
    await until(() => speaker.failedBase === 'missing-base', 'A missing base was accepted.');
    await until(() => speaker.recoveredSeq && speaker.recoveredSeq > speaker.droppedSeq!, 'Real snapshot.resync did not deliver a healing full.', 1000);
    expect(speaker.resyncRequests).toBe(1);
    const resumedSeq = speaker.state!.seq; await until(() => speaker.state!.seq > resumedSeq, 'Delta stream did not continue after healing.');
    await Promise.all(peers.map(exactCaptured));
    expect(peers.flatMap(p => p.errors)).toEqual([]);
    expect(peers.flatMap(p => p.notices).filter(n => ['INVALID_COMMAND', 'STORY_STALE', 'INTERIOR_STALE', 'NPC_STALE', 'NPC_UNAVAILABLE', 'STORY_SAVE_FAILED'].includes(n.code))).toEqual([]);
    expect(peers.slice(0, 7).every(p => p.deltaFrames > 20 && p.fullFrames >= 2)).toBe(true);

    const memory = await inspect<Record<string, unknown>>('memory');
    const report = { kind: 'actual-http-colyseus-forest-delta', at: new Date().toISOString(), identities: 8, npcCount: setup.npcs,
      onlyDirectGameplayFixture: 'One initial placement of eight already admitted humans; all tested actions used real socket commands.',
      allPacketsPrivacyChecked: peers.reduce((sum, p) => sum + p.packetCount, 0), acceptedDeltaSnapshots: peers.reduce((sum, p) => sum + p.accepted, 0),
      legacySnapshots: legacy.legacyFrames, resyncRequests: speaker.resyncRequests, droppedSeq: speaker.droppedSeq, healedSeq: speaker.recoveredSeq,
      coverage: ['HTTP identity/home/PIN/ticket', '7 delta + 1 legacy sockets', '8 far-apart humans', 'recipient NPC interest', 'authoritative input', 'NPC dialogue', 'shared story/read', 'interior enter/exit', 'human roster/minimap', 'chat', 'periodic full', 'malformed opt-in', 'missed delta/resync', 'exact server DTO comparison', 'no private culprit fields'], serverMemory: memory };
    if (process.env.FOREST_DELTA_REPORT) writeFileSync(process.env.FOREST_DELTA_REPORT, JSON.stringify(report, null, 2) + '\n');
    console.info('Forest delta network proof:', JSON.stringify(report));
  }, 30000);
});
