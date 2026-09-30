import type { AvatarConfig, Facing } from "@third-space/contracts";

/** Original pixel artwork. All game textures and customization previews share these palettes. */
export function shade(hex: string, amount: number): string {
  const value = parseInt(hex.slice(1), 16);
  const channel = (shift: number) =>
    Math.max(0, Math.min(255, ((value >> shift) & 255) + amount))
      .toString(16)
      .padStart(2, "0");
  return `#${channel(16)}${channel(8)}${channel(0)}`;
}
export function drawAvatarCanvas(
  canvas: HTMLCanvasElement,
  avatar: AvatarConfig,
  facing: Facing = "down",
  frame = 0,
  seated = false,
) {
  canvas.width = 24;
  canvas.height = 32;
  const c = canvas.getContext("2d");
  if (!c) return;
  c.imageSmoothingEnabled = false;
  c.clearRect(0, 0, 24, 32);
  const pixel = (x: number, y: number, w: number, h: number, fill: string) => {
    c.fillStyle = fill;
    c.fillRect(x, y, w, h);
  };
  const skin = avatar.skinColor || avatar.color;
  const hair = avatar.hairColor || "#563c36";
  const shirt = avatar.clothingColor || "#688f79";
  const pants = avatar.trouserColor || "#43556e";
  const ink = ROOM_PALETTE.ink;
  const step = seated ? 0 : frame % 4 === 1 ? 1 : frame % 4 === 3 ? -1 : 0;
  c.fillStyle = "#28372f38";
  c.fillRect(5, 29, 14, 2);
  c.fillRect(7, 28, 10, 4);
  // Two walking legs, boots, sleeves and a shaded torso form a 24×32 sprite.
  pixel(7, 24, 4, seated ? 3 : 5 + step, shade(pants, -24));
  pixel(13, 24, 4, seated ? 3 : 5 - step, pants);
  pixel(6, seated ? 26 : 28 + step, 5, 2, ink);
  pixel(13, seated ? 26 : 28 - step, 6, 2, ink);
  pixel(6, 16, 12, 9, ink);
  pixel(7, 16, 10, 8, shirt);
  pixel(8, 17, 2, 6, shade(shirt, 24));
  pixel(15, 18, 2, 6, shade(shirt, -24));
  pixel(4, 17 + step, 3, 7, shade(shirt, -18));
  pixel(17, 17 - step, 3, 7, shirt);
  pixel(4, 23 + step, 3, 2, skin);
  pixel(17, 23 - step, 3, 2, skin);
  pixel(10, 14, 4, 3, shade(skin, -16));
  if (avatar.outfit === "overalls") {
    pixel(8, 18, 2, 7, pants);
    pixel(14, 18, 2, 7, pants);
    pixel(9, 21, 6, 4, pants);
    pixel(9, 20, 1, 1, "#e9cc87");
    pixel(14, 20, 1, 1, "#e9cc87");
  } else if (avatar.outfit === "jacket") {
    pixel(11, 17, 2, 7, shade(shirt, -40));
    pixel(9, 17, 1, 4, shade(shirt, 40));
    pixel(14, 17, 1, 4, shade(shirt, 40));
  } else if (avatar.outfit === "hoodie") {
    pixel(8, 16, 2, 2, shade(shirt, -35));
    pixel(14, 16, 2, 2, shade(shirt, -35));
    pixel(10, 20, 1, 2, "#eadfbc");
    pixel(13, 20, 1, 2, "#eadfbc");
    pixel(9, 23, 6, 1, shade(shirt, -26));
  } else {
    pixel(4, 20 + step, 3, 3, skin);
    pixel(17, 20 - step, 3, 3, skin);
    pixel(10, 17, 4, 1, shade(shirt, -35));
  }
  // Broad head and expressive face borrow only the proportions of handheld RPGs.
  pixel(7, 3, 10, 2, ink);
  pixel(5, 5, 14, 9, ink);
  pixel(7, 14, 10, 2, ink);
  pixel(7, 5, 10, 9, skin);
  pixel(6, 9, 1, 4, shade(skin, -20));
  pixel(17, 9, 1, 4, shade(skin, -20));
  pixel(7, 6, 2, 6, shade(skin, 20));
  pixel(15, 8, 2, 6, shade(skin, -18));
  if (facing !== "up") {
    if (facing === "down") {
      pixel(9, 10, 2, 3, ink);
      pixel(14, 10, 2, 3, ink);
      pixel(9, 10, 1, 1, "#fff4df");
      pixel(14, 10, 1, 1, "#fff4df");
      pixel(11, 14, 3, 1, shade(skin, -60));
    } else {
      pixel(facing === "left" ? 7 : 15, 10, 2, 3, ink);
      pixel(facing === "left" ? 5 : 18, 12, 2, 2, skin);
      pixel(10, 14, 4, 1, shade(skin, -40));
    }
  }
  if (avatar.hair !== "none") {
    pixel(7, 2, 10, 2, shade(hair, -24));
    pixel(5, 4, 14, 5, hair);
    pixel(6, 4, 5, 1, shade(hair, 28));
    pixel(6, 5, 2, 2, shade(hair, 18));
    pixel(5, 7, 3, 6, shade(hair, -20));
    pixel(16, 7, 3, 6, shade(hair, -24));
    if (facing === "up") {
      pixel(7, 8, 10, 7, hair);
      pixel(8, 10, 2, 4, shade(hair, 14));
      pixel(15, 9, 2, 5, shade(hair, -18));
    } else {
      pixel(7, 8, 3, 2, hair);
      pixel(11, 8, 2, 1, hair);
      pixel(15, 8, 2, 2, hair);
    }
    if (avatar.hair === "long") {
      pixel(4, 9, 3, 10, shade(hair, -22));
      pixel(17, 9, 3, 10, hair);
      pixel(18, 10, 1, 7, shade(hair, 20));
    }
    if (avatar.hair === "curly") {
      for (const [x, y] of [
        [4, 5],
        [7, 1],
        [11, 2],
        [15, 1],
        [18, 5],
        [4, 9],
        [18, 9],
      ]) {
        pixel(x, y, 3, 3, shade(hair, -15));
        pixel(x, y, 2, 1, shade(hair, 25));
      }
    }
  }
  if (avatar.accessory === "beanie") {
    pixel(5, 3, 14, 4, shade(shirt, -28));
    pixel(6, 2, 12, 2, shirt);
    pixel(4, 7, 16, 2, shade(shirt, 24));
    pixel(12, 1, 3, 2, "#e7c078");
  }
  if (avatar.accessory === "headphones") {
    pixel(5, 3, 14, 1, ink);
    pixel(4, 6, 3, 7, ink);
    pixel(18, 6, 3, 7, ink);
    pixel(4, 8, 2, 3, "#dfb964");
    pixel(19, 8, 2, 3, "#dfb964");
  }
  if (avatar.accessory === "glasses" && facing !== "up") {
    pixel(8, 10, 4, 3, ink);
    pixel(13, 10, 4, 3, ink);
    pixel(12, 11, 1, 1, ink);
    pixel(9, 11, 2, 1, "#8dabbb");
    pixel(14, 11, 2, 1, "#8dabbb");
  }
}

export function avatarPixelCanvas(
  avatar: AvatarConfig,
  facing: Facing = "down",
  frame = 0,
  seated = false,
) {
  const canvas = document.createElement("canvas");
  drawAvatarCanvas(canvas, avatar, facing, frame, seated);
  return canvas;
}

export const ROOM_PALETTE = Object.freeze({
  ink: "#241c20",
  woodDark: "#432b29",
  wood: "#714334",
  woodLight: "#a56d49",
  wallDark: "#1d382d",
  wall: "#31553c",
  wallLight: "#53734e",
  velvetDark: "#571f32",
  velvet: "#8f2f45",
  velvetLight: "#bf5260",
  gold: "#c69b52",
  cream: "#f0dfb7",
});

/** Each original texture occupies its shared furniture footprint at native resolution. */
export function furnitureCanvas(
  kind: string,
  width: number,
  height: number,
  variant = "",
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const c = canvas.getContext("2d")!;
  c.imageSmoothingEnabled = false;
  const r = (x: number, y: number, w: number, h: number, color: string) => {
    if (w <= 0 || h <= 0) return;
    c.fillStyle = color;
    c.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  };
  const p = ROOM_PALETTE;
  const cx = width / 2;
  const grain = (x: number, y: number, w: number, h: number) => {
    for (let row = y + 5; row < y + h - 2; row += 7) {
      r(x + 3, row, w - 6, 1, p.woodDark);
      r(x + 6 + (row % 3), row - 1, Math.max(2, w / 3), 1, p.woodLight);
    }
  };
  const cup = (x: number, y: number, color: string) => {
    r(x, y, 8, 7, p.ink);
    r(x + 1, y + 1, 6, 5, color);
    r(x + 1, y + 1, 6, 1, p.cream);
    r(x + 8, y + 2, 2, 3, p.gold);
    r(x + 2, y + 2, 4, 2, p.woodDark);
  };
  r(3, height - 5, width - 6, 4, "#211b2045");
  if (kind === "couch") {
    // Stepped rolled arms and four tufted back panels above the safe front cushions.
    r(7, 2, width - 14, 3, p.ink);
    r(4, 5, width - 8, height - 11, p.ink);
    r(7, 5, width - 14, 27, p.velvetDark);
    r(10, 6, width - 20, 2, p.velvetLight);
    const panel = (width - 24) / 4;
    for (let i = 0; i < 4; i++) {
      const x = 12 + i * panel;
      r(x, 9, panel - 2, 22, p.velvet);
      r(x + 2, 10, panel - 6, 2, p.velvetLight);
      r(x + panel / 2 - 2, 18, 4, 3, p.velvetDark);
      r(x + panel / 2 - 1, 18, 1, 1, p.gold);
      r(x, 35, panel - 2, height - 47, p.velvet);
      r(x + 2, 36, panel - 6, 2, p.velvetLight);
      r(x, height - 12, panel - 2, 4, p.velvetDark);
    }
    for (const x of [2, width - 13]) {
      r(x + 2, 22, 9, 4, p.ink);
      r(x, 26, 13, height - 35, p.ink);
      r(x + 2, 25, 9, height - 35, p.velvet);
      r(x + 3, 26, 7, 3, p.velvetLight);
      r(x + 3, height - 15, 7, 5, p.velvetDark);
    }
    r(12, height - 7, 5, 5, p.woodDark);
    r(width - 17, height - 7, 5, 5, p.woodDark);
    r(13, height - 7, 3, 1, p.gold);
    r(width - 16, height - 7, 3, 1, p.gold);
    r(17, 24, 15, 13, p.woodDark);
    r(18, 23, 13, 12, p.cream);
    r(20, 25, 9, 8, "#d1b88b");
    r(23, 27, 3, 3, p.velvet);
    r(width - 34, 24, 15, 13, p.ink);
    r(width - 33, 23, 13, 12, p.wall);
    r(width - 31, 25, 9, 1, p.wallLight);
    r(width - 27, 26, 1, 7, p.gold);
  } else if (kind === "table" || kind === "coffee-table") {
    const coffee = kind === "coffee-table" || variant.includes("coffee");
    const topHeight = height - (coffee ? 11 : 13);
    r(7, height - 13, 5, 11, p.ink);
    r(width - 12, height - 13, 5, 11, p.ink);
    r(8, height - 12, 2, 9, p.woodLight);
    r(width - 11, height - 12, 2, 9, p.wood);
    r(5, 2, width - 10, 3, p.ink);
    r(2, 5, width - 4, topHeight - 3, p.ink);
    r(4, 5, width - 8, topHeight - 5, p.wood);
    r(6, 5, width - 12, 2, p.woodLight);
    r(4, topHeight - 3, width - 8, 4, p.woodDark);
    grain(5, 7, width - 10, topHeight - 10);
    if (coffee) {
      // A low polished table with a book, saucer and glass vase.
      r(12, 13, 23, 15, p.ink);
      r(13, 12, 21, 13, p.wallDark);
      r(15, 14, 2, 10, p.gold);
      r(19, 15, 11, 1, p.cream);
      r(19, 18, 8, 1, p.cream);
      r(width - 29, 22, 15, 6, p.cream);
      cup(width - 26, 16, p.velvetLight);
      r(cx + 1, 11, 9, 9, "#75978c");
      r(cx + 3, 9, 5, 3, "#b4c9b0");
      r(cx + 4, 5, 1, 6, p.wallLight);
      r(cx + 1, 5, 7, 3, p.velvet);
    } else {
      // The larger gathering table has a woven runner and an unfinished board game.
      r(cx - 10, 7, 20, topHeight - 9, p.velvetDark);
      r(cx - 8, 7, 16, topHeight - 10, p.velvet);
      r(cx - 5, 8, 1, topHeight - 12, p.gold);
      r(cx + 4, 8, 1, topHeight - 12, p.gold);
      r(13, 18, 21, 18, p.ink);
      for (let y = 0; y < 4; y++)
        for (let x = 0; x < 4; x++)
          r(14 + x * 5, 19 + y * 4, 5, 4, (x + y) % 2 ? p.woodLight : p.cream);
      r(20, 20, 3, 3, p.velvetDark);
      r(29, 28, 3, 3, p.wallDark);
      cup(width - 24, 12, p.wallLight);
      cup(width - 27, 32, p.cream);
      r(cx - 4, 18, 8, 13, p.cream);
      r(cx - 2, 21, 4, 1, p.wood);
      r(cx - 2, 24, 3, 1, p.wood);
    }
  } else if (kind === "chair" || kind === "stool") {
    const backHeight = Math.max(9, Math.round(height * 0.5));
    const seatY = backHeight + 1;
    r(5, 1, width - 10, 2, p.ink);
    r(3, 3, width - 6, backHeight - 2, p.woodDark);
    r(5, 3, width - 10, backHeight - 4, p.velvet);
    r(6, 3, width - 12, 2, p.velvetLight);
    r(cx - 1, Math.floor(backHeight / 2), 2, 2, p.velvetDark);
    r(cx, Math.floor(backHeight / 2), 1, 1, p.gold);
    r(3, seatY, width - 6, height - seatY - 6, p.ink);
    r(5, seatY, width - 10, height - seatY - 9, p.velvet);
    r(5, seatY, width - 10, 2, p.velvetLight);
    r(5, height - 10, width - 10, 2, p.velvetDark);
    r(2, backHeight - 2, 3, height - backHeight - 4, p.wood);
    r(width - 5, backHeight - 2, 3, height - backHeight - 4, p.wood);
    r(3, backHeight - 2, 2, 2, p.gold);
    r(width - 5, backHeight - 2, 2, 2, p.gold);
    r(5, height - 7, 3, 6, p.woodDark);
    r(width - 8, height - 7, 3, 6, p.woodDark);
  } else if (kind === "bookshelf" || kind === "bookcase") {
    r(2, 1, width - 4, height - 5, p.ink);
    r(4, 3, width - 8, height - 9, p.woodDark);
    r(3, 2, width - 6, 3, p.woodLight);
    r(4, 6, 3, height - 14, p.wood);
    r(width - 7, 6, 3, height - 14, p.wood);
    const colors = [p.wall, p.velvet, "#677e91", p.gold, "#a58296"];
    for (const [row, y] of [7, 25, 43].entries()) {
      r(6, y + 14, width - 12, 3, p.woodLight);
      r(6, y + 17, width - 12, 1, p.ink);
      const limit = row === 1 ? width / 2 : row === 2 ? width - 25 : width - 8;
      let x = 9;
      for (let i = 0; x < limit - 4; i++) {
        const bookWidth = 3 + (i % 3);
        const bookHeight = 8 + ((i * 3 + row * 2) % 6);
        r(
          x,
          y + 14 - bookHeight,
          bookWidth,
          bookHeight,
          colors[(i + row) % colors.length]!,
        );
        r(x, y + 16 - bookHeight, bookWidth, 1, p.cream);
        if (i % 2 === 0) r(x + 1, y + 12, bookWidth - 2, 1, p.gold);
        x += bookWidth + 1;
      }
    }
    r(width - 23, 31, 12, 8, "#789582");
    r(width - 21, 28, 8, 4, p.cream);
    r(width - 18, 24, 1, 6, p.wallLight);
    r(width - 23, 25, 10, 3, p.wall);
    r(width - 24, 45, 14, 11, p.gold);
    r(width - 22, 47, 10, 7, p.woodDark);
    r(width - 20, 49, 6, 3, p.velvet);
    r(6, height - 8, width - 12, 3, p.wood);
  } else if (kind === "plant") {
    const base = height - 18;
    r(cx - 10, base + 1, 20, 3, p.ink);
    r(cx - 8, base + 4, 16, 12, "#9a563c");
    r(cx - 6, base + 5, 4, 9, "#bf7c4f");
    r(cx + 5, base + 6, 2, 9, p.woodDark);
    r(cx - 11, base, 22, 4, "#ba764a");
    r(cx - 8, base, 16, 1, p.gold);
    for (const [dx, dy] of [
      [-8, -9],
      [8, -11],
      [-7, -21],
      [6, -26],
      [0, -15],
      [-1, -29],
      [10, -19],
    ]) {
      for (let i = 0; i < 8; i++)
        r(cx + (dx * i) / 8, base + (dy * i) / 8, 2, 2, p.wallDark);
      for (let row = 0; row < 11; row++) {
        const half = Math.min(row + 1, 11 - row, 5);
        r(cx + dx - half, base + dy + row - 4, half * 2, 1, p.wallDark);
        r(
          cx + dx - half + 1,
          base + dy + row - 4,
          Math.max(1, half * 2 - 2),
          1,
          row < 5 ? "#5e8951" : p.wall,
        );
        r(cx + dx, base + dy + row - 4, 1, 1, "#9bae67");
      }
    }
    r(cx - 1, base - 11, 2, 11, p.wallDark);
  } else if (kind === "lamp") {
    r(cx - 7, height - 6, 14, 4, p.ink);
    r(cx - 5, height - 7, 10, 3, p.gold);
    r(cx - 2, 14, 4, height - 21, p.woodDark);
    r(cx - 1, 14, 2, height - 21, p.gold);
    r(cx - 5, 1, 10, 2, p.ink);
    for (let y = 3; y < 16; y++) {
      const half = 5 + Math.floor((y - 3) / 3);
      r(cx - half - 1, y, half * 2 + 2, 1, p.ink);
      r(cx - half, y, half * 2, 1, "#d5ac64");
      r(cx - 3, y, 3, 1, p.cream);
      r(cx + 4, y, 1, 1, p.gold);
    }
    r(2, 15, width - 4, 3, p.woodDark);
    r(3, 15, width - 6, 1, p.gold);
    r(cx - 2, 18, 4, 1, "#fff0bf");
  } else if (kind === "board") {
    r(0, 0, width, height, p.ink);
    r(1, 1, width - 2, height - 2, p.wood);
    r(2, 2, width - 4, 1, p.woodLight);
    r(4, 4, width - 8, height - 8, "#92714f");
    const notes = [p.cream, "#b7bd8b", "#c99488", "#cdb685", "#92ada2"];
    for (let i = 0; i < 5; i++) {
      const x = 8 + (i * (width - 16)) / 5;
      const y = 5 + (i % 2);
      r(x + 1, y + 1, 12, 11, p.woodDark);
      r(x, y, 12, 11, notes[i]!);
      r(x + 5, y - 1, 2, 2, i % 2 ? p.wall : p.velvet);
      r(x + 2, y + 4, 7, 1, p.wood);
      r(x + 2, y + 7, 5, 1, p.wood);
      r(x + 9, y + 9, 2, 1, p.gold);
    }
    r(2, height - 3, width - 4, 1, p.gold);
  } else if (kind === "tv") {
    r(3, height - 13, width - 6, 10, p.ink);
    r(5, height - 13, width - 10, 8, p.wood);
    r(5, height - 13, width - 10, 2, p.woodLight);
    for (let x = 12; x < width - 12; x += 20) {
      r(x, height - 9, 16, 4, p.woodDark);
      r(x + 11, height - 8, 2, 1, p.gold);
    }
    r(9, height - 4, 4, 3, p.woodDark);
    r(width - 13, height - 4, 4, 3, p.woodDark);
    r(14, 1, width - 28, height - 17, p.ink);
    r(16, 3, width - 32, height - 21, p.woodDark);
    r(18, 5, width - 36, height - 25, "#304b4c");
    r(20, 7, width - 40, 2, "#678b7d");
    r(22, 10, width / 4, 2, "#7f9e87");
    r(width - 24, height - 19, 2, 1, p.gold);
    r(cx - 2, height - 17, 4, 5, p.ink);
    r(cx - 10, height - 13, 20, 2, p.ink);
  } else if (kind === "portal") {
    // A brass-edged arch around a little luminous garden, rather than a flat doorway.
    r(15, 1, width - 30, 3, p.ink);
    r(10, 4, width - 20, 4, p.ink);
    r(6, 8, width - 12, height - 17, p.ink);
    r(12, 5, width - 24, 3, p.gold);
    r(8, 9, width - 16, height - 20, p.wood);
    r(12, 10, width - 24, height - 24, "#315c56");
    r(16, 9, width - 32, 4, "#8fae81");
    r(15, 14, width - 30, height - 29, "#66958b");
    r(19, 17, width - 38, height - 34, "#a9cfb6");
    r(22, 23, width - 44, height - 39, "#d3e0b8");
    r(cx - 4, height - 25, 8, 9, p.cream);
    r(cx - 7, height - 18, 14, 3, "#bad097");
    for (const [x, y] of [
      [12, 16],
      [width - 16, 20],
      [17, height - 26],
      [width - 19, height - 18],
    ]) {
      r(x, y - 2, 1, 5, p.cream);
      r(x - 2, y, 5, 1, p.cream);
    }
    r(4, height - 10, width - 8, 4, p.woodDark);
    r(5, height - 10, width - 10, 1, p.gold);
    r(1, height - 6, width - 2, 4, p.wood);
    r(3, height - 6, width - 6, 1, p.woodLight);
  } else if (kind === "painting") {
    r(0, 0, width, height, p.ink);
    r(1, 1, width - 2, height - 2, p.wood);
    r(2, 2, width - 4, 2, p.gold);
    r(5, 5, width - 10, height - 10, "#567f80");
    r(width - 15, 7, 6, 6, p.cream);
    r(5, height / 2, width - 10, height / 2 - 5, p.wall);
    r(10, height / 2 - 5, 11, height / 2, p.wallDark);
    r(7, height - 9, width - 14, 2, "#75966a");
    r(cx - 3, height - 14, 13, 8, p.gold);
  } else if (kind === "clock") {
    r(5, 1, width - 10, 3, p.woodDark);
    r(2, 4, width - 4, height - 8, p.woodDark);
    r(5, height - 4, width - 10, 3, p.woodDark);
    r(5, 5, width - 10, height - 10, p.gold);
    r(7, 7, width - 14, height - 14, p.cream);
    r(cx, 8, 1, height / 2 - 7, p.woodDark);
    r(cx, height / 2, 5, 1, p.woodDark);
    r(cx - 1, height / 2 - 1, 2, 2, p.velvet);
  }
  return canvas;
}
