import {LANTERN_CAVE_DOOR} from '../src/lantern-cave';
import {describe,expect,it} from 'vitest';
import {FOREST_MAP,type Point,type Rect} from '../src/index';
import {AUTHORED_FOREST_NPCS,FOREST_STORY_HOOKS,FOREST_WILDLIFE,forestNpcDialogue,forestNpcRoute} from '../src/forest-cast';
import {AUTHORED_FOREST_SIZE,FOREST_BUILDINGS,FOREST_INTERIORS,WARD_CACHE_ANCHORS,expandAuthoredForest,createAuthoredForestFurniture} from '../src/authored-forest';
const map=expandAuthoredForest(FOREST_MAP),r=.3;
const hits=(p:Point,s:Rect)=>p.x+r>s.x+1e-8&&p.x-r<s.x+s.width-1e-8&&p.y+r>s.y+1e-8&&p.y-r<s.y+s.height-1e-8;
const walkable=(p:Point,solids:readonly Rect[]=map.solids)=>!solids.some(s=>hits(p,s));
function segment(a:Point,b:Point,solids:readonly Rect[]=map.solids){const n=Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)*8);for(let i=0;i<=n;i++){const t=n?i/n:0;if(!walkable({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t},solids))return false;}return true;}

describe('authored continuous forest',()=>{
 it('preserves the original camp and every core furniture coordinate while replacing only outer bounds',()=>{
  expect(map).toMatchObject(AUTHORED_FOREST_SIZE);expect(map.spawn).toEqual(FOREST_MAP.spawn);expect(map.seats).toEqual(FOREST_MAP.seats);
  for(const f of FOREST_MAP.furniture)expect(map.furniture.find(n=>n.id===f.id)).toEqual(f);
  expect(map.solids.some(s=>s.x===79&&s.width===1&&s.height===64)).toBe(false);
  expect(expandAuthoredForest(map)).toBe(map);
  const ids=map.furniture.map(f=>f.id);expect(new Set(ids).size).toBe(ids.length);
 });
 it('has bounded original props and reachable entrance, cache, wildlife and resident anchors',()=>{
  for(const f of createAuthoredForestFurniture()){
   expect(f.footprint.x,f.id).toBeGreaterThanOrEqual(0);expect(f.footprint.y,f.id).toBeGreaterThanOrEqual(0);
   expect(f.footprint.x+f.footprint.width,f.id).toBeLessThan(map.width);expect(f.footprint.y+f.footprint.height,f.id).toBeLessThan(map.height);
  }
  const anchors=[...FOREST_BUILDINGS.map(b=>({...b.door,id:b.id})),...WARD_CACHE_ANCHORS,...AUTHORED_FOREST_NPCS.map(n=>({...n.home,id:n.id})),...FOREST_WILDLIFE.map(a=>({...a.home,id:a.id}))];
  for(const p of anchors)expect(walkable(p),JSON.stringify(p)).toBe(true);
  // Independent half-tile flood fill proves all authored approach points join the
  // existing camp, even if the runtime A* has not yet raised its old grid cap.
  const cols=map.width*2+1,rows=map.height*2+1,blocked=new Uint8Array(cols*rows);
  for(const s of map.solids){for(let y=Math.max(0,Math.floor((s.y-r)*2));y<=Math.min(rows-1,Math.ceil((s.y+s.height+r)*2));y++)for(let x=Math.max(0,Math.floor((s.x-r)*2));x<=Math.min(cols-1,Math.ceil((s.x+s.width+r)*2));x++)if(hits({x:x/2,y:y/2},s))blocked[y*cols+x]=1;}
  const seen=new Uint8Array(blocked.length),queue:number[]=[24*2*cols+28*2];seen[queue[0]!]=1;
  for(let i=0;i<queue.length;i++){const n=queue[i]!;for(const next of[n-1,n+1,n-cols,n+cols])if(next>=0&&next<blocked.length&&!seen[next]&&!blocked[next]&&(Math.abs(next-n)!==1||Math.floor(next/cols)===Math.floor(n/cols))){seen[next]=1;queue.push(next);}}
  for(const p of anchors){const nearest={x:Math.round(p.x*2)/2,y:Math.round(p.y*2)/2};expect(seen[Math.round(p.y*2)*cols+Math.round(p.x*2)]===1&&segment(p,nearest),`Unreachable ${p.id}`).toBe(true);}
 });
 it('keeps every patrol leg collision-free including the route wrap and overnight patrols',()=>{
  const routes=[...AUTHORED_FOREST_NPCS.flatMap(n=>Object.entries(n.routine).map(([phase,points])=>({id:`${n.id}:${phase}`,points}))),...FOREST_WILDLIFE.map(a=>({id:a.id,points:a.route}))];
  for(const route of routes)for(let i=0;i<route.points.length;i++)expect(segment(route.points[i]!,route.points[(i+1)%route.points.length]!),`${route.id} leg ${i}`).toBe(true);
 });
 it('gives all nine natural interiors safe entry, exit, clue and late-join placements',()=>{
  expect(FOREST_INTERIORS).toHaveLength(9);
  for(const i of FOREST_INTERIORS){
   expect(i.map.spawns).toHaveLength(8);expect(walkable(i.returnPoint),i.id).toBe(true);
   for(const p of[i.entrance,i.exit,...i.map.spawns,...(i.clue?[i.clue.point]:[])])expect(walkable(p,i.map.solids),`${i.id} ${JSON.stringify(p)}`).toBe(true);
   expect(segment(i.entrance,i.exit,i.map.solids),i.id).toBe(true);
   expect(i.buildingId===LANTERN_CAVE_DOOR.buildingId?LANTERN_CAVE_DOOR.interiorId:FOREST_BUILDINGS.find(b=>b.id===i.buildingId)?.interiorId).toBe(i.id);
  }
 });
 it('connects each authored character to valid people and story hooks with stateful dialogue',()=>{
  const ids=new Set(AUTHORED_FOREST_NPCS.map(n=>n.id)),hooks=new Set(FOREST_STORY_HOOKS.map(h=>h.id));
  expect(ids.size).toBe(AUTHORED_FOREST_NPCS.length);
  for(const n of AUTHORED_FOREST_NPCS){
   expect(n.backstory.length).toBeGreaterThan(50);expect(n.motivation.length).toBeGreaterThan(25);
   expect(n.relationships.length).toBeGreaterThan(0);for(const rel of n.relationships)expect(ids.has(rel.npcId),rel.npcId).toBe(true);
   for(const hook of n.questHooks)expect(hooks.has(hook),hook).toBe(true);
   expect(new Set(Object.values(n.dialogue)).size).toBe(4);
   expect(forestNpcDialogue(n,{wardsRestored:true})).toBe(n.dialogue['wards-restored']);
   expect(forestNpcDialogue(n,{keeperFound:true,wardAccepted:true})).toBe(n.dialogue['keeper-found']);
   expect(forestNpcRoute(n,'dawn')).toBe(n.routine.day);
  }
  for(const hook of FOREST_STORY_HOOKS){expect(ids.has(hook.from),hook.id).toBe(true);for(const id of hook.to)expect(ids.has(id),id).toBe(true);if(hook.prerequisite)expect(hooks.has(hook.prerequisite)).toBe(true);}
 });
});
