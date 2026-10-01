import { describe, expect, it } from "vitest";
import { ASYLUM_MAP, GAME_CONFIG, WORLDS, type Rect } from "@third-space/config";
import { canUseFurniture, findHomePath, intersects, isHomeWalkable } from "../src/index";

const projector = ASYLUM_MAP.furniture.find(item => item.id === "asylum-tv")!;
const surface = WORLDS.asylum.mediaSurface;

describe("larger asylum projector layout", () => {
  it("enlarges the original six-tile picture to ten tiles at exactly 16:9", () => {
    expect(surface.width).toBe(10);
    expect(surface.height).toBe(5.625);
    expect(surface.width / surface.height).toBe(16 / 9);
    expect(surface.width * surface.height).toBeGreaterThan(6 * 3.375 * 2.7);
    expect(surface.x + surface.width / 2).toBe(ASYLUM_MAP.width / 2);
    const frame=projector.footprint;
    expect(surface.x).toBeGreaterThan(frame.x);
    expect(surface.y).toBeGreaterThan(frame.y);
    expect(surface.x+surface.width).toBeLessThan(frame.x+frame.width);
    expect(surface.y+surface.height).toBeLessThan(frame.y+frame.height);
  });
  it("keeps the frame below the north wall and separate from every cell, cushion and charger", () => {
    expect(projector.footprint.y).toBeGreaterThanOrEqual(2);
    for (const item of ASYLUM_MAP.furniture.filter(item=>item.id!==projector.id)) {
      expect(intersects(projector.footprint,item.footprint),item.id).toBe(false);
    }
    expect(projector.collider).not.toBeNull();
    expect(ASYLUM_MAP.solids).toContainEqual(projector.collider);
    const solid=projector.collider as Rect, frame=projector.footprint;
    expect(solid.x).toBeGreaterThanOrEqual(frame.x);
    expect(solid.x+solid.width).toBeLessThanOrEqual(frame.x+frame.width);
    expect(solid.y).toBeGreaterThan(surface.y+surface.height);
    expect(solid.y+solid.height).toBeLessThanOrEqual(frame.y+frame.height);
  });
  it("retains eight distinct cushion seats, clear spawn/use points and reachable TV, charger and exit", () => {
    const seats=ASYLUM_MAP.seats.filter(seat=>seat.id.startsWith("asylum-cushion-"));
    expect(seats).toHaveLength(GAME_CONFIG.partyCapacity);
    expect(new Set(seats.map(s=>`${s.x},${s.y}`)).size).toBe(8);
    for(const point of [...ASYLUM_MAP.spawns,...ASYLUM_MAP.seats,...ASYLUM_MAP.furniture.flatMap(item=>item.usePoints)]){
      expect(isHomeWalkable(point,ASYLUM_MAP),JSON.stringify(point)).toBe(true);
      expect(findHomePath(ASYLUM_MAP.spawn,point,ASYLUM_MAP),JSON.stringify(point)).not.toBeNull();
    }
    expect(isHomeWalkable(surface.source,ASYLUM_MAP)).toBe(true);
    const use=projector.usePoints[0];
    expect(use.y-(surface.y+surface.height)).toBeGreaterThanOrEqual(1.65);
    expect(Math.hypot(use.x-surface.source.x,use.y-surface.source.y)).toBeLessThan(GAME_CONFIG.interactionDistance);
    expect(canUseFurniture(use,projector)).toBe(true);
    expect(intersects({x:use.x-.7,y:use.y-1.65,width:1.4,height:1.65},surface)).toBe(false);
    expect(WORLDS.asylum.fire).toEqual({x:10,y:10});
    for(const seat of seats){
      // Reserve two tiles above every seated player's feet for the rendered avatar.
      expect(intersects({x:seat.x-.7,y:seat.y-2,width:1.4,height:2},surface),seat.id).toBe(false);
    }
    for(const cushion of ASYLUM_MAP.furniture.filter(item=>item.id.startsWith("asylum-cushion-"))){
      for(const other of ASYLUM_MAP.furniture.filter(item=>item.id.startsWith("asylum-cushion-")&&item.id!==cushion.id)){
        expect(intersects(cushion.footprint,other.footprint),`${cushion.id}/${other.id}`).toBe(false);
      }
    }
    for(let i=0;i<seats.length;i++)for(const other of seats.slice(i+1)){
      expect(Math.hypot(seats[i].x-other.x,seats[i].y-other.y)).toBeGreaterThan(GAME_CONFIG.playerRadius*2);
    }
    // Clear passages remain on both sides of the projector base.
    for(const point of [{x:4.3,y:7.9},{x:15.7,y:7.9}]){
      expect(isHomeWalkable(point,ASYLUM_MAP)).toBe(true);
      expect(findHomePath(ASYLUM_MAP.spawn,point,ASYLUM_MAP)).not.toBeNull();
    }
  });
});
