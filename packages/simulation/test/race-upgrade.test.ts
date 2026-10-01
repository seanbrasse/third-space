import { describe, expect, it } from 'vitest';
import { GAME_CONFIG, RACE_BOOST, RACE_MAP } from '@third-space/config';
import { createPlayer, resetRacePlayer, respawnRacePlayer, stepRace, stepRaceBoosts, hasFinishedRace } from '../src/index';
const start = () => resetRacePlayer(createPlayer('racer', 'Racer'));
const input = (seq = 0, jump = false, axisX = 0) => ({ seq, jump, axisX, axisY: 0 });

function drive(allowBoosts: boolean) {
  let state = start(), lastJump = false;
  const obstacles = [...RACE_MAP.hazards, ...RACE_MAP.platforms.filter(p => p.y < 16), ...RACE_MAP.gaps.map(g => ({ ...g, y: 16, height: 2 }))].sort((a, b) => a.x - b.x);
  const checkpointTicks: number[] = [];
  for (let seq = 0; seq < 7200; seq++) {
    // Pre-collected pickups model a racer choosing to pass beside them; base physics must suffice.
    if (!allowBoosts) state = { ...state, racePickupIds: RACE_MAP.pickups.map(p => p.id) };
    const obstacle = obstacles.find(o => o.x + o.width > state.x + GAME_CONFIG.playerRadius);
    const threshold = (state.raceSpeedBoostSeconds ?? 0) > 0 ? 2.1 : (obstacle && obstacle.y >= 15.3 && obstacle.y < 16 ? 1.4 : 1.8);
    const jump: boolean = !!(state.grounded && !lastJump && obstacle && obstacle.x - state.x < threshold);
    const prior = state;
    state = stepRace(state, input(seq, jump, 1), 1 / 60); lastJump = jump;
    if (state.checkpoint !== prior.checkpoint) checkpointTicks.push(seq);
    if (hasFinishedRace(state)) return { state, tick: seq, checkpointTicks };
  }
  throw new Error(`Course failed: checkpoint ${state.checkpoint} at ${state.x}, deaths ${state.raceDeathCount}`);
}

describe('personal authoritative race boosts', () => {
  it('collects only overlapping pickups, and independently for each racer', () => {
    expect(stepRace(start(), input(), 1 / 60).racePickupIds).toEqual([]);
    const first = stepRace({ ...start(), x: 5 }, input(), 1 / 60);
    const second = stepRace({ ...start(), id: 'friend', x: 5 }, input(), 1 / 60);
    expect(first.racePickupIds).toEqual(['speed-0']);
    expect(second.racePickupIds).toEqual(first.racePickupIds);
    expect(first.raceSpeedBoostSeconds).toBeLessThanOrEqual(RACE_BOOST.durationSeconds);
    expect(first.racePickupCount).toBe(1);
    expect(stepRace(first, input(), .05).racePickupCount).toBe(1);
    expect(start().racePickupIds).toEqual([]);
  });
  it('applies the configured power, expires, caps malformed duration and does not stack power', () => {
    const boosted = stepRace({ ...start(), x: 5 }, input(1, false, 1), 1 / 60);
    expect(boosted.vx).toBe(GAME_CONFIG.raceSpeed * RACE_BOOST.speedMultiplier);
    const refreshed = stepRaceBoosts({ ...boosted, x: 95, raceSpeedBoostSeconds: 5.9 }, 0);
    expect(refreshed.raceSpeedBoostSeconds).toBe(5.9);
    const malformed = stepRaceBoosts({ ...refreshed, raceSpeedBoostSeconds: Infinity, raceJumpBoostSeconds: 100 }, .5, false);
    expect(malformed.raceSpeedBoostSeconds).toBe(0);
    expect(malformed.raceJumpBoostSeconds).toBe(5.5);
    const expired = stepRaceBoosts(boosted, RACE_BOOST.maxSeconds, false);
    expect(expired.raceSpeedBoostSeconds).toBe(0);
    expect(stepRace({ ...expired, x: 35, racePickupIds: RACE_MAP.pickups.map(p => p.id) }, input(2, false, 1), 1 / 60).vx).toBe(GAME_CONFIG.raceSpeed);
    const launch = stepRace({ ...start(), x: 34 }, input(0, true), 1 / 60);
    expect(launch.vy).toBeCloseTo(GAME_CONFIG.raceJumpVelocity * RACE_BOOST.jumpMultiplier + GAME_CONFIG.raceGravity / 60);
  });
  it('clears power on impact/respawn and prevents checkpoint farming; a new race resets all', () => {
    const boosted = { ...start(), x: 9, raceSpeedBoostSeconds: 4, raceJumpBoostSeconds: 4, racePickupIds: ['speed-0'], racePickupCount: 1 };
    const hit = stepRace(boosted, input(), 1 / 60);
    expect(hit.raceDeathCount).toBe(1);
    expect(hit.raceSpeedBoostSeconds).toBe(0); expect(hit.raceJumpBoostSeconds).toBe(0);
    const waiting = stepRace(hit, input(1, true, 1), .1);
    expect(waiting.raceDeathCount).toBe(1);
    const respawn = respawnRacePlayer({ ...hit, checkpoint: 1, raceSpeedBoostSeconds: 2 });
    expect(respawn.x).toBe(RACE_MAP.checkpoints[0].spawn.x);
    expect(respawn.racePickupIds).toEqual(['speed-0']); expect(respawn.raceSpeedBoostSeconds).toBe(0);
    const reset = resetRacePlayer(hit);
    expect(reset.racePickupIds).toEqual([]); expect(reset.raceDeathCount).toBe(0); expect(reset.racePickupCount).toBe(0);
  });
  it('counts launches once per press and ignores pickups for dead, finished or disconnected racers', () => {
    const launched = stepRace(start(), input(1, true), 1 / 60);
    expect(launched.raceJumpCount).toBe(1);
    expect(stepRace(launched, input(2, true), .1).raceJumpCount).toBe(1);
    for (const patch of [{ connected: false }, { finishedAt: 10 }, { respawnTimer: .5 }]) {
      expect(stepRaceBoosts({ ...start(), x: 5, ...patch }, .01).racePickupCount).toBe(0);
    }
  });
  it('matches client prediction and authority at different supported step sizes', () => {
    const near = { ...start(), x: 4.5 };
    let authority = near, client = near;
    for (let i = 0; i < 30; i++) authority = stepRace(authority, input(1, false, 1), 1 / 60);
    for (let i = 0; i < 15; i++) client = stepRace(client, input(1, false, 1), 1 / 30);
    expect(client.x).toBeCloseTo(authority.x, 9);
    expect(client.raceSpeedBoostSeconds).toBeCloseTo(authority.raceSpeedBoostSeconds!, 9);
    expect(client.racePickupIds).toEqual(authority.racePickupIds);
  });
});

describe('progressive fair race course', () => {
  it('increases obstacle heights, spike widths and gap widths, with safe checkpoint respawns', () => {
    for (let i = 1; i < RACE_MAP.stages.length; i++) {
      expect(RACE_MAP.stages[i].blockHeight).toBeGreaterThan(RACE_MAP.stages[i - 1].blockHeight);
      expect(RACE_MAP.stages[i].hazardWidth).toBeGreaterThan(RACE_MAP.stages[i - 1].hazardWidth);
      expect(RACE_MAP.stages[i].gapWidth).toBeGreaterThan(RACE_MAP.stages[i - 1].gapWidth);
    }
    expect(new Set(RACE_MAP.pickups.map(p => p.id)).size).toBe(RACE_MAP.pickups.length);
  });
  it('finishes all four sections without any boosts or deaths, under the server timeout', () => {
    const result = drive(false);
    expect(result.state.raceDeathCount).toBe(0); expect(result.state.checkpoint).toBe(4);
    expect(result.tick / 60 * 1000).toBeLessThan(GAME_CONFIG.raceTimeoutMs);
  });
  it('finishes with all pickups faster and gives every racer the same deterministic trace', () => {
    const a = drive(true), b = drive(true), normal = drive(false);
    expect(a).toEqual(b); expect(a.state.raceDeathCount).toBe(0);
    expect(a.state.racePickupCount).toBe(8); expect(a.tick).toBeLessThan(normal.tick);
    expect(a.checkpointTicks).toEqual([742, 1578, 2415, 3224]); expect(a.tick).toBe(3294);
  });
});
