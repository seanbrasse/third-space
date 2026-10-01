/** Visual-only markers on the authored cross, east path and cabin approach.
 * At least ten tiles apart; no collider, interaction or safe-radius metadata. */
export const PATH_TORCHES = [
    { x: 8, y: 24.6 }, { x: 16.5, y: 16 }, { x: 24.7, y: 9 },
    { x: 24.7, y: 39 }, { x: 24.7, y: 54 },
    { x: 40, y: 24.6 }, { x: 54, y: 24.6 }, { x: 68, y: 24.6 },
] as const;
/** Just the entrance and two outer corners; no blanket facade illumination. */
export const ASYLUM_OUTSIDE_TORCHES = [
    { x: 68.5, y: 14.2 }, { x: 63.8, y: 9.4 }, { x: 74.2, y: 9.4 },
] as const;
export const FOREST_TORCHES = [...PATH_TORCHES, ...ASYLUM_OUTSIDE_TORCHES];
export const TORCH_LIGHT = { radius: 1.35, strength: .085 } as const;
/** Same two sine flickers as the campfire, with a fixed phase per post. */
export function torchLight(time: number, index: number, reducedMotion = false) {
    const t = time + index * 719;
    const flicker = reducedMotion ? 1 : 1 + Math.sin(t / 137) * .08 + Math.sin(t / 71) * .04;
    return { radius: TORCH_LIGHT.radius * flicker, strength: TORCH_LIGHT.strength * flicker,
        frame: reducedMotion ? 1 : flicker < .96 ? 0 : flicker > 1.04 ? 2 : 1 };
}
/** Three shared tiny canvases, generated only once per texture cache. */
export function torchSpriteCanvas(frame: number) {
    const c = document.createElement('canvas'); c.width = 12; c.height = 24;
    const g = c.getContext('2d')!; g.imageSmoothingEnabled = false;
    const r = (x: number, y: number, w: number, h: number, color: string) => { g.fillStyle = color; g.fillRect(x, y, w, h); };
    r(3, 22, 7, 2, '#253029'); r(5, 9, 3, 14, '#584638'); r(6, 12, 1, 9, '#7c6343');
    r(3, 8, 7, 4, '#3c3731'); r(4, 9, 5, 1, '#8d7752');
    const top = [5, 4, 3][frame % 3]!;
    r(4, top, 5, 6, '#96522f'); r(5, top + 1, 3, 5, '#c08c46'); r(6, top + 3, 1, 3, '#dfbb72');
    return c;
}
