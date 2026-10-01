import {describe,expect,it} from 'vitest';
import {FOREST_MAP,type Point,type Rect} from '../src/index';
import {FOREST_BUILDINGS,FOREST_INTERIORS,WARD_CACHE_ANCHORS,expandAuthoredForest,createForestInterior} from '../src/authored-forest';
import {AUTHORED_FOREST_NPCS,FOREST_WILDLIFE} from '../src/forest-cast';
import {augmentLivingForest,augmentLivingInterior,LIVING_ENVIRONMENT_ANCHORS,LIVING_OUTDOOR_SCENERY,REED_HOUSE_SCENERY} from '../src/living-environment';
const radius=.3,base=expandAuthoredForest(FOREST_MAP),before=JSON.stringify(base),map=augmentLivingForest(base);
const hits=(p:Point,s:Rect)=>p.x+radius>s.x+1e-8&&p.x-radius<s.x+s.width-1e-8&&p.y+radius>s.y+1e-8&&p.y-radius<s.y+s.height-1e-8;
const free=(p:Point,solids:readonly Rect[]=map.solids)=>!solids.some(s=>hits(p,s));
function clearLeg(a:Point,b:Point,solids:readonly Rect[]=map.solids){const count=Math.max(1,Math.ceil(Math.hypot(a.x-b.x,a.y-b.y)*10));return Array.from({length:count+1},(_,i)=>({x:a.x+(b.x-a.x)*i/count,y:a.y+(b.y-a.y)*i/count})).every(p=>free(p,solids));}
describe('living scenery shares authoritative geometry',()=>{
 it('leaves source maps intact, is idempotent and preserves the original camp',()=>{
  expect(JSON.stringify(base)).toBe(before);expect(augmentLivingForest(map)).toBe(map);expect(map.width).toBe(144);expect(map.height).toBe(112);
  for(const f of FOREST_MAP.furniture.filter(f=>!f.id.startsWith('world-tree-')))expect(map.furniture.find(n=>n.id===f.id)).toEqual(f);
  expect(new Set(map.furniture.map(f=>f.id)).size).toBe(map.furniture.length);
  for(const s of LIVING_OUTDOOR_SCENERY){expect(Object.isFrozen(s)).toBe(true);expect(Object.isFrozen(s.footprint)).toBe(true);expect(s.footprint.x+s.footprint.width).toBeLessThan(144);expect(s.footprint.y+s.footprint.height).toBeLessThan(112);}
 });
 it('keeps existing resident/wildlife route legs and worker anchors clear',()=>{
  const routes=[...AUTHORED_FOREST_NPCS.flatMap(n=>Object.values(n.routine)),...FOREST_WILDLIFE.map(n=>n.route)];
  for(const [ri,route]of routes.entries())for(let i=0;i<route.length;i++)expect(clearLeg(route[i]!,route[(i+1)%route.length]!),`route${ri} leg${i}`).toBe(true);
  for(const [id,p]of Object.entries(LIVING_ENVIRONMENT_ANCHORS))expect(free(p),id).toBe(true);
 });
 it('connects every old door/cache and new worker/cave approach to the camp',()=>{
  const cols=map.width*2+1,rows=map.height*2+1,blocked=new Uint8Array(cols*rows),seen=new Uint8Array(cols*rows);
  for(const s of map.solids)for(let y=Math.max(0,Math.floor((s.y-radius)*2));y<=Math.min(rows-1,Math.ceil((s.y+s.height+radius)*2));y++)for(let x=Math.max(0,Math.floor((s.x-radius)*2));x<=Math.min(cols-1,Math.ceil((s.x+s.width+radius)*2));x++)if(hits({x:x/2,y:y/2},s))blocked[y*cols+x]=1;
  const q=[24*2*cols+28*2];seen[q[0]!]=1;for(let i=0;i<q.length;i++){const n=q[i]!;for(const next of[n-1,n+1,n-cols,n+cols])if(next>=0&&next<blocked.length&&!seen[next]&&!blocked[next]&&(Math.abs(next-n)!==1||Math.floor(next/cols)===Math.floor(n/cols))){seen[next]=1;q.push(next);}}
  for(const p of[...FOREST_BUILDINGS.map(b=>b.door),...WARD_CACHE_ANCHORS,...Object.values(LIVING_ENVIRONMENT_ANCHORS),{x:72,y:84},{x:96,y:70},{x:97,y:51},{x:91,y:51}]){const near={x:Math.round(p.x*2)/2,y:Math.round(p.y*2)/2};expect(free(p)&&seen[Math.round(p.y*2)*cols+Math.round(p.x*2)]===1&&clearLeg(p,near),JSON.stringify(p)).toBe(true);}
 });
 it('gives all eight interiors unchanged spawns/clues/exits and a clear return path',()=>{
  for(const old of FOREST_BUILDINGS.flatMap(b=>{const i=createForestInterior(b);return i?[i]:[];})){const next=augmentLivingInterior(old);expect(next.map.spawns).toEqual(old.map.spawns);expect(next.clue).toEqual(old.clue);expect(next.exit).toEqual(old.exit);expect(next.entrance).toEqual(old.entrance);expect(augmentLivingInterior(next)).toBe(next);
   for(const p of[next.entrance,next.exit,...next.map.spawns,...(next.clue?[next.clue.point]:[])])expect(free(p,next.map.solids),`${next.id}:${JSON.stringify(p)}`).toBe(true);
   expect(clearLeg(next.entrance,next.exit,next.map.solids)).toBe(true);
   if(old.buildingId==='tansy-hut'){expect(next.map.furniture.length-old.map.furniture.length).toBe(REED_HOUSE_SCENERY.length);expect(old.map.furniture.some(f=>f.id.startsWith('living:'))).toBe(false);}
  }
 });
});
