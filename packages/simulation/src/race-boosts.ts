import { RACE_BOOST, RACE_MAP } from '@third-space/config';
import type { PlayerState } from '@third-space/contracts';

export function clearRaceBoosts(player: PlayerState): PlayerState {
  return { ...player, raceSpeedBoostSeconds: 0, raceJumpBoostSeconds: 0 };
}
function remaining(value: number | undefined, dt: number) {
  return Math.max(0, Math.min(RACE_BOOST.maxSeconds, Number.isFinite(value) ? value! : 0) - dt);
}
/** Authority checks overlap during its physics substep; no pickup command is trusted. */
export function stepRaceBoosts(player: PlayerState, dt: number, collect = true): PlayerState {
  const next = { ...player,
    raceSpeedBoostSeconds: remaining(player.raceSpeedBoostSeconds, dt),
    raceJumpBoostSeconds: remaining(player.raceJumpBoostSeconds, dt),
  };
  if (!collect || !player.connected || player.finishedAt !== undefined || (player.respawnTimer ?? 0) > 0) return next;
  const collected = new Set(player.racePickupIds ?? []);
  for (const pickup of RACE_MAP.pickups) {
    if (collected.has(pickup.id) || Math.hypot(player.x - pickup.x, player.y - pickup.y) > RACE_BOOST.pickupRadius) continue;
    collected.add(pickup.id);
    const field = pickup.kind === 'speed' ? 'raceSpeedBoostSeconds' : 'raceJumpBoostSeconds';
    // Refresh duration, never multiply power or indefinitely accumulate time.
    next[field] = Math.min(RACE_BOOST.maxSeconds, Math.max(next[field], RACE_BOOST.durationSeconds));
    next.racePickupCount = (next.racePickupCount ?? 0) + 1;
  }
  next.racePickupIds = [...collected];
  return next;
}
export function raceSpeedMultiplier(player: PlayerState) {
  return (player.raceSpeedBoostSeconds ?? 0) > 0 ? RACE_BOOST.speedMultiplier : 1;
}
export function raceJumpMultiplier(player: PlayerState) {
  return (player.raceJumpBoostSeconds ?? 0) > 0 ? RACE_BOOST.jumpMultiplier : 1;
}
