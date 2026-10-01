/** Shared presentation ceiling; spawn safety never trusts client camera reports. */
export const FOREST_VIEW = { width: 40, height: 28, spawnPadding: 3 } as const;
export function forestCameraZoom(width: number, height: number, tile = 32) {
    return Math.max(width / (FOREST_VIEW.width * tile), height / (FOREST_VIEW.height * tile), Math.min(width / (22 * tile), height / (22 * tile)));
}
/** Camera clamping shifts the viewport near a world edge; a radius alone is unsafe. */
export function outsideForestView(point: {x:number;y:number}, observer: {x:number;y:number}, map: {width:number;height:number}) {
    const w=Math.min(map.width,FOREST_VIEW.width),h=Math.min(map.height,FOREST_VIEW.height),pad=FOREST_VIEW.spawnPadding;
    const left=Math.max(0,Math.min(map.width-w,observer.x-w/2)),top=Math.max(0,Math.min(map.height-h,observer.y-h/2));
    return point.x<left-pad || point.x>left+w+pad || point.y<top-pad || point.y>top+h+pad;
}
