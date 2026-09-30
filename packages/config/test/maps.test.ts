import { describe, expect, it } from "vitest";
import { GAME_CONFIG, HOME_MAP, RACE_MAP, type Rect } from "../src/index";

function overlaps(x: number, y: number, solid: Rect) {
  const r = GAME_CONFIG.playerRadius;
  return (
    x + r > solid.x + 1e-9 &&
    x - r < solid.x + solid.width - 1e-9 &&
    y + r > solid.y + 1e-9 &&
    y - r < solid.y + solid.height - 1e-9
  );
}
describe("authored map invariants", () => {
  it("derives physical furniture and seat geometry from one bounded manifest", () => {
    expect(HOME_MAP.width).toBe(20);
    expect(HOME_MAP.height).toBe(20);
    const ids = HOME_MAP.furniture.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const item of HOME_MAP.furniture) {
      const footprint = item.footprint;
      expect(footprint.x).toBeGreaterThanOrEqual(1);
      expect(footprint.y).toBeGreaterThanOrEqual(1);
      expect(footprint.x + footprint.width).toBeLessThanOrEqual(19);
      expect(footprint.y + footprint.height).toBeLessThanOrEqual(19);
      if (item.collider) {
        expect(HOME_MAP.solids).toContainEqual(item.collider);
        expect(item.collider.x).toBeGreaterThanOrEqual(footprint.x);
        expect(item.collider.y).toBeGreaterThanOrEqual(footprint.y);
        expect(item.collider.x + item.collider.width).toBeLessThanOrEqual(footprint.x + footprint.width);
        expect(item.collider.y + item.collider.height).toBeLessThanOrEqual(footprint.y + footprint.height);
      }
      for (const use of item.usePoints) expect(HOME_MAP.solids.some((solid) => overlaps(use.x, use.y, solid))).toBe(false);
      for (const seat of item.seats) expect(HOME_MAP.seats).toContainEqual(seat);
    }
    for (const object of [HOME_MAP.board, HOME_MAP.tv, HOME_MAP.portal]) {
      expect(HOME_MAP.furniture.find((item) => item.id === object.id)!.footprint).toEqual({x: object.x, y: object.y, width: object.width, height: object.height});
    }
  });
  it("keeps every home spawn and seat free of solid furniture", () => {
    for (const point of [...HOME_MAP.spawns, ...HOME_MAP.seats]) {
      expect(
        HOME_MAP.solids.some((solid) => overlaps(point.x, point.y, solid)),
      ).toBe(false);
      expect(point.x).toBeGreaterThan(1);
      expect(point.y).toBeGreaterThan(1);
    }
  });
  it("provides eight distinct home starts and seats with safe spacing", () => {
    expect(HOME_MAP.spawns).toHaveLength(GAME_CONFIG.partyCapacity);
    expect(HOME_MAP.seats).toHaveLength(GAME_CONFIG.partyCapacity);
    for (const points of [HOME_MAP.spawns, HOME_MAP.seats]) {
      for (let i = 0; i < points.length; i++) {
        for (const other of points.slice(i + 1)) {
          expect(
            Math.hypot(points[i]!.x - other.x, points[i]!.y - other.y),
          ).toBeGreaterThanOrEqual(GAME_CONFIG.playerRadius * 2);
        }
      }
    }
    expect(
      RACE_MAP.platforms.some((solid) =>
        overlaps(RACE_MAP.spawn.x, RACE_MAP.spawn.y, solid),
      ),
    ).toBe(false);
    expect(
      RACE_MAP.hazards.some((solid) =>
        overlaps(RACE_MAP.spawn.x, RACE_MAP.spawn.y, solid),
      ),
    ).toBe(false);
  });
  it("orders race checkpoints with safe respawns before the next checkpoint", () => {
    let lastX: number = RACE_MAP.spawn.x;
    for (const checkpoint of RACE_MAP.checkpoints) {
      expect(checkpoint.x).toBeGreaterThan(lastX);
      expect(checkpoint.spawn.x).toBeGreaterThan(
        checkpoint.x + checkpoint.width,
      );
      expect(
        RACE_MAP.platforms.some((solid) =>
          overlaps(checkpoint.spawn.x, checkpoint.spawn.y, solid),
        ),
      ).toBe(false);
      expect(
        RACE_MAP.hazards.some((solid) =>
          overlaps(checkpoint.spawn.x, checkpoint.spawn.y, solid),
        ),
      ).toBe(false);
      lastX = checkpoint.spawn.x;
    }
    expect(RACE_MAP.finish.x).toBeGreaterThan(lastX);
  });
  it("has unique interactable ids", () => {
    const ids = [
      ...HOME_MAP.seats.map((seat) => seat.id),
      HOME_MAP.portal.id,
      HOME_MAP.board.id,
      HOME_MAP.tv.id,
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });
});
