import {describe,expect,it} from 'vitest';
import {ASYLUM_MAP,getWorld} from '@third-space/config';
import {isHomeWalkable} from '@third-space/simulation';
describe('asylum projector layout',()=>{
 it('uses a substantially larger 16:9 screen inside its frame',()=>{
  const screen=getWorld('asylum').mediaSurface;
  const frame=ASYLUM_MAP.furniture.find(f=>f.id===screen.id)!.footprint;
  expect(screen.width).toBeGreaterThanOrEqual(6);
  expect(screen.width/screen.height).toBeCloseTo(16/9,8);
  expect(screen.x).toBeGreaterThan(frame.x);
  expect(screen.y).toBeGreaterThan(frame.y);
  expect(screen.x+screen.width).toBeLessThan(frame.x+frame.width);
  expect(screen.y+screen.height).toBeLessThan(frame.y+frame.height);
 });
 it('retains all eight safe seats and a walkable viewing position',()=>{
  for(const seat of ASYLUM_MAP.seats)expect(isHomeWalkable(seat,ASYLUM_MAP)).toBe(true);
  expect(isHomeWalkable(getWorld('asylum').mediaSurface.source,ASYLUM_MAP)).toBe(true);
 });
});
