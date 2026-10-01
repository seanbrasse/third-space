import type { PlayerState } from "@third-space/contracts";

/** Three seconds of sprint; a ten-second refill after a short rest. */
export const SPRINT = Object.freeze({ multiplier: 1.6, durationMs: 3_000, refillMs: 10_000,
  restMs: 500, exhaustionMs: 2_000, exhaustedMultiplier: .75 });
const charge = (p: PlayerState) => Math.max(0, Math.min(1, Number.isFinite(p.stamina) ? p.stamina! : 1));
function eligible(p: PlayerState) { return p.connected && p.mode === "home" && !p.seatId && p.roastingAt === undefined && !p.respawnAt; }
export function canSprint(p: PlayerState, now: number) {
  return eligible(p) && Number.isFinite(now) && now >= (p.sprintExhaustedUntil ?? 0) && !p.sprintNeedsRelease && charge(p) > 1e-9;
}
/** Compatibility for callers checking eligibility. This never spends or starts a timed boost. */
export function requestSprint(p: PlayerState, now: number): PlayerState { return canSprint(p, now) ? { ...p } : p; }
/** Stops intent while retaining the reserve and exhaustion recovery across transport/area changes. */
export function cancelSprint(p: PlayerState, _now: number): void { p.sprinting = false; p.sprintNeedsRelease = false; }

/** Pure fixed-step resource integration, shared by authority and client prediction. */
export function stepSprint(player: PlayerState, held: boolean, moving: boolean, now: number, seconds: number) {
  const next = { ...player, stamina: charge(player), sprinting: false };
  const ms = Number.isFinite(seconds) ? Math.max(0, Math.min(.25, seconds)) * 1000 : 0;
  if (!Number.isFinite(now) || !ms) return { player: next, multiplier: 1 };
  if (!held) next.sprintNeedsRelease = false;
  if (!next.connected || next.mode !== "home" || next.respawnAt) return { player: next, multiplier: 1 };
  const end = now + ms;
  if (canSprint(next, now) && held && moving) {
    const sprintMs = Math.min(ms, next.stamina * SPRINT.durationMs);
    next.stamina = Math.max(0, next.stamina - sprintMs / SPRINT.durationMs);
    next.sprinting = sprintMs > 0;
    next.sprintRecoverAfter = end + SPRINT.restMs;
    if (next.stamina <= 1e-9) {
      next.stamina = 0; next.sprintNeedsRelease = true;
      next.sprintExhaustedUntil = now + sprintMs + SPRINT.exhaustionMs;
    }
    const remainder = ms - sprintMs;
    return { player: next, multiplier: (SPRINT.multiplier * sprintMs + SPRINT.exhaustedMultiplier * remainder) / ms };
  }
  // Never charge reconnect gaps or server stalls: only this bounded simulation interval counts.
  const refillMs = Math.max(0, end - Math.max(now, next.sprintRecoverAfter ?? 0));
  next.stamina = Math.min(1, next.stamina + refillMs / SPRINT.refillMs);
  const tiredMs = Math.max(0, Math.min(end, next.sprintExhaustedUntil ?? 0) - now);
  return { player: next, multiplier: 1 - (1 - SPRINT.exhaustedMultiplier) * tiredMs / ms };
}
export function sprintStatus(player: PlayerState, now: number) {
  const fraction = charge(player);
  return { phase: now < (player.sprintExhaustedUntil ?? 0) ? "exhausted" as const :
    player.sprinting ? "boosting" as const : fraction < 1 ? "refilling" as const : "ready" as const, fraction };
}
/** Read-only preview, integration belongs to stepSprint. */
export function sprintMultiplier(player: PlayerState, now: number, seconds: number): number {
  return stepSprint(player, !!player.sprinting, true, now, seconds).multiplier;
}
