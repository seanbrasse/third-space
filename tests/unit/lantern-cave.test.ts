import {describe,expect,it} from 'vitest';
import {FOREST_MAP,type Point,type Rect} from '../../packages/config/src/index';
import {LANTERN_CAVE,LANTERN_CAVE_ANCHOR,LANTERN_CAVE_DOOR,LANTERN_CAVE_PEDESTAL_ID} from '../../packages/config/src/lantern-cave';
import {lanternCaveFloorArt,lanternCaveObjectArt,lanternGoblinArt} from '../../apps/web/lib/lantern-cave-art';
import type {LivingArt} from '../../apps/web/lib/living-art-primitives';
const r=.3;
const free=(p:Point,solids:readonly Rect[])=>!solids.some(s=>p.x+r>s.x+1e-8&&p.x-r<s.x+s.width-1e-8&&p.y+r>s.y+1e-8&&p.y-r<s.y+s.height-1e-8);
function clear(a:Point,b:Point,solids:readonly Rect[]){const n=Math.max(1,Math.ceil(Math.hypot(a.x-b.x,a.y-b.y)*16));for(let i=0;i<=n;i++)if(!free({x:a.x+(b.x-a.x)*i/n,y:a.y+(b.y-a.y)*i/n},solids))return false;return true;}
function points(a:LivingArt){return a.commands.flatMap(c=>c.kind==='rect'?[{x:c.x,y:c.y},{x:c.x+c.width,y:c.y+c.height}]:c.kind==='ellipse'?[{x:c.x-c.rx,y:c.y-c.ry},{x:c.x+c.rx,y:c.y+c.ry}]:c.points.map(([x,y])=>({x,y})));}
describe('Lantern Hollow original interior',()=>{
 it('reuses the exact existing exterior mouth without another outdoor building or keeper clue',()=>{
  expect(LANTERN_CAVE.returnPoint).toEqual({x:64,y:81.5});expect(LANTERN_CAVE_DOOR.point).toEqual(LANTERN_CAVE.returnPoint);expect(LANTERN_CAVE_DOOR.buildingId).toBe('living:lantern-cave');
  expect(FOREST_MAP.furniture.filter(f=>f.id===LANTERN_CAVE_DOOR.buildingId)).toHaveLength(1);expect(free(LANTERN_CAVE.returnPoint,FOREST_MAP.solids)).toBe(true);expect(LANTERN_CAVE).not.toHaveProperty('clue');
  expect(Object.isFrozen(LANTERN_CAVE)).toBe(true);expect(Object.isFrozen(LANTERN_CAVE.map)).toBe(true);expect(Object.isFrozen(LANTERN_CAVE.map.furniture)).toBe(true);
 });
 it('admits eight distinct players with safe direct exit and reachable quest approach',()=>{
  const {map,entrance,exit}=LANTERN_CAVE;expect(map.spawns).toHaveLength(8);expect(new Set(map.spawns.map(p=>`${p.x},${p.y}`)).size).toBe(8);
  for(const p of[entrance,exit,LANTERN_CAVE_ANCHOR,...map.spawns]){expect(free(p,map.solids),JSON.stringify(p)).toBe(true);expect(clear(p,entrance,map.solids),JSON.stringify(p)).toBe(true);}
  expect(clear(entrance,exit,map.solids)).toBe(true);expect(clear(entrance,LANTERN_CAVE_ANCHOR,map.solids)).toBe(true);
  for(let i=0;i<map.spawns.length;i++)for(let j=i+1;j<map.spawns.length;j++)expect(Math.hypot(map.spawns[i]!.x-map.spawns[j]!.x,map.spawns[i]!.y-map.spawns[j]!.y)).toBeGreaterThanOrEqual(r*2);
 });
 it('keeps furniture/solids inside the map and shallow floor props traversable',()=>{
  const {map}=LANTERN_CAVE;for(const f of map.furniture){expect(Object.isFrozen(f)).toBe(true);for(const s of[f.footprint,...(f.collider?[f.collider]:[])]){expect(s.x).toBeGreaterThanOrEqual(0);expect(s.y).toBeGreaterThanOrEqual(0);expect(s.x+s.width).toBeLessThanOrEqual(map.width);expect(s.y+s.height).toBeLessThanOrEqual(map.height);}
   if(f.collider)expect(map.solids).toContain(f.collider);if(f.kind==='rug'||f.kind==='portal')expect(f.collider).toBeNull();
  }
  expect(map.furniture.find(f=>f.id==='lantern-cave:exit')?.usePoints).toContainEqual(LANTERN_CAVE.exit);
  const pool=map.furniture.find(f=>f.id==='lantern-cave:shallow-pool')!;expect(free({x:pool.footprint.x+pool.footprint.width/2,y:pool.footprint.y+pool.footprint.height/2},map.solids)).toBe(true);
 });
 it('renders deterministic cave-specific floor and bounded objects, preserving an empty recovered pedestal',()=>{
  const floor=lanternCaveFloorArt();expect([floor.width,floor.height]).toEqual([576,512]);expect(floor).toEqual(lanternCaveFloorArt());
  for(const f of LANTERN_CAVE.map.furniture){const a=lanternCaveObjectArt(f)!;expect(a,f.id).toBeDefined();for(const p of points(a)){expect(p.x,f.id).toBeGreaterThanOrEqual(0);expect(p.y,f.id).toBeGreaterThanOrEqual(0);expect(p.x,f.id).toBeLessThanOrEqual(a.width);expect(p.y,f.id).toBeLessThanOrEqual(a.height);}}
  const pedestal=LANTERN_CAVE.map.furniture.find(f=>f.id===LANTERN_CAVE_PEDESTAL_ID)!,full=lanternCaveObjectArt(pedestal)!,empty=lanternCaveObjectArt(pedestal,false)!;
  expect([empty.width,empty.height]).toEqual([full.width,full.height]);expect(full.commands.some(c=>c.fill==='#f3d594')).toBe(true);expect(empty.commands.some(c=>c.fill==='#f3d594')).toBe(false);expect(empty.commands.some(c=>c.kind==='poly'&&c.fill==='#6d7b6c')).toBe(true);
  expect(lanternCaveObjectArt({...pedestal,id:'an-unrelated-object'})).toBeUndefined();
 });
 it('keeps every hostile goblin facing/stride/windup within the existing mob footprint',()=>{
  for(const facing of['up','down','left','right']as const)for(let frame=0;frame<4;frame++)for(const windup of[false,true]){const art=lanternGoblinArt(facing,frame,windup);expect([art.width,art.height]).toEqual([40,52]);for(const p of points(art)){expect(p.x,`${facing}/${frame}/${windup}`).toBeGreaterThanOrEqual(0);expect(p.y).toBeGreaterThanOrEqual(0);expect(p.x).toBeLessThanOrEqual(40);expect(p.y).toBeLessThanOrEqual(52);}}
 });
});
