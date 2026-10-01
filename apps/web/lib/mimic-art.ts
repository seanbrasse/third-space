/** Original shadow impostor. Angular hunched shoulders, hanging overlong arms,
 * split crooked jaw and tiny unequal eyes; not a scaled player or borrowed character. */
export function mimicSpriteCanvas(frame = 0) {
    const c = document.createElement('canvas'); c.width = 40; c.height = 64;
    const g = c.getContext('2d')!; g.imageSmoothingEnabled = false;
    const r = (x: number, y: number, w: number, h: number, color: string) => { g.fillStyle = color; g.fillRect(x, y, w, h); };
    const f = ((frame % 4) + 4) % 4, stride = [0, 3, -1, -3][f]!, tilt = [0, -1, 1, -1][f]!;
    const black = '#090b12', edge = '#444653', rim = '#777281';
    r(8, 62, 24, 2, '#142019');
    // Far leg/arm silhouette, readable muted rim without casting a glow.
    r(22 - stride, 34, 4, 26, edge); r(22 - stride, 59, 9, 3, black);
    r(28, 22, 4, 23, edge); r(30, 43, 3, 11, black); r(31, 51, 5, 2, rim);
    r(15 + stride, 33, 5, 28, black); r(10 + stride, 59, 10, 3, edge);
    // Uneven shoulders and thin bent torso, the hands nearly reach the feet.
    r(12, 16, 3, 6, rim); r(9, 20, 8, 6, edge); r(23, 19, 7, 5, edge);
    r(15, 17, 10, 13, black); r(17, 27, 6, 11, edge); r(18, 29, 4, 9, black);
    r(8, 24, 4, 24, black); r(6, 44, 3, 12, edge); r(4, 54, 7, 2, rim);
    r(4, 55, 1, 4, edge); r(7, 55, 1, 5, edge); r(10, 55, 1, 3, edge);
    r(31, 52, 1, 5, edge); r(34, 52, 1, 4, edge);
    // Elongated, offset skull. One eye sits lower; broken jaw is visibly nonhuman.
    r(15 + tilt, 2, 9, 3, edge); r(13 + tilt, 5, 13, 11, black);
    r(13 + tilt, 5, 2, 7, rim); r(24 + tilt, 7, 2, 8, edge);
    r(16 + tilt, 9, 2, 1, '#c3b7a6'); r(22 + tilt, 10, 1, 2, '#c3b7a6');
    r(17 + tilt, 13, 6, 1, edge); r(19 + tilt, 14, 6, 4, black);
    r(21 + tilt, 16, 3, 1, '#a59ba2'); r(24 + tilt, 14, 1, 5, rim);
    r(17, 18, 2, 3, edge); r(22, 17, 2, 4, edge);
    return c;
}
