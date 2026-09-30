import { HOME_MAP } from "@third-space/config";
import { ROOM_PALETTE as P } from "./pixel-art";

/** Original walnut-and-velvet lounge, drawn on a square tile coordinate system. */
export function homeFloorCanvas(tile: number) {
  const canvas = document.createElement("canvas");
  const width = HOME_MAP.width * tile,
    height = HOME_MAP.height * tile;
  canvas.width = width;
  canvas.height = height;
  const c = canvas.getContext("2d")!;
  c.imageSmoothingEnabled = false;
  const r = (x: number, y: number, w: number, h: number, color: string) => {
    c.fillStyle = color;
    c.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  };
  const diamond = (x: number, y: number, size: number, color: string) => {
    for (let row = -size; row <= size; row++) {
      const half = size - Math.abs(row);
      r(x - half, y + row, half * 2 + 1, 1, color);
    }
  };
  r(0, 0, width, height, P.ink);
  for (let y = HOME_MAP.wallHeight; y < HOME_MAP.height - 1; y++)
    for (let x = 1; x < HOME_MAP.width - 1; x++) {
      const px = x * tile,
        py = y * tile,
        tone = (x * 7 + y * 3) % 5;
      r(
        px,
        py,
        tile,
        tile,
        ["#84523b", "#8c5a40", "#79503b", "#8b573d", "#925f43"][tone],
      );
      // Grain and staggered boards are texture inside square physical tiles.
      for (let row = 0; row < 2; row++) {
        r(px, py + row * 16, tile, 1, "#50342b");
        r(px, py + row * 16 + 1, tile, 1, "#a8734e");
        const end = ((x + y + row) % 2) * 16;
        r(px + end, py + row * 16 + 2, 1, 13, "#66412e");
        r(px + 4, py + row * 16 + 7, 10 + (tone % 3) * 4, 1, "#996344");
        r(px + 13, py + row * 16 + 10, 13, 1, "#714a34");
      }
      if ((x * 3 + y) % 11 === 0) {
        r(px + 20, py + 5, 5, 1, "#66432f");
        r(px + 18, py + 6, 9, 1, "#aa7650");
        r(px + 20, py + 7, 5, 1, "#66432f");
      }
    }
  const wall = HOME_MAP.wallHeight * tile;
  r(0, 0, width, wall, P.wallDark);
  r(4, 4, width - 8, wall - 8, P.wall);
  for (let x = 6; x < width - 8; x += 8) {
    r(x, 5, 3, wall - 10, P.wallLight);
    r(x + 3, 5, 1, wall - 10, "#3a6244");
  }
  r(0, 0, width, 4, P.woodDark);
  r(3, 3, width - 6, 2, P.woodLight);
  r(0, wall - 5, width, 5, P.woodDark);
  r(5, wall - 5, width - 10, 1, P.woodLight);
  r(0, wall, 8, height - tile - wall, P.woodDark);
  r(8, wall, 4, height - tile - wall, P.woodLight);
  r(width - 12, wall, 4, height - tile - wall, P.woodLight);
  r(width - 8, wall, 8, height - tile - wall, P.woodDark);
  r(0, height - tile, width, tile, P.woodDark);
  r(12, height - tile + 2, width - 24, 4, P.woodLight);
  r(12, height - tile + 6, width - 24, 2, P.wood);
  for (const x of [43, 207, 397, 533]) {
    r(x - 3, 4, 51, 33, P.woodDark);
    r(x - 1, 6, 47, 28, P.gold);
    r(x + 2, 8, 41, 24, "#203c43");
    r(x + 4, 9, 37, 21, "#779995");
    r(x + 4, 9, 11, 10, "#aac9b4");
    r(x + 18, 8, 2, 24, P.cream);
    r(x + 2, 20, 41, 2, P.cream);
    r(x - 5, 33, 55, 3, P.woodLight);
  }
  const rug = HOME_MAP.furniture.find((f) => f.kind === "rug")!.footprint;
  const rugArt = (
    x: number,
    y: number,
    w: number,
    h: number,
    secondary = false,
  ) => {
    r(x + 2, y + 3, w, h, "#271f2240");
    r(x, y, w, h, P.velvetDark);
    r(x + 2, y + 2, w - 4, h - 4, P.gold);
    r(x + 4, y + 4, w - 8, h - 8, secondary ? P.wallDark : P.velvet);
    r(x + 8, y + 8, w - 16, h - 16, secondary ? "#3b5945" : "#782b42");
    for (let i = 12; i < w - 10; i += 12) {
      diamond(x + i, y + 6, 2, P.cream);
      diamond(x + i, y + h - 7, 2, P.cream);
    }
    for (let i = 16; i < h - 12; i += 12) {
      diamond(x + 6, y + i, 2, P.cream);
      diamond(x + w - 7, y + i, 2, P.cream);
    }
    for (let dx = 21; dx < w - 18; dx += 26)
      for (let dy = 22; dy < h - 17; dy += 24) {
        diamond(x + dx, y + dy, 5, secondary ? "#527155" : "#ad485a");
        diamond(x + dx, y + dy, 2, P.gold);
      }
    for (let i = 5; i < w - 4; i += 4) {
      r(x + i, y - 2, 1, 2, P.cream);
      r(x + i, y + h, 1, 2, P.cream);
    }
  };
  rugArt(rug.x * tile, rug.y * tile, rug.width * tile, rug.height * tile);
  // A woven gathering runner gives eight friends a clear, warm landing area.
  rugArt(7 * tile, 11.4 * tile, 6 * tile, 3.1 * tile, true);
  r(9 * tile, 17 * tile, 2 * tile, tile, P.woodDark);
  r(9 * tile + 3, 17 * tile + 3, 2 * tile - 6, tile - 6, P.gold);
  for (let x = 9 * tile + 6; x < 11 * tile - 6; x += 4)
    r(x, 17 * tile + 5, 1, tile - 10, "#9c7642");
  // A small original landscape and clock tie the reading nook to the garden.
  const fx = 12.5 * tile,
    fy = 1.35 * tile;
  r(fx, fy, 44, 31, P.ink);
  r(fx + 2, fy + 2, 40, 27, P.woodLight);
  r(fx + 5, fy + 5, 34, 21, "#7aabac");
  r(fx + 7, fy + 7, 10, 3, P.cream);
  r(fx + 21, fy + 9, 12, 2, "#bbd4ba");
  r(fx + 5, fy + 20, 34, 6, P.wall);
  r(fx + 10, fy + 17, 9, 7, P.wallLight);
  r(fx + 27, fy + 16, 6, 8, P.wallDark);
  const cx = 7 * tile,
    cy = 1.65 * tile;
  diamond(cx, cy, 11, P.ink);
  diamond(cx, cy, 9, P.gold);
  diamond(cx, cy, 7, P.cream);
  r(cx, cy - 5, 1, 6, P.woodDark);
  r(cx, cy, 4, 1, P.woodDark);
  return canvas;
}
