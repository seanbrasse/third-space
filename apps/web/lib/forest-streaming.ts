import type {Rect} from '@third-space/config';

export const FOREST_STREAMING = {chunkTiles:12, preloadTiles:4, cachedChunks:28} as const;
/** Global coordinates make independently painted chunks meet without visible seams. */
function chunkKeys(view:Rect, width:number, height:number,pad:number):string[] {
  if (![view.x,view.y,view.width,view.height].every(Number.isFinite) || view.width<=0 || view.height<=0) return [];
  const size=FOREST_STREAMING.chunkTiles;
  const left=Math.max(0,Math.floor((view.x-pad)/size)),top=Math.max(0,Math.floor((view.y-pad)/size));
  const right=Math.min(Math.ceil(width/size)-1,Math.floor((view.x+view.width+pad)/size));
  const bottom=Math.min(Math.ceil(height/size)-1,Math.floor((view.y+view.height+pad)/size));
  const keys:string[]=[];
  for(let y=top;y<=bottom;y++)for(let x=left;x<=right;x++)keys.push(`${x}:${y}`);
  return keys.sort((a,b)=>{const [ax,ay]=a.split(':').map(Number),[bx,by]=b.split(':').map(Number);return Math.hypot((ax!+.5)*size-view.x-view.width/2,(ay!+.5)*size-view.y-view.height/2)-Math.hypot((bx!+.5)*size-view.x-view.width/2,(by!+.5)*size-view.y-view.height/2);});
}


export const forestChunkKeys=(view:Rect,width:number,height:number)=>chunkKeys(view,width,height,FOREST_STREAMING.preloadTiles);
export const forestVisibleChunkKeys=(view:Rect,width:number,height:number)=>chunkKeys(view,width,height,0);
