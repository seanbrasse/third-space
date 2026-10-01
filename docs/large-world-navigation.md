# Bounded navigation for the seamless forest

The former pathfinder rejected any detour once `(2×width+1)×(2×height+1)` exceeded
32,768 nodes. The authored 144×112 map has 65,025 grid positions, so the old code
could only return unobstructed direct lines. This change searches sparse half-tile
nodes with an indexed binary min-heap, preserving exact click endpoints and the
existing swept avatar-footprint checks. It does not partition the world or move
any authority to clients.

## Collision and invalidation

Four-tile spatial buckets reduce point, movement-axis, and short swept-segment
queries to nearby solid candidates. The exact collision predicates are unchanged.
Long diagonal queries use a full scan when that is cheaper than traversing their
mostly-empty bounding box. Oversized walls live in an always-tested overflow list
rather than generating unbounded bucket entries.

Persistent indices and lazy walkability caches are used only when the solids
array **and every rectangle** are frozen. Width, height, and solids-reference
changes invalidate a map's cache. Mutable maps never retain either index or
walkability between calls; a path search creates a temporary index for its own
synchronous work. Push, replacement, and same-length in-place rectangle edits
therefore cannot leave stale authority checks. A shallow-frozen array alone is
insufficient.

After constructing a production world map, freeze its geometry once:

```ts
map.solids.forEach(Object.freeze);
Object.freeze(map.solids);
```

Do this in the config/world construction layer, not in collision queries. Mutable
editor/test maps continue to work; queries never freeze callers' objects. The
live root integration owns freezing production maps. No explicit release API is
needed: caches are weakly keyed by map, and replacement drops the old record.

The movement-axis helper retains its existing Rect[] signature for race movement;
home movement supplies an additional map context to select spatial candidates.
No race rule, sprint rule, input trust boundary, or player radius changes.

## Work and memory limits

- At most 16,384 indexed solids and 65,536 bucket references per index. Excessive
  geometry falls back to exact scans; it is not silently ignored.
- At most 32,768 retained walkability entries per immutable map. Further queried
  nodes are computed without adding to that cache.
- At most 65,536 discovered and expanded nodes per search, with one heap entry
  per discovered node. No duplicate stale priority entries accumulate.
- At most 2,048 smoothing LOS checks. When a winding path exceeds that budget,
  the already swept-tested raw tail is returned rather than truncating the route
  or performing quadratic smoothing work.
- No full-map navigation grid allocation. Even a 10,000×10,000 map can resolve a
  local detour. A route that exhausts the explicit search budget may return null;
  this is bounded search, not an unlimited/hierarchical navigation guarantee.
- Existing exact endpoints, blocking, border radius, swept LOS, and no-corner-cut
  behavior remain authoritative. Smoothed and unsmoothed segments are both safe.

## Verification

`tests/unit/large-world-navigation.test.ts` adds 11 tests: 1,200 point/segment
comparisons with the former full-scan oracle on the 729-solid authored map, edge
contacts, eight spread routes, a large detour, a winding maze, sparse large-map
work, blocked walls/thin gaps, mutation/replacement/resize cases, shallow freeze,
oversized walls, and indexed-vs-flat movement state equality.

Together with existing simulation, race, sprint, stalker, werewolf, mimic, NPC,
and encounter-tuning suites: **116 tests pass in 13 files**. Simulation tsc and
isolated strict TypeScript checking of the new test/benchmark pass. The initial
helper-signature regression was caught by race tests and fixed before handoff.
Root still runs the final integrated workspace checks.

## Measured CPU microbenchmark

Run with Node24:

```sh
node --expose-gc --import tsx tests/bench/navigation-benchmark.ts
```

Optional arguments accept previous-module and cap-lift-only baseline files. The
benchmark uses the real 144×112 authored geometry, 729 solids, eight spread
locations, warm-up plus five measured repetitions, and garbage collection between
repetitions. Output includes medians, worst observations, success/checksums, heap
delta after GC, and process RSS. It does not start sockets or render a browser.

The captured original/cap-only comparison is
`../navigation-benchmark.json`; the final implementation rerun is
`../navigation-benchmark-current.json`. On this local Node v24.19.0 runtime:

| Workload | Original | Old A* with only caps raised | New implementation |
| --- | ---: | ---: | ---: |
| Eight spread routes | 2/8 resolve | 8/8 resolve, 3406.17ms median | 8/8 resolve, 25.92ms median |
| 40,000 points + 10,000 short segments | 1819.55ms | 2044.01ms | 12.14ms |
| Eight actors, 600 ticks each (10 simulated seconds) | 531.89ms | 599.57ms | 8.31ms |

Collision checksum 42586 and movement checksum 1031201 match across all versions.
The original's 1.50ms route time is not a speed comparison: it rejects six valid
routes due to the map-size cap. The cap-only baseline raised only map and visited
limits, retaining the prior full scans and linear open-set minimum search.
The final process observed approximately 0.9MiB retained heap growth after the
workload and 129.6MiB RSS; GC/JIT/process ordering makes these observational, not
hard application memory guarantees. Array/cache/search entry counts above are the
actual allocation bounds.

This measures simulation CPU only, not eight connected players, full-room memory,
network snapshots, Phaser draw time, mobile performance, or 60fps. Root's spread
player load/render profiling remains necessary with streaming and NPCs integrated.
