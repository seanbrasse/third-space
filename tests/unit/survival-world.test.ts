import { it, expect } from 'vitest';
import { createForestSurvival } from '../../apps/game-server/src/survival-world';
import { FOREST_MAP } from '@third-space/config';
import { isHomeWalkable } from '@third-space/simulation';
it('forest apple and backpack positions are finite, outdoors, collision-free and outside fire sanctuary', () => { const s = createForestSurvival(() => .5); s.tick(0, []); const snap = s.snapshot(); expect(snap.appleTrees.length).toBeGreaterThanOrEqual(8); expect(snap.backpacks).toHaveLength(2); for (const p of [...snap.appleTrees, ...snap.backpacks]) {
    expect(isHomeWalkable(p, FOREST_MAP)).toBe(true);
    expect(Math.hypot(p.x - 24, p.y - 24)).toBeGreaterThan(12);
} expect(new Set(snap.appleTrees.map(t => t.id)).size).toBe(snap.appleTrees.length); });
