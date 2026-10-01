/** A whole deciduous fruit tree replaces the evergreen at the same footprint.
 * Apples sit in branch pockets; foreground leaves overlap their upper edges. */
export function appleTreeCanvas(ripe: boolean): HTMLCanvasElement {
    const c = document.createElement('canvas'); c.width = 64; c.height = 96;
    const g = c.getContext('2d')!; g.imageSmoothingEnabled = false;
    const r = (x:number,y:number,w:number,h:number,color:string) => {g.fillStyle=color;g.fillRect(x,y,w,h);};
    r(18,89,31,5,'#1b2d27'); r(28,52,10,38,'#493b2d'); r(30,62,3,26,'#9b7950');
    r(23,54,7,5,'#75583c'); r(20,45,5,12,'#75583c'); r(35,47,6,13,'#75583c'); r(40,42,5,8,'#75583c');
    // Stepped, overlapping boughs leave a little trunk and two forks visible.
    for (const [x,y,w,h] of [[14,8,32,10],[7,18,48,18],[3,33,57,20],[9,53,46,13]]) r(x,y,w,h,'#253e30');
    for (const [x,y,w,h] of [[16,9,26,7],[10,19,37,12],[5,34,45,15],[12,50,34,9]]) r(x,y,w,h,'#3d6040');
    for (const [x,y,w,h] of [[19,10,19,4],[12,21,17,6],[8,36,12,5],[30,26,18,5],[29,49,15,5]]) r(x,y,w,h,'#607b4c');
    for (const [x,y] of [[18,28],[42,37],[27,49],[12,43]]) {
        r(x-2,y+2,9,7,'#263b2b');
        if (ripe) {
            r(x,y+1,6,6,'#723f32'); r(x+1,y+1,4,5,'#c35f43'); r(x+1,y+1,2,2,'#e0a066');
            r(x+2,y-2,1,3,'#937145');
        } else { r(x+2,y+1,2,2,'#779155'); }
        // Leaves drawn last occlude fruit tops and attach it to its branch.
        r(x-2,y-1,5,2,'#4e7045'); r(x+3,y-2,5,2,'#76925a');
    }
    for (const [x,y] of [[14,55],[42,23],[48,49],[24,18],[36,58]]) r(x,y,6,2,'#547446');
    return c;
}
