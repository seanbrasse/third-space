import type { Furniture, Point } from "@third-space/config";
export function forestFloorCanvas(tile: number) {
    const c = document.createElement("canvas");
    c.width = 80 * tile; c.height = 64 * tile;
    const g = c.getContext("2d")!;
    g.imageSmoothingEnabled = false;
    for (let y = 0; y < 64; y++)
        for (let x = 0; x < 80; x++) {
            const clearing = Math.hypot(x - 23.5, y - 23.5) < 7.5 || (x>62&&x<76&&y>5&&y<17);
            const path = (x>24&&x<71&&Math.abs(y-23.5)<1.5)||(Math.abs(x-68.5)<1.5&&y>12&&y<26)||Math.abs(x - 23.5) < 1.5 || Math.abs(y - 23.5) < 1.5 || (x > 11 && x < 18 && y > 12 && y < 24);
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
        // A pre-rendered overhead object: roof, side wall and end face read separately.
        const poly=(points:number[][],color:string)=>{g.fillStyle=color;g.beginPath();points.forEach(([x,y],i)=>i?g.lineTo(x,y):g.moveTo(x,y));g.closePath();g.fill();};
        r(9,h-18,w-16,13,"#182824");
        poly([[8,22],[w-29,10],[w-7,24],[w-7,h-21],[w-29,h-9],[8,h-22]],"#4c6158");
        poly([[8,22],[w-29,10],[w-7,24],[29,36]],"#e0d3b4");
        poly([[8,22],[29,36],[29,h-10],[8,h-22]],"#8a9781");
        r(29,36,w-36,h-49,"#c7bea1");r(29,h-42,w-36,21,"#6c8b78");
        r(38,43,46,25,"#304a45");r(41,45,39,18,"#92aaa0");r(61,45,2,19,"#d7d2b6");
        r(w-54,39,29,h-49,"#506d5e");r(w-50,44,20,23,"#8eaba0");r(w-33,73,3,3,"#d9b981");
        r(44,16,w-92,8,"#b3b399");r(49,18,w-102,3,"#e8dfc2");
        for(const x of [42,w-48]){r(x,h-20,19,19,"#252c2c");r(x+4,h-17,11,10,"#778176");r(x+7,h-15,4,6,"#acb09a");}
        r(29,h-24,w-36,3,"#aa9e7a");
    }
    else if (item.kind === "structure") {
        const poly=(points:number[][],color:string)=>{g.fillStyle=color;g.beginPath();points.forEach(([x,y],i)=>i?g.lineTo(x,y):g.moveTo(x,y));g.closePath();g.fill();};
        r(13,h-24,w-24,17,"#172723");
        poly([[18,55],[w-21,49],[w-21,h-17],[18,h-10]],"#6b5540");
        poly([[18,55],[34,67],[34,h-10],[18,h-21]],"#493f33");
        for(let y=72;y<h-17;y+=9)r(35,y,w-57,2,"#3b342c");
        // Two roof slopes and a lit ridge rather than a flat triangular placeholder.
        poly([[8,57],[w*.43,9],[w*.5,48],[24,87]],"#3e5946");
        poly([[w*.43,9],[w-9,50],[w-20,82],[w*.5,48]],"#2c443a");
        g.strokeStyle="#637b53";g.lineWidth=3;g.beginPath();g.moveTo(w*.43,9);g.lineTo(w*.5,48);g.stroke();
        for(let i=0;i<5;i++){r(27+i*8,49+i*4,18,2,"#526b4c");r(w*.55+i*9,32+i*4,16,2,"#3f5845");}
        r(w*.44,86,31,h-105,"#182c28");r(w*.46,90,7,h-113,"#68523a");r(w*.56,116,3,3,"#b4975f");
        for(const x of [48,w-64]){r(x,91,25,25,"#1e3630");r(x+3,94,17,17,"#456453");r(x+10,92,3,23,"#9a8058");r(x,103,25,3,"#957d56");}
        r(46,110,28,4,"#7b6046");r(w-61,89,4,30,"#937854");r(w*.42,h-22,38,7,"#817052");
    }
    else if (item.kind === "board") {
        r(7,h-15,5,15,"#5d4935");r(w-12,h-15,5,15,"#5d4935");
        r(0,3,w,h-18,"#49382b");r(4,7,w-8,h-26,"#94724f");
        for(let i=0;i<6;i++){const x=9+i%3*22,y=12+Math.floor(i/3)*19;r(x,y,17,15,["#decb76","#bbbd91","#d3a58e"][i%3]);r(x+7,y,3,3,"#705948");r(x+3,y+6,11,1,"#967d50");r(x+3,y+9,8,1,"#967d50");}
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

/** Original 2.5D pixel sprite; four stride frames share a tiny fixed texture set. */
export function clownSpriteCanvas(frame:number){
  const c=document.createElement("canvas");c.width=28;c.height=38;const g=c.getContext("2d")!;g.imageSmoothingEnabled=false;
  const r=(x:number,y:number,w:number,h:number,color:string)=>{g.fillStyle=color;g.fillRect(x,y,w,h);};
  const lean=[0,1,0,-1][frame%4],step=[0,2,0,-2][frame%4];
  r(6,35,18,2,"#16251f");
  r(9+step,26,5,8,"#483b48");r(16-step,26,4,8,"#3d4144");r(5+step,33,9,3,"#642f39");r(16-step,33,9,3,"#823541");
  r(7,17,16,12,"#b7b6a4");r(7,20,8,9,"#697b71");r(15,20,8,9,"#816373");
  r(3,19,4,11,"#999e8d");r(23,17,3,12,"#979f8c");r(3,29,4,3,"#ccc5ad");r(23,28,3,3,"#ccc5ad");
  r(5+lean,5,4,10,"#8e3246");r(22+lean,5,4,10,"#8e3246");r(9+lean,3,14,15,"#d5cdb3");
  r(10+lean,9,5,3,"#29332c");r(18+lean,8,4,3,"#29332c");r(12+lean,10,2,1,"#d24b4c");r(19+lean,9,2,1,"#d24b4c");
  r(15+lean,11,4,3,"#a63a47");r(12+lean,15,9,2,"#583341");r(14+lean,15,5,1,"#f3dec2");
  r(9,17,13,3,"#dfd9bd");r(14,20,3,3,"#a73f4f");r(14,25,3,3,"#a73f4f");
  r(12+lean,1,9,2,"#676c62");r(14+lean,0,5,2,"#9c4a54");
  return c;
}
