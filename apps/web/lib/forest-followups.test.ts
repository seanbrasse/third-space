import { describe, expect, it } from 'vitest';
import { PATH_TORCHES, ASYLUM_OUTSIDE_TORCHES, FOREST_TORCHES, TORCH_LIGHT, torchLight } from './forest-torches';
import { ASYLUM_WAYFINDING_LIGHTS } from './asylum-wayfinding';
import { getWorld } from '@third-space/config';
import { distance, isHomeWalkable } from '@third-space/simulation';
describe('small local wayfinding lights', () => {
    it('uses eight widely spaced path hints and three separate exterior hints without new colliders', () => {
        expect(PATH_TORCHES).toHaveLength(8); expect(ASYLUM_OUTSIDE_TORCHES).toHaveLength(3);
        const world = getWorld('forest');
        for (const post of FOREST_TORCHES) expect(isHomeWalkable(post, world.map)).toBe(true);
        for (let i = 0; i < PATH_TORCHES.length; i++) for (let j = i + 1; j < PATH_TORCHES.length; j++) {
            const separation = distance(PATH_TORCHES[i]!, PATH_TORCHES[j]!);
            expect(separation).toBeGreaterThan(10); expect(separation - 2 * TORCH_LIGHT.radius * 1.12).toBeGreaterThan(7);
        }
        expect(world.stalker?.safeRadius).toBe(9);
    });
    it('bounds torch glow far below the fire, uses tiny pools and freezes flicker with reduced motion', () => {
        for (let time = 0; time < 20000; time += 37) for (let index = 0; index < FOREST_TORCHES.length; index++) {
            const light = torchLight(time, index); expect(light.radius).toBeLessThanOrEqual(1.512);
            expect(light.strength).toBeLessThanOrEqual(.0952); expect(light.strength).toBeGreaterThan(0);
            expect([0, 1, 2]).toContain(light.frame);
        }
        expect(torchLight(0, 0, true)).toEqual(torchLight(999999, 10, true));
        expect(torchLight(0, 0, true)).toEqual({ radius: 1.35, strength: .085, frame: 1 });
    });
    it('limits stronger asylum guidance to the charger and entrance/exit landing', () => {
        expect(ASYLUM_WAYFINDING_LIGHTS).toHaveLength(2);
        const doorway = ASYLUM_WAYFINDING_LIGHTS[0]!, charger = ASYLUM_WAYFINDING_LIGHTS[1]!;
        expect(distance(doorway, { x: 10, y: 16.5 })).toBeLessThan(doorway.radius);
        expect(distance(charger, { x: 16.5, y: 9.5 })).toBeLessThan(charger.radius);
        for (const light of ASYLUM_WAYFINDING_LIGHTS) {
            expect(light.radius).toBeLessThanOrEqual(2.4); expect(distance(light, { x: 3, y: 5 })).toBeGreaterThan(light.radius);
        }
    });
});
