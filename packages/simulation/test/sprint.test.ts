import { describe, expect, it } from "vitest";
import { GAME_CONFIG } from "@third-space/config";
import { createPlayer, stepHome, requestSprint, cancelSprint, sprintStatus, SPRINT } from "../src/index";
const clearMap = { width: 100, height: 100, solids: [] };
const start = () => ({ ...createPlayer("a", "A"), x: 10, y: 10 });
const input = { seq: 1, axisX: 1, axisY: 0, jump: false, sprint: true };
describe("server-timed sprint", () => {
  it("boosts for exactly 1.5 seconds, then refills over five seconds", () => {
    const p = requestSprint(start(), 1_000);
    expect(p.sprintUntil).toBe(2_500);
    expect(p.sprintReadyAt).toBe(7_500);
    expect(sprintStatus(p, 1_750)).toEqual({ phase: "boosting", fraction: .5 });
    expect(sprintStatus(p, 2_500)).toEqual({ phase: "refilling", fraction: 0 });
    expect(sprintStatus(p, 5_000)).toEqual({ phase: "refilling", fraction: .5 });
    expect(requestSprint(p, 7_499)).toBe(p);
    expect(sprintStatus(p, 7_500)).toEqual({ phase: "ready", fraction: 1 });
    expect(requestSprint(p, 7_500).sprintUntil).toBe(9_000);
  });
  it("limits diagonal speed, crosses duration boundaries precisely and never accepts speed from input", () => {
    const p = requestSprint(start(), 1_000);
    const boosted = stepHome(p, { ...input, axisY: 1 }, .1, clearMap, 2_000);
    expect(Math.hypot(boosted.x - p.x, boosted.y - p.y)).toBeCloseTo(GAME_CONFIG.homeSpeed * .1 * SPRINT.multiplier);
    const boundary = stepHome(p, input, .1, clearMap, 2_450);
    expect(boundary.x - p.x).toBeCloseTo(GAME_CONFIG.homeSpeed * .1 * 1.3);
    const spent = stepHome(p, input, .1, clearMap, 2_500);
    expect(spent.x - p.x).toBeCloseTo(GAME_CONFIG.homeSpeed * .1);
    const uncharged = stepHome(start(), input, .1, clearMap, 2_000);
    expect(uncharged.x - 10).toBeCloseTo(GAME_CONFIG.homeSpeed * .1);
  });
  it("retains swept collision protection during boost", () => {
    const p = requestSprint({ ...start(), x: 4 }, 1_000);
    const map = { width: 100, height: 100, solids: [{ x: 5, y: 0, width: .05, height: 100 }] };
    const moved = stepHome(p, input, .25, map, 1_100);
    expect(moved.x).toBeLessThanOrEqual(5 - GAME_CONFIG.playerRadius);
    expect(moved.vx).toBe(0);
  });
  it("blocks seats, actions, race, disconnect and death; cancellation keeps the cooldown", () => {
    for (const patch of [{ seatId: "seat" }, { roastingAt: 1 }, { mode: "race" as const }, { connected: false }, { respawnAt: 5000 }]) {
      const p = { ...start(), ...patch };
      expect(requestSprint(p, 1_000)).toBe(p);
    }
    const p = requestSprint(start(), 1_000);
    cancelSprint(p, 2_000);
    expect(p.sprintUntil).toBe(2_000);
    expect(p.sprintReadyAt).toBe(7_000);
    expect(requestSprint(p, 6_999)).toBe(p);
  });
});
