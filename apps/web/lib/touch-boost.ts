import type { PlayerState } from "@third-space/contracts";
import { canSprint } from "@third-space/simulation";
type TouchSprint = { sprint?: boolean };
export function canTouchBoost(player: PlayerState | undefined, now: number): boolean {
  return !!player && canSprint(player, now);
}
export function holdTouchSprint(touch: TouchSprint, player: PlayerState | undefined, now: number): boolean {
  if (!canTouchBoost(player, now)) return false;
  touch.sprint = true; return true;
}
export function releaseTouchSprint(touch: TouchSprint): void { touch.sprint = false; }
