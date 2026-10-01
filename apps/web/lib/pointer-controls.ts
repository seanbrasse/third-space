import type {Facing} from '@third-space/contracts';
import type {Point} from '@third-space/config';
/** Device semantics come from this event, never viewport width or touch capability. */
export function pointerAllowsTravel(pointer: {wasTouch?: boolean}): boolean {
  return pointer.wasTouch === true;
}
export function pointerFacing(from: Point, to: Point): Facing | undefined {
  const dx=to.x-from.x,dy=to.y-from.y;
  if(!Number.isFinite(dx)||!Number.isFinite(dy)||Math.hypot(dx,dy)<.12)return;
  return Math.abs(dx)>Math.abs(dy)?dx>0?'right':'left':dy>0?'down':'up';
}
