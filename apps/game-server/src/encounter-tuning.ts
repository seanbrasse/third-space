import type { Point, WorldDefinition } from '@third-space/config';
import { distance, isHomeSegmentWalkable } from '@third-space/simulation';
/** Authority tuning in tile units; audio/rendering never decides pursuit or damage. */
export const ENCOUNTER_TUNING = {
    clownStride: 1.45, clownLurch: .9, wolfStride: 1.2,
    retargetCooldownMs: 2500, retargetAdvantage: 1.5, retargetRatio: .7, retargetWarningMs: 900,
    wolfPeekAdvance: 4.5, wolfPeekAdvanceMs: 1800,
    leapMinDistance: 2.5, leapMaxDistance: 6, leapLength: 3.5,
    leapWindupMs: 800, leapFlightMs: 450, leapRecoveryMs: 400, leapCooldownMs: 6500,
} as const;
/** Swept geometry and the exact closest sanctuary point must be legal, including a chord through firelight. */
export function encounterSegmentSafe(from: Point, to: Point, world: WorldDefinition) {
    if (!isHomeSegmentWalkable(from, to, world.map)) return false;
    const dx = to.x - from.x, dy = to.y - from.y, squared = dx * dx + dy * dy;
    const fire = world.fire!;
    const t = squared ? Math.max(0, Math.min(1, ((fire.x - from.x) * dx + (fire.y - from.y) * dy) / squared)) : 0;
    const closest = { x: from.x + dx * t, y: from.y + dy * t };
    if (distance(closest, fire) <= world.stalker!.safeRadius + .25) return false;
    return true;
}
