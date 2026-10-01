import { describe, expect, it } from "vitest";
import { createPlayer, requestSprint, sprintStatus, stepHome } from "@third-space/simulation";
import { canTouchBoost, queueTouchBoost, takeTouchBoost } from "./touch-boost";

const player = () => ({ ...createPlayer("a", "A"), x: 10, y: 10 });
describe("mobile boost tap", () => {
  it("consumes a tap once, independently of pointer release or movement", () => {
    const touch = { axisX: 1, axisY: 0, jump: false, boostTap: false };
    expect(queueTouchBoost(touch, player(), 1000)).toBe(true);
    expect(queueTouchBoost(touch, player(), 1000)).toBe(false);
    expect(takeTouchBoost(touch)).toBe(true);
    expect(takeTouchBoost(touch)).toBe(false);
    expect(touch.axisX).toBe(1);
    expect(touch.jump).toBe(false);
  });
  it("a single tap gives the existing timed boost without holding sprint", () => {
    const touch = {};
    queueTouchBoost(touch, player(), 1000);
    const p = takeTouchBoost(touch) ? requestSprint(player(), 1000) : player();
    const input = { seq: 1, axisX: 1, axisY: 0, jump: false, sprint: false };
    const map = { width: 100, height: 100, solids: [] };
    const boosted = stepHome(p, input, .1, map, 1400);
    const normal = stepHome(player(), input, .1, map, 1400);
    expect(boosted.x - p.x).toBeCloseTo((normal.x - p.x) * 1.6);
    expect(sprintStatus(p, 2500).phase).toBe("refilling");
    expect(sprintStatus(p, 7500).phase).toBe("ready");
  });
  it("repeated taps cannot extend active boost or bypass refill", () => {
    const p = requestSprint(player(), 1000);
    for (const now of [1001, 2000, 2500, 7499]) {
      expect(queueTouchBoost({}, p, now)).toBe(false);
      expect(requestSprint(p, now)).toBe(p);
    }
    expect(queueTouchBoost({}, p, 7500)).toBe(true);
    expect(p.sprintUntil).toBe(2500);
  });
  it("respects race, seats, death, disconnect, blocked actions and missing state", () => {
    expect(canTouchBoost(undefined, 1000)).toBe(false);
    for (const patch of [{ mode: "race" as const }, { seatId: "seat" }, { connected: false }, { respawnAt: 2000 }, { roastingAt: 10 }]) {
      expect(queueTouchBoost({}, { ...player(), ...patch }, 1000)).toBe(false);
    }
  });
  it("clears discarded requests so modal/visibility transitions cannot defer activation", () => {
    const touch = { boostTap: true };
    takeTouchBoost(touch); // Scene always consumes; it applies only while active.
    expect(takeTouchBoost(touch)).toBe(false);
  });
});
