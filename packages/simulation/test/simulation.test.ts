import { describe, expect, it } from "vitest";
import {
  DEFAULT_AVATAR,
  type PlayerInput,
  type PlayerState,
} from "@third-space/contracts";
import {
  canInteract,
  createPlayer,
  GAME_CONFIG,
  getCheckpointSpawn,
  getMediaEligibility,
  getVoiceEligibility,
  getVoiceGain,
  hasFinishedRace,
  HOME_MAP,
  overlapsPlayer,
  RACE_MAP,
  resetRacePlayer,
  stepHome,
  stepRace,
} from "../src/index";

const input = (axisX = 0, axisY = 0, jump = false, seq = 0): PlayerInput => ({
  seq,
  axisX,
  axisY,
  jump,
});
const player = () => createPlayer("a", "Nova", DEFAULT_AVATAR);
const runHome = (state: PlayerState, move: PlayerInput, ticks: number) => {
  for (let tick = 0; tick < ticks; tick++)
    state = stepHome(state, { ...move, seq: tick }, 1 / 60);
  return state;
};
const runRace = (state: PlayerState, move: PlayerInput, ticks: number) => {
  for (let tick = 0; tick < ticks; tick++)
    state = stepRace(state, { ...move, seq: tick }, 1 / 60);
  return state;
};

describe("top-down authority and prediction", () => {
  it("normalizes diagonal speed and preserves the source snapshot", () => {
    const original = player();
    const horizontal = runHome(original, input(1), 30);
    const diagonal = runHome(original, input(1, 1), 30);
    expect(
      Math.hypot(diagonal.x - original.x, diagonal.y - original.y),
    ).toBeCloseTo(horizontal.x - original.x, 9);
    expect(horizontal.x).toBeCloseTo(original.x + 2, 9);
    expect(original).toEqual(player());
  });
  it("collides with furniture, cannot tunnel, and slides along the free axis", () => {
    const state = { ...player(), x: 8, y: 7.4 };
    const end = runHome(state, input(1, 0.2), 60);
    expect(end.x).toBeLessThanOrEqual(9 - GAME_CONFIG.playerRadius + 1e-8);
    expect(end.y).toBeGreaterThan(state.y);
    expect(HOME_MAP.solids.some((solid) => overlapsPlayer(end, solid))).toBe(
      false,
    );
  });
  it("stops at world walls, sanitizes axes and bounds elapsed integration", () => {
    const end = runHome({ ...player(), x: 2, y: 12 }, input(-1), 300);
    expect(end.x).toBeCloseTo(1.3, 9);
    const clamped = stepHome(player(), input(10), 999);
    expect(clamped.x - HOME_MAP.spawn.x).toBeLessThanOrEqual(1 + 1e-8);
    expect(stepHome(player(), input(NaN), 1 / 60).x).toBe(HOME_MAP.spawn.x);
  });
  it("stands only on movement and disconnected players remain neutral", () => {
    const seated = { ...player(), seatId: "chair-left", ...HOME_MAP.seats.find((seat) => seat.id === "chair-left")! };
    expect(stepHome(seated, input(), 1 / 60).seatId).toBe("chair-left");
    expect(stepHome(seated, input(-1), 1 / 60).seatId).toBeUndefined();
    expect(
      stepHome({ ...player(), connected: false }, input(1), 1 / 60).x,
    ).toBe(HOME_MAP.spawn.x);
  });
  it("matches a fixed golden trace at each authoritative second", () => {
    const golden = [
      [6.1194299994186, 12.970142500145244],
      [6.1194299994186, 13.940285000290487],
      [9.69713876341821, 12.151430618290576],
      [13.274847527417819, 10.362576236290664],
    ];
    let state = player();
    for (let seq = 0; seq < 240; seq++) {
      state = stepHome(
        state,
        input(seq < 90 ? -1 : 1, seq < 120 ? 0.25 : -0.5, false, seq),
        1 / 60,
      );
      if ((seq + 1) % 60 === 0) {
        expect(state.x).toBeCloseTo(golden[Math.floor(seq / 60)]![0]!, 9);
        expect(state.y).toBeCloseTo(golden[Math.floor(seq / 60)]![1]!, 9);
        expect(state.lastInputSeq).toBe(seq);
      }
    }
  });
});

describe("race physics and scoring boundaries", () => {
  it("lands on floor and requires a new press rather than repeated held jumps", () => {
    const start = resetRacePlayer(player());
    const airborne = stepRace(start, input(0, 0, true), 1 / 60);
    expect(airborne.y).toBeLessThan(start.y);
    expect(airborne.vy).toBeLessThan(0);
    const landed = runRace(airborne, input(0, 0, true), 120);
    expect(landed.y).toBeCloseTo(15.7, 8);
    expect(landed.grounded).toBe(true);
    const release = stepRace(landed, input(), 1 / 60);
    expect(stepRace(release, input(0, 0, true), 1 / 60).vy).toBeLessThan(0);
  });
  it("clamps movement, stops on raised platforms, and never accepts axisY flight", () => {
    const start = { ...resetRacePlayer(player()), x: 12 };
    const end = runRace(start, input(1, -1), 60);
    expect(end.x).toBeCloseTo(12.7, 8);
    expect(end.y).toBeCloseTo(15.7, 8);
    const clamped = stepRace(resetRacePlayer(player()), input(100), 1 / 60);
    expect(clamped.x).toBeCloseTo(2.1, 8);
  });
  it("allows coyote and buffered jumps without infinite air jumping", () => {
    const airborne = {
      ...resetRacePlayer(player()),
      y: 14,
      grounded: false,
      coyoteTime: 0.08,
    };
    expect(stepRace(airborne, input(0, 0, true), 1 / 60).vy).toBeLessThan(-9);
    const tooLate = { ...airborne, coyoteTime: 0 };
    expect(
      stepRace(tooLate, input(0, 0, true), 1 / 60).vy,
    ).toBeGreaterThanOrEqual(0);
    const nearFloor = { ...tooLate, y: 15.6, vy: 12 };
    const buffered = runRace(nearFloor, input(0, 0, true), 4);
    expect(buffered.vy).toBeLessThan(0);
  });
  it("validates ordered checkpoints and cannot finish by skipping ahead", () => {
    const skipped = stepRace(
      { ...resetRacePlayer(player()), x: RACE_MAP.checkpoints[1].x },
      input(),
      1 / 60,
    );
    expect(skipped.checkpoint).toBe(0);
    expect(hasFinishedRace({ ...skipped, x: RACE_MAP.finish.x + 0.5 })).toBe(
      false,
    );
    let state = resetRacePlayer(player());
    for (let i = 0; i < RACE_MAP.checkpoints.length; i++) {
      state = stepRace(
        { ...state, x: RACE_MAP.checkpoints[i]!.x },
        input(),
        1 / 60,
      );
      expect(state.checkpoint).toBe(i + 1);
    }
    expect(hasFinishedRace({ ...state, x: RACE_MAP.finish.x + 0.5 })).toBe(
      true,
    );
  });
  it("hazards freeze for half a second and respawn at the last validated checkpoint", () => {
    const start = { ...resetRacePlayer(player()), x: 114.5, checkpoint: 1 };
    const hit = stepRace(start, input(1), 1 / 60);
    expect(hit.respawnTimer).toBeGreaterThan(0.48);
    const frozen = runRace(hit, input(1), 20);
    expect(frozen.x).toBe(hit.x);
    const respawned = runRace(frozen, input(), 15);
    expect(respawned.x).toBe(getCheckpointSpawn(1).x);
    expect(respawned.checkpoint).toBe(1);
    expect(respawned.respawnTimer).toBe(0);
  });
  it("freezes recorded finishers and resets retry state", () => {
    const finish = {
      ...resetRacePlayer(player()),
      x: RACE_MAP.finish.x + 0.5,
      checkpoint: 4,
      finishedAt: 90_000,
    };
    expect(stepRace(finish, input(-1, 0, true), 1 / 60).x).toBe(finish.x);
    const retry = resetRacePlayer(finish);
    expect(retry.finishedAt).toBeUndefined();
    expect(retry.checkpoint).toBe(0);
    expect(retry.avatar).toEqual(finish.avatar);
  });
  it("completes the entire authored course with a server-scored golden jumping trace", () => {
    let state = resetRacePlayer(player());
    const obstacles = [
      ...RACE_MAP.hazards,
      ...RACE_MAP.platforms.filter((solid) => solid.y < 16),
    ].sort((a, b) => a.x - b.x);
    let jumped = false;
    let resets = 0;
    let finishTick = -1;
    const checkpointTicks: number[] = [];
    for (let seq = 0; seq < 5_400; seq++) {
      const nextObstacle = obstacles.find(
        (solid) => solid.x + solid.width > state.x + GAME_CONFIG.playerRadius,
      );
      const jump: boolean = Boolean(
        state.grounded &&
          !jumped &&
          nextObstacle &&
          nextObstacle.x - state.x < 1.8,
      );
      const prior = state;
      state = stepRace(state, input(1, 0, jump, seq), 1 / 60);
      jumped = jump;
      if (state.checkpoint !== prior.checkpoint) checkpointTicks.push(seq);
      if (state.respawnTimer && !prior.respawnTimer) resets++;
      if (hasFinishedRace(state)) {
        finishTick = seq;
        break;
      }
    }
    expect(resets).toBe(0);
    expect(state.checkpoint).toBe(4);
    expect(checkpointTicks).toEqual([807, 1_707, 2_607, 3_477]);
    expect(finishTick).toBe(3_547);
    expect((finishTick + 1) / 60).toBeCloseTo(59.133333333, 8);
    expect(state.x).toBeCloseTo(356.8, 8);
    expect(state.y).toBeCloseTo(15.7, 8);
  });
});

describe("voice reach rules", () => {
  const source = { ...player(), x: 0, y: 0, nativeMode: "enabled" as const };
  const listener = {
    ...source,
    id: "b",
    x: 11.6,
    nativeMode: "listen" as const,
  };
  it("latches only inside11.5 and revokes at12 even with a prior permission", () => {
    expect(getVoiceEligibility(source, listener, "proximity")).toBe(false);
    expect(
      getVoiceEligibility(source, { ...listener, x: 11.5 }, "proximity"),
    ).toBe(true);
    expect(getVoiceEligibility(source, listener, "proximity", true)).toBe(true);
    expect(
      getVoiceEligibility(source, { ...listener, x: 12 }, "proximity", true),
    ).toBe(false);
    expect(getVoiceEligibility(source, { ...listener, x: 40 }, "room")).toBe(
      true,
    );
  });
  it("respects instance/zone, personal mode, mute and deafen independently", () => {
    const near = { ...listener, x: 1 };
    expect(
      getVoiceEligibility({ ...source, manualMute: true }, near, "room"),
    ).toBe(false);
    expect(
      getVoiceEligibility(source, { ...near, deafened: true }, "room"),
    ).toBe(false);
    expect(
      getVoiceEligibility(source, { ...near, nativeMode: "off" }, "room"),
    ).toBe(false);
    expect(getVoiceEligibility(source, { ...near, mode: "race" }, "room")).toBe(
      false,
    );
    expect(
      getVoiceEligibility(
        { ...source, zoneId: "kitchen" },
        { ...near, zoneId: "garden" },
        "proximity",
      ),
    ).toBe(false);
    expect(
      getVoiceEligibility(
        { ...source, instanceId: "a" },
        { ...near, instanceId: "b" },
        "room",
      ),
    ).toBe(false);
    expect(getVoiceEligibility(source, source, "room")).toBe(false);
    expect(
      getVoiceEligibility(source, { ...near, manualMute: true }, "proximity"),
    ).toBe(true);
  });
  it("gain is smooth, monotonic and zero for invalid distances", () => {
    expect(getVoiceGain(2)).toBe(1);
    expect(getVoiceGain(7)).toBeCloseTo(0.5);
    expect(getVoiceGain(12)).toBe(0);
    expect(getVoiceGain(NaN)).toBe(0);
    for (let d = 2; d < 12; d += 0.1)
      expect(getVoiceGain(d + 0.1)).toBeLessThanOrEqual(getVoiceGain(d));
  });
  it("media permission fails closed on stale authority, future timestamps and revoked access", () => {
    const a = {
      ...source,
      instanceId: "home-1",
      epoch: "epoch-1",
      zoneId: "home",
      accessValid: true,
      mediaConnected: true,
      positionUpdatedAt: 1_000,
      publicationAllowed: true,
    };
    const b = { ...a, id: "b", x: 1, nativeMode: "listen" as const };
    expect(getMediaEligibility(a, b, "proximity", 1_999)).toBe(true);
    expect(getMediaEligibility(a, b, "proximity", 2_000)).toBe(false);
    expect(getMediaEligibility(a, b, "proximity", 999)).toBe(false);
    expect(
      getMediaEligibility(a, { ...b, accessValid: false }, "room", 1_100),
    ).toBe(false);
    expect(
      getMediaEligibility(
        { ...a, publicationAllowed: false },
        b,
        "room",
        1_100,
      ),
    ).toBe(false);
  });
});

describe("world interactions", () => {
  it("requires authoritative proximity to the board", () => {
    expect(canInteract({ x: 9.5, y: 2.6 }, HOME_MAP.board)).toBe(true);
    expect(canInteract(HOME_MAP.spawn, HOME_MAP.board)).toBe(false);
  });
});
