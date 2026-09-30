/** Eight real SDK connections plus HTTP board traffic against an isolated local server.
 * pnpm test:load                       # 30 seconds
 * pnpm test:load -- --minutes 30       # 30-minute soak
 * The temporary database is removed; .data/load-report.json contains measurements.
 */
import { Client, type Room } from "@colyseus/sdk";
import { GAME_CONFIG } from "../packages/config/src/index";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import assert from "node:assert/strict";
import { createGameServer } from "../apps/game-server/src/server";
import type {
  RoomSnapshot,
  ServerNotice,
  ChatMessage,
} from "../packages/contracts/src/index";

const args = process.argv.slice(2).filter((a) => a !== "--");
const value = (flag: string) => {
  const i = args.indexOf(flag);
  return i >= 0 ? Number(args[i + 1]) : undefined;
};
const seconds = value("--seconds") ?? (value("--minutes") ?? 0.5) * 60;
assert(
  Number.isFinite(seconds) && seconds >= 5 && seconds <= 86400,
  "Duration must be 5 seconds to 24 hours.",
);
const durationMs = seconds * 1000;
const playerCount = GAME_CONFIG.partyCapacity;
const dir = mkdtempSync(join(tmpdir(), "third-space-soak-"));
const origin = "http://localhost:3000";
const { server, httpServer, store } = createGameServer({
  dataPath: join(dir, "load.sqlite"),
  origins: [origin],
});
const rooms: Room[] = [];
const metrics = Array.from({ length: playerCount }, () => ({
  snapshots: 0,
  chat: 0,
  lastSnapshot: 0,
  gaps: [] as number[],
  lastInputSeq: 0,
  positions: new Set<string>(),
  last: undefined as RoomSnapshot | undefined,
}));
const notices: ServerNotice[] = [];
const errors: string[] = [];
const memory: Array<{
  elapsedMs: number;
  heapBytes: number;
  rssBytes: number;
}> = [];
const timers: ReturnType<typeof setInterval>[] = [];
const started = performance.now();
let boardWrites = 0,
  inputPackets = 0,
  chatSends = 0;
function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
function percentile(values: number[], p: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return (
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0
  );
}
try {
  await server.listen(0, "127.0.0.1");
  const address = httpServer.address() as { port: number };
  const endpoint = `http://127.0.0.1:${address.port}`;
  const profiles = Array.from({ length: playerCount }, (_, i) =>
    store.createIdentity({ name: `Soak player ${i + 1}` }),
  );
  const home = store.createHome(profiles[0]!.profile.id, {
    name: "Eight-player soak",
    pin: "123456",
  });
  for (const identity of profiles.slice(1))
    store.joinHome(home.id, identity.profile.id, { pin: "123456" });
  for (let i = 0; i < playerCount; i++) {
    const sdk = new Client(endpoint);
    const room = await sdk.joinOrCreate(
      "party",
      store.issueTicket(home.id, profiles[i]!.profile.id),
    );
    rooms.push(room);
    room.onMessage("welcome", () => {});
    room.onMessage("snapshot", (snapshot: RoomSnapshot) => {
      const now = performance.now();
      const m = metrics[i]!;
      if (m.lastSnapshot) m.gaps.push(now - m.lastSnapshot);
      if (m.gaps.length > 10000) m.gaps.splice(0, 5000);
      m.lastSnapshot = now;
      m.snapshots++;
      m.last = snapshot;
      const self = snapshot.players.find(
        (p) => p.id === profiles[i]!.profile.id,
      );
      if (!self)
        return errors.push(`Player ${i + 1} disappeared from its snapshot.`);
      if (!Number.isFinite(self.x) || !Number.isFinite(self.y))
        errors.push(`Non-finite position for player ${i + 1}.`);
      m.lastInputSeq = self.lastInputSeq;
      m.positions.add(`${self.x.toFixed(1)}:${self.y.toFixed(1)}`);
      if (m.positions.size > 1000) m.positions.clear();
    });
    room.onMessage("chat", (_message: ChatMessage) => {
      metrics[i]!.chat++;
    });
    room.onMessage("notice", (notice: ServerNotice) => {
      notices.push(notice);
    });
    room.onMessage("board.changed", () => {});
    room.onError((code, message) =>
      errors.push(`Client ${i + 1} transport ${code}: ${message}`),
    );
    room.onLeave((code) => {
      if (performance.now() - started < durationMs)
        errors.push(`Player ${i + 1} left early (${code}).`);
    });
  }
  assert.equal(
    new Set(rooms.map((r) => r.roomId)).size,
    1,
    "All players must share the singleton party.",
  );
  let inputSeq = 0,
    chatSeq = 0;
  timers.push(
    setInterval(() => {
      inputSeq++;
      const phase = Math.floor(inputSeq / 60) % 4;
      for (let i = 0; i < playerCount; i++) {
        const rotated = (phase + i) % 4;
        rooms[i]!.send("command", {
          type: "input",
          input: {
            seq: inputSeq,
            axisX: rotated === 0 ? 1 : rotated === 2 ? -1 : 0,
            axisY: rotated === 1 ? 1 : rotated === 3 ? -1 : 0,
            jump: false,
          },
        });
        inputPackets++;
      }
    }, 1000 / 30),
  );
  const sendChats = () => {
    chatSeq++;
    for (let i = 0; i < playerCount; i++) {
      rooms[i]!.send("command", {
        type: "chat.send",
        commandId: `soak-${i}-${chatSeq}`,
        text: `Round ${chatSeq} from player ${i + 1}`,
      });
      chatSends++;
    }
  };
  sendChats();
  timers.push(setInterval(sendChats, 10100));
  const notes = profiles.map((p, i) =>
    store.createNote(home.id, p.profile.id, {
      requestId: `initial-${i}`,
      text: `Soak note ${i + 1}`,
      x: i / (playerCount - 1),
      y: 0.5,
    }),
  );
  const wallStarted = performance.now();
  let lastBoard = 0;
  console.log(
    `${playerCount} SDK players connected; exercising authoritative input, chat and persistent board for ${seconds}s.`,
  );
  while (performance.now() - wallStarted < durationMs) {
    await sleep(Math.min(1000, durationMs - (performance.now() - wallStarted)));
    const elapsed = performance.now() - wallStarted;
    const use = process.memoryUsage();
    memory.push({
      elapsedMs: Math.round(elapsed),
      heapBytes: use.heapUsed,
      rssBytes: use.rss,
    });
    if (elapsed - lastBoard >= 5000) {
      for (let i = 0; i < playerCount; i++) {
        const response = await fetch(
          `${endpoint}/api/homes/${home.id}/board/${notes[i]!.id}`,
          {
            method: "PATCH",
            headers: {
              origin,
              "content-type": "application/json",
              cookie: `ts_local=${profiles[i]!.session}`,
            },
            body: JSON.stringify({
              expectedRevision: notes[i]!.revision,
              text: `Updated at ${Math.floor(elapsed / 1000)} seconds by ${i + 1}`,
            }),
          },
        );
        assert.equal(
          response.status,
          200,
          "Authorized board writes must remain healthy.",
        );
        const body = (await response.json()) as {
          note: (typeof notes)[number];
        };
        notes[i] = body.note;
        boardWrites++;
      }
      lastBoard = elapsed;
    }
    for (let i = 0; i < playerCount; i++) {
      const m = metrics[i]!;
      if (elapsed > 2000) {
        assert(m.last, "Every connected player receives snapshots.");
        assert.equal(
          m.last.players.filter((p) => p.connected).length,
          playerCount,
          "All eight players remain present.",
        );
        assert(
          performance.now() - m.lastSnapshot < 1000,
          "Snapshot stream became stale.",
        );
      }
    }
    assert.equal(errors.length, 0, errors.join("\n"));
    assert.equal(notices.length, 0, JSON.stringify(notices));
  }
  const measuredMs = performance.now() - wallStarted;
  for (let i = 0; i < playerCount; i++) {
    const m = metrics[i]!;
    assert(
      m.snapshots >= seconds * 10,
      "State broadcast rate fell below 10 snapshots/second.",
    );
    assert(
      m.chat >= chatSends,
      "Each client must receive every accepted instance chat message.",
    );
    assert(
      m.lastInputSeq > 0,
      "The server must acknowledge authoritative input.",
    );
    assert(m.positions.size >= 4, "Input must produce actual world movement.");
  }
  assert.equal(
    store.getBoard(home.id).length,
    playerCount,
    "Board writes must not duplicate notes.",
  );
  const report = {
    ok: true,
    environment: `isolated local server, ${playerCount} Node SDK clients, no artificial latency; no browser/media proof`,
    node: process.version,
    durationMs: Math.round(measuredMs),
    clients: metrics.map((m, i) => ({
      player: i + 1,
      snapshots: m.snapshots,
      snapshotHz: +(m.snapshots / (measuredMs / 1000)).toFixed(2),
      p95GapMs: +percentile(m.gaps, 0.95).toFixed(2),
      maxGapMs: +Math.max(...m.gaps).toFixed(2),
      chatReceived: m.chat,
      lastInputSeq: m.lastInputSeq,
    })),
    inputPackets,
    chatSends,
    boardWrites,
    noticeCount: notices.length,
    errorCount: errors.length,
    memory: {
      first: memory[0],
      last: memory.at(-1),
      maxHeapBytes: Math.max(...memory.map((m) => m.heapBytes)),
      maxRssBytes: Math.max(...memory.map((m) => m.rssBytes)),
    },
  };
  mkdirSync(".data", { recursive: true });
  writeFileSync(
    ".data/load-report.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  timers.forEach(clearInterval);
  await Promise.allSettled(rooms.map((r) => r.leave()));
  await server.gracefullyShutdown(false);
  store.close();
  rmSync(dir, { recursive: true, force: true });
}
