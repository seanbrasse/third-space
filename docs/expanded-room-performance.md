# Expanded room performance harness

`tests/bench/expanded-room-benchmark.ts` runs an isolated, actual `PartyRoom` with eight admitted human identities, authoritative command parsing, 25 NPCs, the three forest monsters, survival, and snapshots. It uses an in-memory SQLite database and no sockets, listening ports, production defaults, credentials, or user data. `--mode fixture` supplies the expanded map and NPC/monster controllers on that room instance only; `--mode integrated` requires the real configured map and actor population and removes those overrides.

```sh
node --expose-gc --import tsx tests/bench/expanded-room-benchmark.ts --seconds 300 --warmup 15 --scenario both --out /tmp/expanded-room.json
node --expose-gc --import tsx tests/bench/expanded-room-benchmark.ts --mode integrated --seconds 300 --scenario spread --out /tmp/expanded-room-integrated.json
```

Use Node 24. The default is an accelerated, deterministic simulation clock: 60 simulation ticks/s, eight input streams at 30 Hz, snapshots at 20 Hz, plus event-triggered snapshots. `--pace` adds real-time pacing. `--seed` controls the fixture NPC and monster random source. Database-generated IDs differ between runs and can affect encounter selection. The report fingerprints the exact source files because development may continue between runs.

The spread scenario keeps eight players around distant building/forest anchors, allows catches and normal respawns, and continues routing caught players back across the map. The cluster scenario keeps the eight humans near camp. Client-equivalent click path planning is timed separately from server frame CPU. Both scenarios simulate every NPC, including actors outside every recipient's interest window. NPC work and path bounds are asserted during the run.

## Recorded 2026-10-01 fixture run

Five measured minutes per scenario after 15 seconds of warmup, Node 24, 144×112 tiles, eight humans, 25 NPCs. Raw report: `expanded-room-msgpack-profile.json` in the parent task directory. These are development-machine measurements, not a production capacity or browser frame-rate claim.

| Metric | Eight spread | Eight at camp |
| --- | ---: | ---: |
| Simulation tick p50 / p95 / p99, ms | 0.219 / 0.428 / 0.817 | 0.185 / 0.325 / 0.613 |
| Complete measured frame CPU p99 / max, ms | 1.644 / 7.446 | 1.173 / 3.681 |
| Eight-client snapshot batch p99, ms | 1.150 | 0.696 |
| Mean actual Colyseus snapshot frame, bytes/client | 14,748 | 10,497 |
| Eight clients ×20 Hz, actual frame bytes/s | 2,359,617 | 1,679,497 |
| Mean JSON diagnostic bytes/client | 19,136 | 13,580 |
| Sampled peak RSS, MiB | 321.30 | 330.14 |
| Retained heap growth after GC, MiB | 2.69 | 0.37 |
| Maximum aggregate NPC path points | 23 | 27 |

All 25 NPCs moved in both scenarios. In spread, the clown, mimic, and werewolf each became active; NPC updates never exceeded the one-search-per-update bound. Humans remained about 117 tiles apart on average, and about 7.9 of eight humans were outside the sanctuary on average. The entire room continued to simulate while recipient NPC snapshots were interest-filtered.

`transportFrames` uses the installed Colyseus `getMessageBytes.raw(ROOM_DATA, type, payload)` and therefore measures MessagePack plus Colyseus room message headers. It excludes WebSocket/TLS framing, compression, backpressure, and network delivery. `wireProjection` is a separate raw JSON diagnostic and must not be called actual network bandwidth. `snapshotBatchMs` includes the send sinks' real transport encoding. Memory includes instrumentation and in-memory SQLite, but excludes HTTP/socket services, production database traffic, the voice provider, Next.js, browser rendering, and container overhead. RSS is sampled, not a guaranteed high-water mark. Sequential scenarios share the process/JIT/allocator; do not infer a 512 MiB deployment is proven safe from these numbers.

## Field costs and first optimization

The additional 30-second field sample (`expanded-room-fields.json`) averaged 18,706 JSON bytes per spread-client snapshot. Values only are counted here; nested rows are subsets, not extra bytes to sum with their parent.

| Field | Mean JSON value bytes |
| --- | ---: |
| `members` | 4,788 |
| `players` | 4,788 |
| `npcs` | 5,329 |
| NPC static metadata projection | 3,794 |
| `survival` | 2,401 |
| `survival.players` | 1,444 |
| `survival.appleTrees` | 813 |
| `survival.backpacks` | 75 |
| `voiceScope` | 420 |
| `climate` | 233 |
| `race` | 110 |
| `chat` (empty in this scenario) | 2 |

Repeated player/member data is about half this sample; repeated NPC static metadata is the next largest target. A per-recipient delta stream can avoid repeating unchanged avatar, name, inventory, tree and NPC metadata while reconstructing the complete existing snapshot at the client. Preserve every human's roster and minimap position; interest filtering must never stop world authority. Preserve entity order, explicit removals, recipient scope, and fresh full snapshots after missed bases, reconnects, or epoch changes. Reliable story state belongs on join/change/read, not in the 20 Hz snapshot. Climate is small and does not justify the first optimization.

The harness retains bounded metric reservoirs, not all frames. It reports exact quantiles when every sample fits; longer runs explicitly label reservoir estimates. A final integrated run and separate real browser/real transport checks remain necessary after all shared integration lands.

## Integrated world and delta follow-up

The later `--mode integrated --delta` run used the actual expanded world and 25-NPC defaults, with no map/controller override. It passed 96,040 complete transport reconstruction comparisons across five minutes each of spread and camp play. See [snapshot-delta-integration.md](snapshot-delta-integration.md) for measured delta sizes, extra CPU cost, periodic full/recovery semantics, and memory caveats. In that run all 25 NPCs moved, the maximum retained NPC path had 24 aggregate points, and the spread human span averaged 119 tiles. The harness now supports `--delta` for repeating this same-stream comparison; its JSON records the source fingerprints and whether fixture overrides were enabled.

## Integrated browser renderer sample

After the camera, cold-chunk coverage, transition and label fixes, a quiet local 1440 × 900 desktop run advanced the actual Phaser scene counter 4,790 times in 40 seconds (about 119.75 frames/s on this 120 Hz host). The controlled fixture delivered 20 Hz snapshots with eight human records split across the world, 25 NPC records and representative mobs, while moving the local camera through eight destinations. RAF callbacks matched scene-counter advances; interval mean 8.35 ms, p95 10 ms, max 18.1 ms, with no interval above 33.4 ms. Cached floor textures never exceeded 28 and live prop images peaked at 160. This is a synthetic local desktop rendering measurement, not WAN/server delivery, physical-phone performance or a universal 60 fps guarantee. Separate mobile/reduced-motion images were inspected without a mobile frame-rate claim.
