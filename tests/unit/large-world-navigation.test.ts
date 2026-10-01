import { describe, expect, it } from 'vitest';
import { FOREST_MAP, GAME_CONFIG, type Point, type Rect } from '../../packages/config/src/index';
import { expandAuthoredForest, FOREST_BUILDINGS } from '../../packages/config/src/authored-forest';
import { createPlayer, findHomePath, isHomeWalkable, isHomeSegmentWalkable, overlapsPlayer, stepHome, type NavigationMap } from '../../packages/simulation/src/index';
const R = GAME_CONFIG.playerRadius, E = 1e-9;
function immutable(map: NavigationMap): NavigationMap { return { ...map, solids: Object.freeze(map.solids.map(s => Object.freeze({ ...s }))) }; }
function oraclePoint(p: Point, map: NavigationMap) {
  return Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= R && p.y >= R && p.x <= map.width - R && p.y <= map.height - R && !map.solids.some(s => overlapsPlayer(p, s));
}
/** Original full-scan swept footprint oracle, independent of the spatial index. */
function oracleSegment(a: Point, b: Point, map: NavigationMap): boolean {
  if (!oraclePoint(a, map) || !oraclePoint(b, map)) return false;
  return !map.solids.some(s => {
    let enter = 0, exit = 1;
    for (const axis of ['x', 'y'] as const) {
      const low = s[axis] - R + E, high = s[axis] + s[axis === 'x' ? 'width' : 'height'] + R - E, delta = b[axis] - a[axis];
      if (Math.abs(delta) < E) { if (a[axis] <= low || a[axis] >= high) { enter = 2; break; } }
      else { const x = (low - a[axis]) / delta, y = (high - a[axis]) / delta; enter = Math.max(enter, Math.min(x, y)); exit = Math.min(exit, Math.max(x, y)); }
    }
    return enter <= exit && enter <= 1 && exit >= 0;
  });
}
function verify(map: NavigationMap, a: Point, b: Point) {
  const path = findHomePath(a, b, map);
  expect(path, `${JSON.stringify(a)} to ${JSON.stringify(b)}`).not.toBeNull();
  expect(path![0]).toEqual(a); expect(path!.at(-1)).toEqual(b);
  for (let i = 1; i < path!.length; i++) expect(oracleSegment(path![i - 1]!, path![i]!, map)).toBe(true);
  return path!;
}
function rng(seed = 7) { return () => { seed = Math.imul(seed, 1664525) + 1013904223; return (seed >>> 0) / 4294967296; }; }

describe('large-world navigation authority', () => {
  it('matches full-scan point and swept collision oracles across expanded geometry', () => {
    const map = immutable(expandAuthoredForest(FOREST_MAP)), random = rng();
    for (let i = 0; i < 1200; i++) {
      const a = { x: random() * 148 - 2, y: random() * 116 - 2 }, b = { x: random() * 144, y: random() * 112 };
      expect(isHomeWalkable(a, map)).toBe(oraclePoint(a, map));
      expect(isHomeSegmentWalkable(a, b, map)).toBe(oracleSegment(a, b, map));
    }
    for (const solid of map.solids.slice(0, 30)) for (const offset of [-E * 2, 0, E * 2]) {
      const a = { x: solid.x - R + offset, y: solid.y + solid.height / 2 };
      expect(isHomeWalkable(a, map)).toBe(oraclePoint(a, map));
    }
  });
  it('connects eight spread destinations across the authored 144×112 map with exact endpoints', () => {
    const expanded = expandAuthoredForest(FOREST_MAP), map = immutable(expanded);
    const locations = [expanded.spawn, ...FOREST_BUILDINGS.slice(0, 7).map(b => b.door)];
    for (let i = 0; i < locations.length; i++) verify(map, locations[i]!, locations[(i + 4) % locations.length]!);
  });
  it('takes a long safe detour beyond the former 32768-node map cap', () => {
    const map = immutable({ width: 144, height: 112, solids: [{ x: 71, y: 0, width: 2, height: 101 }] });
    const path = verify(map, { x: 9.13, y: 48.22 }, { x: 134.17, y: 48.19 });
    expect(path.some(p => p.y >= 101 + R)).toBe(true);
    expect(path.length).toBeGreaterThan(2);
  });
  it('retains a safe route through a winding maze even when smoothing work is exhausted', () => {
    const solids = Array.from({ length: 7 }, (_, i) => ({ x: 18 * (i + 1), y: i % 2 ? 10 : 0, width: 1, height: 102 }));
    const map = immutable({ width: 144, height: 112, solids });
    const path = verify(map, { x: 5.13, y: 5.22 }, { x: 139.17, y: 5.19 });
    expect(path.length).toBeGreaterThan(7);
  });
  it('uses sparse work for a small detour on a huge map rather than rejecting map area', () => {
    const map = immutable({ width: 10_000, height: 10_000, solids: [{ x: 10, y: 7, width: 2, height: 3 }] });
    expect(verify(map, { x: 8.13, y: 8.22 }, { x: 13.17, y: 8.19 }).length).toBeGreaterThan(2);
  });
  it('rejects impassable walls, too-thin gaps, edge/outside goals and diagonal corner cuts', () => {
    const wall = immutable({ width: 144, height: 112, solids: [{ x: 71, y: 0, width: 2, height: 112 }] });
    expect(findHomePath({ x: 20, y: 50 }, { x: 120, y: 50 }, wall)).toBeNull();
    const gap = immutable({ width: 20, height: 20, solids: [{ x: 9, y: 0, width: 2, height: 9.8 }, { x: 9, y: 10.2, width: 2, height: 9.8 }] });
    expect(findHomePath({ x: 3, y: 10 }, { x: 17, y: 10 }, gap)).toBeNull();
    expect(findHomePath({ x: 3, y: 3 }, { x: R - .0001, y: 3 }, gap)).toBeNull();
    expect(isHomeSegmentWalkable({ x: 8, y: 9.5 }, { x: 10, y: 11 }, gap)).toBe(false);
    expect(findHomePath({ x: 3, y: 3 }, { x: Infinity, y: 3 }, gap)).toBeNull();
  });
  it('observes mutable push, same-length replacement, in-place rectangle edits and map resize', () => {
    const solid = { x: 5, y: 4, width: 2, height: 3 };
    const map = { width: 20, height: 20, solids: [solid] };
    const start = { x: 3, y: 5 }, goal = { x: 10, y: 5 };
    verify(map, start, goal);
    solid.x = 9;
    expect(isHomeWalkable(goal, map)).toBe(false); expect(findHomePath(start, goal, map)).toBeNull();
    map.solids[0] = { x: 15, y: 15, width: 2, height: 2 };
    expect(findHomePath(start, goal, map)).toEqual([start, goal]);
    map.solids.push({ x: 4, y: 0, width: 1, height: 20 });
    expect(isHomeSegmentWalkable(start, goal, map)).toBe(false); expect(findHomePath(start, goal, map)).toBeNull();
    map.solids = []; expect(findHomePath(start, goal, map)).toEqual([start, goal]);
    map.width = 8; expect(findHomePath(start, goal, map)).toBeNull();
  });
  it('does not mistake a shallow-frozen array for immutable rectangles', () => {
    const solid = { x: 5, y: 4, width: 2, height: 3 };
    const map: NavigationMap = { width: 20, height: 20, solids: Object.freeze([solid]) };
    verify(map, { x: 3, y: 5 }, { x: 10, y: 5 });
    solid.x = 9;
    expect(isHomeWalkable({ x: 10, y: 5 }, map)).toBe(false);
    expect(findHomePath({ x: 3, y: 5 }, { x: 10, y: 5 }, map)).toBeNull();
  });
  it('invalidates immutable caches when solids or dimensions are replaced', () => {
    const map = immutable({ width: 20, height: 20, solids: [{ x: 5, y: 4, width: 2, height: 3 }] });
    const start = { x: 3, y: 5 }, goal = { x: 10, y: 5 };
    verify(map, start, goal);
    map.solids = Object.freeze([Object.freeze({ x: 9, y: 4, width: 2, height: 3 })]);
    expect(findHomePath(start, goal, map)).toBeNull();
    map.solids = Object.freeze([]); expect(findHomePath(start, goal, map)).toEqual([start, goal]);
    map.width = 7; expect(isHomeWalkable(goal, map)).toBe(false);
  });
  it('keeps movement integration identical between spatial and full-scan collision candidates', () => {
    const source = expandAuthoredForest(FOREST_MAP), indexed = immutable(source), mutable = { ...source, solids: source.solids.map(s => ({ ...s })) };
    for (const start of [{ x: 23, y: 23 }, { x: 97, y: 38 }, { x: 46, y: 84 }, { x: 124, y: 94 }]) {
      let a = { ...createPlayer('same', 'Walker'), ...start }, b = { ...a }; const random = rng();
      for (let i = 0; i < 300; i++) {
        const input = { seq: i, axisX: random() * 2 - 1, axisY: random() * 2 - 1, jump: false, sprint: i % 90 < 25 };
        a = stepHome(a, input, 1 / 60, indexed, i * 17); b = stepHome(b, input, 1 / 60, mutable, i * 17);
        expect(a).toEqual(b);
      }
    }
  });
  it('keeps oversized wall index entries bounded while retaining exact swept collision', () => {
    const map = immutable({ width: 1_000_000, height: 1_000_000, solids: [{ x: 12, y: 0, width: 1, height: 1_000_000 }] });
    expect(isHomeWalkable({ x: 8, y: 8 }, map)).toBe(true);
    expect(isHomeSegmentWalkable({ x: 8, y: 8 }, { x: 20, y: 8 }, map)).toBe(false);
  });
});
