/** Small local pools at the arrival/exit landing and charging station only. */
export const ASYLUM_WAYFINDING_LIGHTS = [
    { x: 10, y: 17.4, radius: 2.4, strength: .48 },
    { x: 16.5, y: 9.1, radius: 1.9, strength: .55 },
] as const;
/** Same 32×48 footprint as the old charger chair; a dock, battery and cable. */
export function asylumChargerCanvas() {
    const c = document.createElement('canvas'); c.width = 32; c.height = 48;
    const g = c.getContext('2d')!; g.imageSmoothingEnabled = false;
    const r = (x: number, y: number, w: number, h: number, color: string) => { g.fillStyle = color; g.fillRect(x, y, w, h); };
    r(3, 43, 26, 4, '#26342f'); r(6, 22, 21, 22, '#45564e'); r(8, 23, 17, 3, '#8b9c83');
    r(10, 30, 13, 9, '#172c29'); r(14, 26, 6, 12, '#596f69'); r(15, 28, 4, 2, '#bed4b0');
    r(15, 36, 4, 4, '#90ba87'); r(7, 5, 19, 17, '#1e3432'); r(9, 7, 15, 13, '#b1c39d');
    r(14, 4, 5, 2, '#b1c39d'); r(15, 8, 5, 4, '#395b45'); r(12, 12, 7, 3, '#395b45'); r(14, 15, 4, 4, '#395b45');
    r(26, 24, 2, 13, '#a39466'); r(22, 36, 6, 2, '#a39466');
    return c;
}
