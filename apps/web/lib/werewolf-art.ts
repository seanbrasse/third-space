/** Original crouched lycanthrope: high mane/shoulders, long muzzle, clawed hands,
 * torn trousers and four grounded limbs. Six cached gallop poses. Faces right. */
export function werewolfSpriteCanvas(frame: number) {
    const c = document.createElement('canvas'); c.width = 48; c.height = 32;
    const g = c.getContext('2d')!; g.imageSmoothingEnabled = false;
    const r = (x: number, y: number, w: number, h: number, color: string) => { g.fillStyle = color; g.fillRect(x, y, w, h); };
    const f = ((frame % 6) + 6) % 6, stride = [-3, -1, 2, 3, 1, -2][f]!, bob = [0, -1, -2, -1, 0, 1][f]!;
    const dark = '#242932', fur = '#51545b', light = '#75767a', claw = '#c9c6ad';
    r(5, 29, 36, 2, '#18251f');
    // Far hind leg and elongated forearm land in opposite phases.
    r(12 - stride, 20, 5, 8, dark); r(8 - stride, 27, 9, 3, dark);
    r(30 + stride, 17 + bob, 5, 11 - bob, dark); r(30 + stride, 27, 10, 3, dark);
    // Broad, sloping back and ragged human clothing distinguish this from a wolf.
    r(8, 15 + bob, 24, 9, dark); r(12, 12 + bob, 19, 10, fur);
    r(22, 8 + bob, 13, 13, fur); r(24, 6 + bob, 7, 3, dark);
    r(18, 10 + bob, 3, 5, light); r(23, 8 + bob, 3, 6, light);
    r(6, 18 + bob, 11, 6, '#4c485b'); r(8, 23 + bob, 3, 3, '#736174'); r(13, 22 + bob, 2, 4, '#928375');
    // Near legs stretch out into large hands with separately readable claws.
    r(11 + stride, 22, 5, 6, fur); r(6 + stride, 27, 10, 3, fur);
    r(27 - stride, 17 + bob, 5, 10 - bob, fur); r(27 - stride, 26, 11, 4, light);
    for (let i = 0; i < 3; i++) { r(35 - stride, 26 + i, 3, 1, claw); r(5 + stride, 27 + i, 3, 1, claw); }
    // Pointed ears, jutting muzzle, amber eye and exposed lower fangs.
    r(31, 3 + bob, 4, 9, dark); r(32, 5 + bob, 2, 4, '#82747a');
    r(37, 5 + bob, 3, 7, dark); r(30, 9 + bob, 12, 9, fur);
    r(37, 13 + bob, 9, 5, light); r(43, 13 + bob, 3, 3, '#1a2029');
    r(35, 11 + bob, 6, 2, dark); r(38, 11 + bob, 2, 1, '#e1b46d');
    r(38, 18 + bob, 7, 2, dark); r(40, 17 + bob, 1, 3, claw); r(43, 17 + bob, 1, 2, claw);
    r(31, 20 + bob, 3, 2, dark); r(21, 20 + bob, 3, 3, dark);
    return c;
}
