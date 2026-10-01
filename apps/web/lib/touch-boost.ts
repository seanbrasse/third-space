import type { PlayerState } from "@third-space/contracts";
import { requestSprint } from "@third-space/simulation";

type TouchBoost = { boostTap?: boolean };

/** Use the same eligibility rules as the server; the server still decides. */
export function canTouchBoost(player: PlayerState | undefined, now: number): boolean {
  return !!player && requestSprint(player, now) !== player;
}

/** A tap is one request, never a held input or a renewable boost timer. */
export function queueTouchBoost(touch: TouchBoost, player: PlayerState | undefined, now: number): boolean {
  if (touch.boostTap || !canTouchBoost(player, now)) return false;
  touch.boostTap = true;
  return true;
}

export function takeTouchBoost(touch: TouchBoost): boolean {
  const tap = touch.boostTap === true;
  touch.boostTap = false;
  return tap;
}
