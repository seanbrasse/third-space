import { describe, expect, it } from "vitest";
import { HOME_MAP, getWorld, type Point } from "@third-space/config";
import { canUseFurniture, createPlayer, distance, findHomePath, isHomeSegmentWalkable, isHomeWalkable, stepHome } from "../src/index";

function verifyPath(path: Point[], start: Point, goal: Point) {
  expect(path[0]).toEqual(start);
  expect(path.at(-1)).toEqual(goal);
  for (let index = 1; index < path.length; index++) {
    expect(isHomeSegmentWalkable(path[index - 1]!, path[index]!)).toBe(true);
  }
}

describe("footprint-aware click navigation", () => {
  it("routes around a table from exact off-grid endpoints and walks the route with normal inputs", () => {
    const start = {x: 8.13, y: 8.22};
    const goal = {x: 13.17, y: 8.19};
    const path = findHomePath(start, goal)!;
    expect(path.length).toBeGreaterThan(2);
    verifyPath(path, start, goal);
    let state = {...createPlayer("a", "Nova"), ...start};
    let seq = 0;
    for (const target of path.slice(1)) {
      for (let tick = 0; tick < 1_200 && distance(state, target) > 0.01; tick++) {
        const remaining = distance(state, target);
        const speed = Math.min(1, remaining * 15);
        state = stepHome(state, {seq: seq++, axisX: (target.x - state.x) / remaining * speed, axisY: (target.y - state.y) / remaining * speed, jump: false}, 1 / 60);
        expect(isHomeWalkable(state)).toBe(true);
      }
      expect(distance(state, target)).toBeLessThan(0.01);
    }
  });
  it("rejects blocked clicks, invalid endpoints, unreachable rooms and corner cutting", () => {
    expect(findHomePath(HOME_MAP.spawn, {x: 10, y: 8})).toBeNull();
    expect(findHomePath(HOME_MAP.spawn, {x: NaN, y: 8})).toBeNull();
    expect(findHomePath(HOME_MAP.spawn, {x: 20, y: 8})).toBeNull();
    expect(isHomeSegmentWalkable({x: 8.5, y: 6.5}, {x: 12.5, y: 9.5})).toBe(false);
    expect(findHomePath({x: 2, y: 3}, {x: 8, y: 3}, {width: 10, height: 10, solids: [{x: 4, y: 0, width: 1, height: 10}]})).toBeNull();
    expect(findHomePath(HOME_MAP.spawn, HOME_MAP.spawn)).toEqual([HOME_MAP.spawn]);
  });
  it("makes every furniture use point and seat safely reachable from all eight starts", () => {
    const uses = HOME_MAP.furniture.flatMap((item) => [...item.usePoints]);
    for (const start of HOME_MAP.spawns) for (const goal of uses) {
      expect(isHomeWalkable(goal)).toBe(true);
      const path = findHomePath(start, goal);
      expect(path).not.toBeNull();
      verifyPath(path!, start, goal);
    }
    const couch = HOME_MAP.furniture.find((item) => item.kind === "couch")!;
    for (const seat of couch.seats) {
      expect(seat.x).toBeGreaterThan(couch.footprint.x);
      expect(seat.y).toBeLessThan(couch.footprint.y + couch.footprint.height);
      expect(canUseFurniture(seat, couch)).toBe(true);
    }
    expect(canUseFurniture(HOME_MAP.spawn, couch)).toBe(false);
  });
});


describe("bounded forest",()=>{
  it("has eight reachable safe spawns and eight reachable campfire seats in a finite map",()=>{
    const map=getWorld("forest").map;expect(map.width).toBe(80);expect(map.height).toBe(64);expect(map.seats.filter(seat=>seat.id.startsWith("camp-seat-"))).toHaveLength(8);expect(map.spawns).toHaveLength(8);
    for(const spawn of map.spawns){expect(isHomeWalkable(spawn,map)).toBe(true);for(const seat of map.seats){expect(isHomeWalkable(seat,map)).toBe(true);const path=findHomePath(spawn,seat,map);expect(path).not.toBeNull();}}
    const p=createPlayer("forest","Friend");Object.assign(p,map.spawn);let state=p;
    for(let i=0;i<1500;i++)state=stepHome(state,{seq:i,axisX:0,axisY:1,jump:false},1/60,map);
    expect(state.y).toBeLessThan(map.height-1);expect(isHomeWalkable(state,map)).toBe(true);
  });
});

it("routes from each campsite seat to the cabin, shared board, TV and charger",()=>{const map=getWorld("forest").map;for(const spawn of map.spawns)for(const point of map.furniture.flatMap(f=>f.usePoints)){expect(isHomeWalkable(point,map)).toBe(true);expect(findHomePath(spawn,point,map)).not.toBeNull();}});
