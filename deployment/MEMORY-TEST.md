# 512 MiB capacity check

## Result — 2026-10-01

**512 MiB is adequate for an initial friends test on the verified baseline.**
The native Linux ARM64 eight-player case ran 600.02 seconds at a minimum
20.04 snapshots/second/client. Its sampled container peak was **111.23 MiB**
(155.11 MiB process RSS). The 32-player case also passed for 120.33 seconds.

A complete Linux amd64 run under local Rosetta translation passed 8/32/64-player
cases for 60/60/120 seconds, all at at least 20 snapshots/second/client. It sent
320,537 input packets, exercised 228 board writes and 228 shared-media updates,
completed all 21 scheduled reconnects and ten room-recreation cycles, and
reported no unexpected protocol/transport errors. Its kernel-recorded peak was
**356.33 MiB**, including translator overhead, leaving 155.67 MiB of headroom.
Memory limit/max/OOM counters stayed zero; both container states reported
`OOMKilled=false`. Saved identity sessions, eight board revisions and eight
fresh room admissions passed across an amd64 server restart on its volume.

The 64-player translated stress run had latency spikes (a 2.6-second maximum
snapshot gap, 1.29-second p99 local ping RTT). This supports the memory choice,
not a smooth 64-player capacity promise. Start with small friends testing,
validate native Fly timings, and repeat on the latest verified candidate.

The first native harness completed its 8/32-player cases and 64-player gameplay,
then its formatter hit JavaScript's argument-stack limit on a large sample
array. The formatter was fixed to reduce the maximum without argument spreading.
The complete subsequent amd64 run and churn checks passed. The native partial
run is explicitly marked as such in the sanitized [results](memory-results.json).
Plain QEMU amd64 emulation also failed in libuv during dependency installation;
the same unmodified Dockerfile built successfully under Rosetta.

Transient benchmark containers, volumes and local VMs are removed after the
checks. No cloud hosting resources, payment methods or persistent credentials
are created by this test.

The test invokes the unchanged `createGameServer` on the verified published
candidate `cf0892500367212f4c62b39090e83228ccb546b0`. A benchmark-only adapter binds
`0.0.0.0` inside the container because this candidate's production entrypoint
still binds loopback. No preview/source working trees are edited or restarted.

The measured container uses the deployment Dockerfile, Node 24.19.0, one vCPU
quota, a **512 MiB cgroup limit with swap disabled**, and a separate synthetic
SQLite volume. Clients run outside this cgroup. Sixty-four synthetic identities
and eight saved homes are prepared before gameplay. Clients obtain real room
tickets, join with PINs, and use real Colyseus SDK WebSocket connections.

Default workload:

- One full eight-player room for ten minutes.
- Four full rooms / 32 players for two minutes.
- Eight full rooms / 64 players for two minutes.
- Every connected player sends movement at approximately 30 Hz and chat every
  ten seconds. Clients check acknowledged movement and receive real snapshots.
- One owner per room writes a SQLite board note and updates shared media every
  five seconds. Every member must observe the media revision.
- One member per room drops/reconnects after 30 seconds and then each minute.
  Intentional network drops are excluded from snapshot-gap statistics.
- Ten cycles dispose and recreate the eighth room, followed by board revision
  checks. Normal forest-caught gameplay notices are counted separately.

Checks require no unexpected transport/protocol errors, fresh snapshot streams,
all eight players present in each room, at least 18 snapshots/second per client,
successful reconnects and writes, and no cgroup memory-limit/OOM events. Each
second records cgroup current/peak memory, process RSS/heap, CPU time and event
loop delay. Kernel peak includes startup and transient usage between samples.

## Reproduction

Use an isolated Docker context and fresh benchmark-only data volume. Keep test
ports bound to host loopback. The following assumes the chosen context already
exists; provisioning a local VM is separate from cloud hosting.

```sh
mkdir -p .data/memory-benchmark
docker --context CONTEXT build -t third-space-memory:cf089250 \
  -f deployment/Dockerfile.game-server .
docker --context CONTEXT create --name third-space-memory-server \
  --memory=512m --memory-swap=512m --cpus=1 \
  -p 127.0.0.1:2588:2567 -v third-space-memory-data:/data \
  -e WEB_ORIGIN=http://third-space-load.invalid \
  third-space-memory:cf089250 \
  node --import tsx /app/deployment/memory-server.ts
docker --context CONTEXT cp deployment/. third-space-memory-server:/app/deployment
docker --context CONTEXT start third-space-memory-server
# Wait for /ready before copying the fixture.
curl --fail http://127.0.0.1:2588/ready
docker --context CONTEXT cp third-space-memory-server:/data/fixture.json \
  .data/memory-benchmark/fixture.json
node --import tsx deployment/memory-client.ts \
  .data/memory-benchmark/fixture.json .data/memory-benchmark/client-report.json
docker --context CONTEXT logs third-space-memory-server \
  > .data/memory-benchmark/server.log
python3 deployment/summarize-memory.py \
  .data/memory-benchmark/client-report.json .data/memory-benchmark/server.log \
  .data/memory-benchmark/summary.json
```

Use Node 24 for the host client. An amd64 image may require BuildKit/buildx when
building from an ARM Mac. `LOAD_PHASE_SECONDS=60,60,120` allows a shorter second
architecture check. Stop/remove only the benchmark container and volume after
verification; retain sanitized reports, never the fixture credentials/database.

## Interpretation

This measures the backend, not browser rendering, WAN latency, provider video
playback or configured voice traffic. Media testing covers authoritative URL
and playback state; video bytes are not streamed through this game server.
Local dedicated CPU quota cannot guarantee Fly shared-CPU performance. An
emulated amd64 run is useful for memory compatibility, not a native CPU benchmark.
The uncommitted asylum/playback/queue/battery/movement build must be tested again
after the implementation lead supplies a verified candidate.
