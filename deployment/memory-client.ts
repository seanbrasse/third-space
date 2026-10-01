/** Run outside the measured server cgroup. Only synthetic fixtures are accepted. */
import { Client, type Room } from "@colyseus/sdk";
import { readFileSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import assert from "node:assert/strict";
import type { RoomSnapshot } from "../packages/contracts/src/index.ts";
const endpoint = process.env.LOAD_ENDPOINT || "http://127.0.0.1:2588";
const origin = "http://third-space-load.invalid";
const fixtures = JSON.parse(readFileSync(process.argv[2]!, "utf8")) as Array<{ homeId: string; members: Array<{ id: string; cookie: string }> }>;
const phaseSeconds = (process.env.LOAD_PHASE_SECONDS || "600,120,120").split(",").map(Number);
assert(phaseSeconds.length === 3 && phaseSeconds.every(x => Number.isFinite(x) && x >= 5));
const started = performance.now();
const phases: any[] = [];
const peers: Peer[] = [];
let stopping = false;
let expectedDisconnects = 0, reconnects = 0, boardWrites = 0, mediaActions = 0, chatSends = 0, inputPackets = 0, pinJoins = 0;
let forestCaughtEvents = 0;
const failures: string[] = [];
type Peer = { group: number; index: number; id: string; cookie: string; room: Room; snapshot?: RoomSnapshot; lastAt: number; snapshots: number; gaps: number[]; rtts: number[]; pings: Map<number, number>; seq: number; paused: boolean; changing: boolean; positions: Set<string>; chat: number; };
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const percentile = (v: number[], p: number) => { const s = [...v].sort((a,b) => a-b); return s[Math.min(s.length-1, Math.floor(s.length*p))] ?? 0; };
const maximum = (values: number[]) => values.reduce((max, value) => Math.max(max, value), 0);
async function api(path: string, cookie: string, method = "GET", body?: unknown) {
  const response = await fetch(endpoint + path, { method, headers: { origin, cookie, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await response.json() as any;
  assert(response.ok, `HTTP ${method} ${path}: ${response.status} ${JSON.stringify(data.error)}`);
  return data;
}
function attach(peer: Peer, room: Room) {
  peer.room = room;
  peer.snapshot = undefined;
  peer.lastAt = performance.now();
  room.onMessage("welcome", () => {});
  room.onMessage("snapshot", (snapshot: RoomSnapshot) => {
    const now = performance.now();
    if (!peer.changing && peer.snapshots) peer.gaps.push(now-peer.lastAt);
    peer.lastAt = now;
    peer.snapshots++;
    peer.snapshot = snapshot;
    const self = snapshot.players.find(p => p.id === peer.id);
    if (!self || !Number.isFinite(self.x) || !Number.isFinite(self.y)) failures.push("Invalid authoritative position");
    else {
      peer.positions.add(`${self.x.toFixed(1)}:${self.y.toFixed(1)}`);
      if (peer.positions.size > 5000) peer.positions.clear();
    }
  });
  room.onMessage("connection.pong", (id: number) => {
    const at = peer.pings.get(id);
    if (at !== undefined) { peer.rtts.push(performance.now()-at); peer.pings.delete(id); }
  });
  room.onMessage("chat", () => peer.chat++);
  for (const type of ["board.changed", "effect", "transition", "race.result", "world.sound"]) room.onMessage(type, () => {});
  room.onMessage("notice", n => {
    if (n.code === "FOREST_CAUGHT") { forestCaughtEvents++; return; }
    failures.push(`Unexpected notice ${JSON.stringify(n)}`);
  });
  room.onError((code, message) => failures.push(`Transport ${code}: ${message}`));
  room.onLeave(code => { if (!stopping && !peer.changing) failures.push(`Unexpected leave ${code}`); });
}
async function connectGroup(group: number) {
  const fixture = fixtures[group]!;
  for (let index=0; index<fixture.members.length; index++) {
    const member = fixture.members[index]!;
    if (index > 0) { await api(`/api/homes/${fixture.homeId}/join`, member.cookie, "POST", { pin: "123456" }); pinJoins++; }
    const ticket = await api(`/api/homes/${fixture.homeId}/ticket`, member.cookie, "POST", {});
    const room = await new Client(endpoint).joinOrCreate("party", ticket);
    const peer: Peer = { group, index, ...member, room, lastAt: 0, snapshots: 0, gaps: [], rtts: [], pings: new Map(), seq: 0, paused: false, changing: false, positions: new Set(), chat: 0 };
    attach(peer, room);
    peers.push(peer);
  }
  assert.equal(new Set(peers.filter(p => p.group === group).map(p => p.room.roomId)).size, 1);
}
async function until(fn: () => boolean, message: string, ms=4000) {
  const from = performance.now();
  while (!fn() && performance.now()-from < ms) await sleep(25);
  assert(fn(), message);
}
async function reconnect(peer: Peer) {
  peer.changing = peer.paused = true;
  const token = peer.room.reconnectionToken;
  peer.room.reconnection.enabled = false;
  peer.room.connection.close();
  expectedDisconnects++;
  await sleep(500);
  attach(peer, await new Client(endpoint).reconnect(token));
  await until(() => peer.snapshot?.players.find(p => p.id === peer.id)?.connected === true, "Reconnect failed");
  peer.changing = peer.paused = false;
  reconnects++;
}
const intervals: ReturnType<typeof setInterval>[] = [];
try {
  await connectGroup(0);
  let pingId = 0;
  intervals.push(setInterval(() => {
    for (const p of peers) {
      if (p.paused) continue;
      p.seq++;
      const direction = (Math.floor(p.seq/60) + p.index) % 4;
      p.room.send("command", { type: "input", input: { seq: p.seq, axisX: direction === 0 ? 1 : direction === 2 ? -1 : 0, axisY: direction === 1 ? 1 : direction === 3 ? -1 : 0, jump: p.seq % 90 === 0 } });
      inputPackets++;
    }
  }, 1000/30));
  intervals.push(setInterval(() => {
    pingId++;
    for (const p of peers) if (!p.paused) { p.pings.set(pingId, performance.now()); p.room.send("connection.ping", pingId); }
  }, 1100));
  let chatRound = 0;
  intervals.push(setInterval(() => {
    chatRound++;
    for (const p of peers) if (!p.paused) { p.room.send("command", { type: "chat.send", commandId: `load-${p.group}-${p.index}-${chatRound}`, text: `Synthetic chat ${chatRound}` }); chatSends++; }
  }, 10100));
  const notes = new Map<number, any>();
  for (let phase=0; phase<3; phase++) {
    const targetGroups = [1,4,8][phase]!;
    while (peers.length < targetGroups*8) await connectGroup(peers.length/8);
    await until(() => peers.every(p => p.snapshot?.players.filter(x => x.connected).length === 8), "All eight players must be present in every room");
    const counts = peers.map(p => p.snapshots);
    const gapOffsets = peers.map(p => p.gaps.length);
    const rttOffsets = peers.map(p => p.rtts.length);
    const phaseStarted = performance.now();
    let nextWork = 0, nextReconnect = 30000;
    const phaseStartTimestamp = Date.now();
    console.log(JSON.stringify({ kind: "phase-start", timestamp: phaseStartTimestamp, phase: phase+1, rooms: targetGroups, players: peers.length, seconds: phaseSeconds[phase], elapsedMs: Math.round(phaseStarted-started) }));
    while (performance.now()-phaseStarted < phaseSeconds[phase]!*1000) {
      const elapsed = performance.now()-phaseStarted;
      if (elapsed >= nextWork) {
        for (const owner of peers.filter(p => p.index === 0)) {
          const homeId = fixtures[owner.group]!.homeId;
          let note = notes.get(owner.group);
          if (!note) note = (await api(`/api/homes/${homeId}/board`, owner.cookie, "POST", { requestId: `load-${owner.group}`, text: "Synthetic benchmark note", x: 0.5, y: 0.5 })).note;
          else note = (await api(`/api/homes/${homeId}/board/${note.id}`, owner.cookie, "PATCH", { expectedRevision: note.revision, text: `Synthetic note update ${Math.round(elapsed)}` })).note;
          notes.set(owner.group, note); boardWrites++;
          const revision = owner.snapshot!.media.revision;
          const source = !owner.snapshot!.media.url;
          owner.room.send("command", { type: "media.control", commandId: `media-${owner.group}-${phase}-${Math.round(elapsed)}`, revision, action: source ? "source" : owner.snapshot!.media.playing ? "pause" : "play", ...(source ? { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" } : {}) });
          mediaActions++;
          await until(() => peers.filter(p => p.group === owner.group).every(p => p.snapshot!.media.revision === revision+1), "Shared media authority failed");
        }
        nextWork = elapsed+5000;
      }
      if (elapsed >= nextReconnect) {
        for (const group of Array.from({length: targetGroups}, (_, i) => i)) await reconnect(peers.find(p => p.group === group && p.index === 7)!);
        nextReconnect = elapsed+60000;
      }
      for (const p of peers) {
        assert(performance.now()-p.lastAt < 1000, "Snapshot stream stalled");
        assert.equal(p.snapshot!.players.filter(x => x.connected).length, 8, "Player presence failed");
      }
      assert.equal(failures.length, 0, failures.join("\n"));
      await sleep(200);
    }
    const measuredSeconds = (performance.now()-phaseStarted)/1000;
    const gaps = peers.flatMap((p,i) => p.gaps.slice(gapOffsets[i]));
    const rtts = peers.flatMap((p,i) => p.rtts.slice(rttOffsets[i]));
    const snapshotHz = peers.map((p,i) => (p.snapshots-counts[i]!)/measuredSeconds);
    assert(Math.min(...snapshotHz) >= 18, "Snapshot throughput below 18 Hz");
    for (const p of peers) { assert(p.positions.size >= 4, "No actual movement"); assert(p.snapshot!.players.find(x => x.id === p.id)!.lastInputSeq > 0, "No acknowledged input"); assert(p.chat > 0, "No chat delivery"); }
    const result = { startTimestamp: phaseStartTimestamp, endTimestamp: Date.now(), rooms: targetGroups, players: peers.length, durationSeconds: +measuredSeconds.toFixed(2), minSnapshotHz: +Math.min(...snapshotHz).toFixed(2), p95SnapshotGapMs: +percentile(gaps,.95).toFixed(2), p99SnapshotGapMs: +percentile(gaps,.99).toFixed(2), maxSnapshotGapMs: +maximum(gaps).toFixed(2), p95LocalPingRttMs: +percentile(rtts,.95).toFixed(2), p99LocalPingRttMs: +percentile(rtts,.99).toFixed(2) };
    phases.push(result);
    console.log(JSON.stringify({ kind: "phase-result", ...result }));
  }
  // Exercise repeated disposal/recreation, where per-room leaks can accumulate.
  for (let cycle=0; cycle<10; cycle++) {
    const lastGroup = peers.filter(p => p.group === 7);
    for (const p of lastGroup) p.changing = p.paused = true;
    await Promise.all(lastGroup.map(p => p.room.leave()));
    peers.splice(peers.length-8, 8);
    await sleep(300);
    await connectGroup(7);
    await until(() => peers.filter(p => p.group === 7).every(p => p.snapshot?.players.filter(x => x.connected).length === 8), "Room recreation failed");
  }
  for (const [group, note] of notes) {
    const owner = peers.find(p => p.group === group && p.index === 0)!;
    const board = await api(`/api/homes/${fixtures[group]!.homeId}/board`, owner.cookie);
    assert.equal(board.notes.length, 1);
    assert.equal(board.notes[0].revision, note.revision);
  }
  assert.equal(failures.length,0,failures.join("\n"));
  const report = { ok: true, testedBase: "cf0892500367212f4c62b39090e83228ccb546b0", elapsedSeconds: +( (performance.now()-started)/1000).toFixed(2), clientNode: process.version, phases, inputPackets, chatSends, boardWrites, mediaActions, pinJoins, expectedDisconnects, reconnects, forestCaughtEvents, roomRecreationCycles: 10, unexpectedErrors: failures.length, limitations: ["Local synthetic SDK clients; no WAN latency or browser/video/voice streams", "Benchmark adapter invokes unchanged createGameServer but binds a container-accessible address", "CPU quota is one dedicated local vCPU, not a Fly shared CPU performance guarantee", "Latest uncommitted campsite/playback changes are not included"] };
  writeFileSync(process.argv[3]!, JSON.stringify(report,null,2)+"\n");
  console.log(JSON.stringify({ kind: "complete", ...report }));
} finally {
  stopping = true;
  intervals.forEach(clearInterval);
  await Promise.allSettled(peers.map(p => p.room.leave()));
}
