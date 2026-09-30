import type { Furniture, Point } from "@third-space/config";
export function forestFloorCanvas(tile: number) {
    const c = document.createElement("canvas");
    c.width = c.height = 48 * tile;
    const g = c.getContext("2d")!;
    g.imageSmoothingEnabled = false;
    for (let y = 0; y < 48; y++)
        for (let x = 0; x < 48; x++) {
            const clearing = Math.hypot(x - 23.5, y - 23.5) < 7.5;
            const path = Math.abs(x - 23.5) < 1.5 || Math.abs(y - 23.5) < 1.5 || (x > 11 && x < 18 && y > 12 && y < 24);
            g.fillStyle = clearing || path ? ["#685544", "#635240", "#705b48"][(x * 7 + y * 3) % 3] : ["#263e33", "#2a4435", "#304937"][(x * 3 + y * 5) % 3];
            g.fillRect(x * tile, y * tile, tile, tile);
            for (let n = 0; n < 4; n++) {
                g.fillStyle = clearing || path ? "#8a7250" : "#48604a";
                g.fillRect(x * tile + (x * 7 + y * 3 + n * 11) % tile, y * tile + (x * 3 + y * 9 + n * 7) % tile, 2, 1);
            }
            if (!clearing && !path && (x + y) % 7 === 0) {
                g.fillStyle = "#698369";
                g.fillRect(x * tile + 8, y * tile + 14, 5, 2);
                g.fillRect(x * tile + 10, y * tile + 11, 1, 5);
            }
        }
    return c;
}
export function forestObjectCanvas(item: Furniture, tile: number) {
    const c = document.createElement("canvas");
    c.width = Math.round(item.footprint.width * tile);
    c.height = Math.round(item.footprint.height * tile);
    const g = c.getContext("2d")!;
    g.imageSmoothingEnabled = false;
    const w = c.width, h = c.height;
    const r = (x: number, y: number, a: number, b: number, color: string) => { g.fillStyle = color; g.fillRect(Math.round(x), Math.round(y), Math.round(a), Math.round(b)); };
    if (item.kind === "tree") {
        r(w * .44, h * .65, w * .16, h * .35, "#3d302c");
        r(w * .47, h * .69, w * .04, h * .25, "#8b6346");
        for (let i = 0; i < 4; i++) {
            const yy = 8 + i * 15, span = 15 + i * 7;
            for (let j = 0; j < 14; j++) {
                const half = span * j / 14;
                r(w / 2 - half, yy + j * 2, half * 2 + 2, 2, ["#203c32", "#294a3a", "#355942", "#426749"][i]);
            }
            r(w / 2 - span + 5, yy + 25, span, 2, "#557655");
        }
    }
    else if (item.kind === "log") {
        r(2, h * .4, w - 4, h * .48, "#2b2825");
        r(3, h * .3, w - 6, h * .42, "#75573d");
        r(5, h * .3, w - 10, 3, "#ad8555");
        r(5, h * .55, w - 10, 2, "#493b2e");
        r(2, h * .34, 7, h * .35, "#b79261");
        r(4, h * .43, 3, h * .15, "#72543c");
    }
    else if (item.kind === "camper") {
        r(3, 7, w - 6, h - 14, "#2a302f");
        r(6, 9, w - 12, h - 19, "#c8bea0");
        r(7, h * .5, w - 14, h * .3, "#698673");
        r(8, 11, w - 16, 3, "#e7d3a3");
        r(18, 20, 40, 25, "#4b625f");
        r(21, 22, 34, 19, "#809b93");
        r(36, 21, 2, 22, "#e0d3b0");
        r(w - 60, 19, 31, h - 34, "#53766a");
        r(w - 54, 24, 20, 20, "#a0b6a3");
        r(w - 33, 47, 3, 3, "#dac382");
        r(24, h - 17, 19, 17, "#262c2d");
        r(w - 46, h - 17, 19, 17, "#262c2d");
        r(28, h - 13, 11, 9, "#74776b");
        r(w - 42, h - 13, 11, 9, "#74776b");
        r(4, h - 27, w - 8, 3, "#c6ac7a");
    }
    else if (item.kind === "structure") {
        r(12, h * .32, w - 24, h * .6, "#674e3d");
        for (let y = h * .35; y < h * .9; y += 8)
            r(14, y, w - 28, 2, "#352e2b");
        for (let i = 0; i < 12; i++)
            r(w / 2 - i * 7, 8 + i * 4, i * 14, 5, "#35483e");
        r(12, h * .3, w - 24, 5, "#24352f");
        r(w * .38, h * .53, w * .22, h * .38, "#182729");
        r(26, h * .46, 28, 27, "#1b302e");
        r(31, h * .49, 3, 22, "#8a7351");
        r(27, h * .59, 25, 3, "#8a7351");
        r(w - 62, h * .47, 25, 26, "#253e35");
        r(w - 65, h * .56, 31, 4, "#866746");
        r(w - 55, h * .45, 4, 32, "#866746");
    }
    else if (item.kind === "tv") {
        r(2, 2, w - 4, h - 14, "#3d382f");
        r(5, 5, w - 10, h - 20, "#d8d0ae");
        r(8, 8, w - 16, h - 26, "#758d80");
        r(12, 12, w - 24, h - 34, "#203a36");
        r(w / 2 - 1, h - 13, 3, 13, "#94734b");
        r(12, h - 2, w - 24, 2, "#75614a");
    }
    return c;
}
export function flashlightContains(source: Point & {
    facing: string;
    flashlightOn?: boolean;
}, point: Point) {
    const dx = point.x - source.x, dy = point.y - source.y, d = Math.hypot(dx, dy);
    if (d < 1.3)
        return true;
    if (!source.flashlightOn || d > 7)
        return false;
    const direction = source.facing === "up" ? -Math.PI / 2 : source.facing === "down" ? Math.PI / 2 : source.facing === "left" ? Math.PI : 0;
    return Math.abs(Math.atan2(Math.sin(Math.atan2(dy, dx) - direction), Math.cos(Math.atan2(dy, dx) - direction))) < .55;
}
