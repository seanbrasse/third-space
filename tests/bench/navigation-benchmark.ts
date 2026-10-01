/** Reproducible CPU microbenchmark; no sockets, rendering, or 60fps claims.
 * NODE24 --expose-gc --import tsx tests/bench/navigation-benchmark.ts [old-index.ts] [cap-only-index.ts]
 * Optional baseline files must be the previous simulation module with its local
 * imports resolved. The cap-only version lifts just its map/visited limits.
 */
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { FOREST_MAP, type Point } from '../../packages/config/src/index';
import { expandAuthoredForest, FOREST_BUILDINGS } from '../../packages/config/src/authored-forest';
import * as current from '../../packages/simulation/src/index';

type API = Pick<typeof current, 'isHomeWalkable' | 'isHomeSegmentWalkable' | 'findHomePath' | 'createPlayer' | 'stepHome'>;
const source = expandAuthoredForest(FOREST_MAP);
const map = { ...source, solids: Object.freeze(source.solids.map(s => Object.freeze({ ...s }))) };
const anchors: Point[] = [source.spawn, ...FOREST_BUILDINGS.slice(0, 7).map(b => b.door)];
const routes = anchors.map((a, i) => [a, anchors[(i + 4) % anchors.length]!] as const);
const pointChecks = Array.from({ length: 40_000 }, (_, i) => ({ x: .31 + (i * .731 % 143.38), y: .31 + (i * 1.173 % 111.38) }));
const segments = pointChecks.slice(0, 10_000).map(a => [a, { x: Math.min(143.6, a.x + .45), y: Math.min(111.6, a.y + .3) }] as const);
const versions: { label: string; api: API }[] = [{ label: 'spatial-heap', api: current }];
for (let i = 2; i < process.argv.length; i++) versions.push({ label: i === 2 ? 'original' : 'cap-only-linear', api: await import(pathToFileURL(process.argv[i]!).href) });
function measure(fn: () => number, repeats = 5) {
  fn(); const samples: number[] = []; let checksum = 0;
  for (let i = 0; i < repeats; i++) { global.gc?.(); const start = performance.now(); checksum = fn(); samples.push(performance.now() - start); }
  samples.sort((a, b) => a - b);
  return { medianMs: Number(samples[Math.floor(samples.length / 2)]!.toFixed(2)), worstMs: Number(samples.at(-1)!.toFixed(2)), checksum };
}
const results = [];
for (const { label, api } of versions) {
  global.gc?.(); const before = process.memoryUsage();
  const paths = measure(() => routes.reduce((count, [a, b]) => count + Number(!!api.findHomePath(a, b, map)), 0));
  const collisions = measure(() => {
    let hits = 0;
    for (const p of pointChecks) hits += Number(api.isHomeWalkable(p, map));
    for (const [a, b] of segments) hits += Number(api.isHomeSegmentWalkable(a, b, map));
    return hits;
  });
  const walking = measure(() => {
    let actors = anchors.map((p, i) => ({ ...api.createPlayer(`bench-${i}`, 'Walker'), ...p }));
    for (let tick = 0; tick < 600; tick++) actors = actors.map((p, i) => api.stepHome(p, { seq: tick, axisX: Math.sin((tick + i * 200) / 53), axisY: Math.cos((tick + i * 80) / 71), jump: false }, 1 / 60, map, tick * 1000 / 60));
    return Math.round(actors.reduce((sum, p) => sum + p.x + p.y, 0) * 1000);
  });
  global.gc?.(); const after = process.memoryUsage();
  results.push({ label, eightSpreadRoutes: paths, fortyThousandPointsAndTenThousandSegments: collisions, eightPlayersTenSeconds: walking,
    retainedHeapDeltaKiB: Math.round((after.heapUsed - before.heapUsed) / 1024), rssMiB: Number((after.rss / 1048576).toFixed(1)) });
}
console.log(JSON.stringify({ node: process.version, width: map.width, height: map.height, solids: map.solids.length, routeCount: routes.length, repeats: 5, results }, null, 2));
