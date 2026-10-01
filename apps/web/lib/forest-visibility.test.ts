import { describe, expect, it } from "vitest";
import { darknessFill, FOREST_DARKNESS_ALPHA, INDOOR_DARKNESS_ALPHA } from "./forest-visibility";
import { fireAmbienceGain } from "./ambience";
describe("forest visibility and spatial fire", () => {
    it("reveals forest silhouettes while keeping indoor lighting unchanged", () => {
        expect(darknessFill(true)).toBe("rgba(2,8,13,0.82)");
        expect(darknessFill(false)).toBe("rgba(2,8,13,0.97)");
        expect(1 - FOREST_DARKNESS_ALPHA).toBeGreaterThan(4 * (1 - INDOOR_DARKNESS_ALPHA));
    });
    it("fire falls off monotonically and is silent from nine tiles", () => {
        const gains = [0, 3, 6, 8.9, 9, 15, 60].map(distance => fireAmbienceGain(distance, 1));
        for (let i = 1; i < gains.length; i++) expect(gains[i]).toBeLessThanOrEqual(gains[i-1]!);
        expect(gains.slice(4)).toEqual([0, 0, 0]);
        expect(fireAmbienceGain(0, 0)).toBe(0);
        expect(fireAmbienceGain(0, .5)).toBe(.16);
    });
});
