/** Benchmark-only adapter. It does not replace the production entrypoint. */
import { createGameServer } from "../apps/game-server/src/server.ts";
import { writeFileSync, readFileSync } from "node:fs";
import { monitorEventLoopDelay } from "node:perf_hooks";
const origin = process.env.LOAD_ORIGIN || "https://third-space-load.invalid";
const { server, store } = createGameServer({ dataPath: "/data/load.sqlite", origins: [origin] });
const fixture = Array.from({ length: 8 }, (_, group) => {
  const identities = Array.from({ length: 8 }, (_, member) => store.createIdentity({ name: `Load ${group + 1}-${member + 1}` }));
  const home = store.createHome(identities[0]!.profile.id, { name: `Load room ${group + 1}`, pin: "123456" });
  return { homeId: home.id, members: identities.map(identity => ({ id: identity.profile.id, cookie: `ts_local=${identity.session}` })) };
});
// Synthetic, ephemeral fixture stays inside the benchmark environment; never commit it.
writeFileSync("/data/fixture.json", JSON.stringify(fixture), { mode: 0o600 });
const delay = monitorEventLoopDelay({ resolution: 10 });
delay.enable();
const cpuStart = process.cpuUsage();
const started = Date.now();
function cgroup(path: string) { try { return readFileSync(`/sys/fs/cgroup/${path}`, "utf8").trim(); } catch { return null; } }
const timer = setInterval(() => {
  console.log(JSON.stringify({ kind: "sample", timestamp: Date.now(), elapsedMs: Date.now() - started, memory: process.memoryUsage(), cpu: process.cpuUsage(cpuStart), eventLoopP99Ms: delay.percentile(99) / 1e6, eventLoopMaxMs: delay.max / 1e6, cgroupCurrent: cgroup("memory.current"), cgroupPeak: cgroup("memory.peak"), cgroupMax: cgroup("memory.max"), cgroupSwapMax: cgroup("memory.swap.max"), cgroupEvents: cgroup("memory.events"), cpuMax: cgroup("cpu.max"), cpuStat: cgroup("cpu.stat") }));
  delay.reset();
}, 1000);
await server.listen(2567, "0.0.0.0");
console.log(JSON.stringify({ kind: "ready", node: process.version, platform: process.platform, arch: process.arch }));
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  await server.gracefullyShutdown(false);
  store.close();
  process.exit(0);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
