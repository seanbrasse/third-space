import type { PlayerState } from "@third-space/contracts";

/** A full charge buys 1.5 seconds; refill starts when the boost ends. */
export const SPRINT = Object.freeze({ multiplier: 1.6, durationMs: 1_500, refillMs: 5_000 });

export function requestSprint(player: PlayerState, now: number): PlayerState {
  if (!Number.isFinite(now) || !player.connected || player.mode !== "home" ||
      player.seatId || player.roastingAt !== undefined || player.respawnAt ||
      now < (player.sprintReadyAt ?? 0)) return player;
  return { ...player, sprintUntil: now + SPRINT.durationMs,
    sprintReadyAt: now + SPRINT.durationMs + SPRINT.refillMs };
}

/** Preserve the spent charge across area/world changes and transport drops. */
export function cancelSprint(player: PlayerState, now: number): void {
  if ((player.sprintUntil ?? 0) > now) {
    player.sprintUntil = now;
    player.sprintReadyAt = now + SPRINT.refillMs;
  }
}

export function sprintStatus(player: PlayerState, now: number) {
  const until = player.sprintUntil ?? 0, ready = player.sprintReadyAt ?? 0;
  if (now < until) return { phase: "boosting" as const, fraction: Math.max(0, Math.min(1, (until - now) / SPRINT.durationMs)) };
  if (now < ready) return { phase: "refilling" as const, fraction: Math.max(0, Math.min(1, 1 - (ready - now) / SPRINT.refillMs)) };
  return { phase: "ready" as const, fraction: 1 };
}

/** Average speed over the server-owned interval, including boost boundaries. */
export function sprintMultiplier(player: PlayerState, now: number, seconds: number): number {
  if (!Number.isFinite(now) || !Number.isFinite(seconds) || seconds <= 0 ||
      !player.connected || player.mode !== "home" || player.seatId ||
      player.roastingAt !== undefined || player.respawnAt) return 1;
  const until = player.sprintUntil ?? 0, end = now + seconds * 1000;
  const boostedMs = Math.max(0, Math.min(end, until) - Math.max(now, until - SPRINT.durationMs));
  return 1 + (SPRINT.multiplier - 1) * boostedMs / (seconds * 1000);
}
