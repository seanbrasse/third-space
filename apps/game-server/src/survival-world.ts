import { FOREST_MAP, getWorld } from '@third-space/config';
import { isHomeWalkable, isHomeSegmentWalkable } from '@third-space/simulation';
import { SurvivalInventory, type SurvivalOptions } from './survival-inventory';
/** Existing forest trees supply collision-free harvest points; apples render above this ground point. */
export function createForestSurvival(random: () => number = Math.random, persistApples?:SurvivalOptions['persistApples']) {
    const fire = getWorld('forest').fire!;
    const points = FOREST_MAP.furniture.filter(f => f.kind === 'tree').map(f => ({ id: f.id, x: f.footprint.x + f.footprint.width / 2, y: f.footprint.y + f.footprint.height + .15 })).filter(p => isHomeWalkable(p, FOREST_MAP) && Math.hypot(p.x - fire.x, p.y - fire.y) > 12);
    const trees = points.filter((_, i) => i % 13 === 0).slice(0, 16);
    return new SurvivalInventory({ random, persistApples, trees, spawnPoints: points, safe: p => Math.hypot(p.x - fire.x, p.y - fire.y) <= 9, walkable: p => isHomeWalkable(p, FOREST_MAP), lineOfSight: (a, b) => isHomeSegmentWalkable(a, b, FOREST_MAP) });
}
