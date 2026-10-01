import type { Facing } from '@third-space/contracts';
import type { ForestMobKind } from '../../../packages/contracts/src/forest-mobs';

/** Original bark masks and brass bindings distinguish hostile echoes from friendly goblin/ogre residents. */
export function forestMobCanvas(kind: ForestMobKind, facing: Facing, frame = 0, windup = false): HTMLCanvasElement {
  const canvas = document.createElement('canvas'); canvas.width = 40; canvas.height = 52;
  const c = canvas.getContext('2d')!; c.imageSmoothingEnabled = false;
  const r = (x: number, y: number, w: number, h: number, color: string) => { c.fillStyle = color; c.fillRect(x, y, w, h); };
  const ink = '#1c2623', bark = '#675443', light = '#9e8760', brass = '#c1ac69', green = '#89a368';
  const step = frame % 2, look = facing === 'left' ? -2 : facing === 'right' ? 2 : 0;
  r(7, 47, 27, 3, '#14221a55');
  if (kind === 'rootbound-guardian') {
    r(6, 19, 29, 22, ink); r(9, 17, 23, 25, bark); r(11, 21, 18, 17, '#75654c');
    r(11, 39, 8, 8 + step, ink); r(24, 39, 8, 9 - step, ink); r(9, 46 + step, 11, 3, bark); r(23, 46 - step, 12, 3, bark);
    r(3, windup ? 13 : 25, 7, 17, ink); r(4, windup ? 14 : 26, 5, 13, '#8e7b52');
    r(32, windup ? 12 : 23, 7, 18, ink); r(33, windup ? 13 : 24, 5, 14, '#8e7b52');
    r(10 + look, 5, 22, 18, ink); r(12 + look, 6, 18, 16, bark); r(13 + look, 7, 5, 8, '#8c7b56');
    r(12, 1, 3, 8, bark); r(8, 0, 6, 3, bark); r(27, 1, 3, 8, bark); r(29, 0, 5, 3, bark);
    if (facing !== 'up') { r(14 + look, 12, 5, 3, ink); r(23 + look, 12, 5, 3, ink); r(15 + look, 12, 3, 2, green); r(24 + look, 12, 3, 2, green); r(18 + look, 18, 7, 2, ink); }
    r(18, 22, 6, 18, '#433e32'); r(19, 24, 4, 3, brass); r(17, 30, 8, 3, brass); r(20, 28, 2, 8, '#dacb95');
    for (const [x, y] of [[8, 24], [29, 31], [12, 35], [25, 8]]) { r(x!, y!, 4, 3, '#667957'); r(x! + 1, y!, 2, 1, '#a2b181'); }
  } else {
    r(12, 24, 18, 17, ink); r(14, 25, 14, 15, '#755643'); r(15, 28, 12, 5, '#936b4b');
    r(14, 39, 5, 8 + step, ink); r(24, 39, 5, 8 - step, ink); r(11, 46 + step, 8, 3, bark); r(24, 46 - step, 8, 3, bark);
    r(6, windup ? 18 : 29, 8, 6, green); r(29, windup ? 17 : 27, 6, 12, '#758a56');
    r(33, windup ? 11 : 21, 3, 19, bark); r(30, windup ? 9 : 19, 8, 5, brass); r(36, windup ? 10 : 20, 2, 5, '#eee0aa');
    r(10 + look, 9, 23, 18, ink); r(11 + look, 10, 21, 15, '#667c4e');
    r(5 + look, 13, 7, 6, ink); r(6 + look, 14, 5, 3, '#9aa769'); r(31 + look, 12, 7, 6, ink); r(32 + look, 13, 5, 3, '#9aa769');
    r(12 + look, 5, 19, 11, bark); r(11 + look, 10, 21, 4, '#453e31'); r(15 + look, 1, 3, 9, '#887654'); r(27 + look, 2, 3, 8, '#887654');
    r(18 + look, 4, 3, 2, light); r(23 + look, 7, 4, 2, light);
    if (facing !== 'up') { r(13 + look, 16, 7, 4, ink); r(24 + look, 16, 7, 4, ink); r(16 + look, 17, 3, 1, '#d1d7a7'); r(25 + look, 17, 3, 1, '#d1d7a7'); r(18 + look, 23, 7, 2, ink); }
    r(15, 33, 14, 3, '#343e32'); r(20, 32, 4, 5, brass); r(21, 33, 2, 3, '#5e573e');
  }
  return canvas;
}
