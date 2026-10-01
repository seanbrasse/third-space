/** Moonlight reveals scenery silhouettes, without changing flashlight or threat eligibility. */
export const FOREST_DARKNESS_ALPHA = .82;
export const INDOOR_DARKNESS_ALPHA = .97;
export function darknessFill(outside: boolean): string {
    return `rgba(2,8,13,${outside ? FOREST_DARKNESS_ALPHA : INDOOR_DARKNESS_ALPHA})`;
}
