import {describe,expect,it} from 'vitest';
import {FOREST_INTERIORS} from '../../../packages/config/src/authored-forest';
import {LIVING_OUTDOOR_SCENERY,REED_HOUSE_SCENERY,augmentLivingInterior} from '../../../packages/config/src/living-environment';
import {DEFAULT_AVATAR,type Facing} from '@third-space/contracts';
import {livingEnvironmentArt,livingInteriorFloorArt,livingInteriorObjectArt,livingActorArt} from './living-environment-art';
import {livingStrengthAvatarArt,personalAvatarArt} from './living-potion-art';
import {livingArtSvg,type LivingArt} from './living-art-primitives';
function extents(a:LivingArt){return a.commands.flatMap(c=>c.kind==='rect'?[{x:c.x,y:c.y},{x:c.x+c.width,y:c.y+c.height}]:c.kind==='ellipse'?[{x:c.x-c.rx,y:c.y-c.ry},{x:c.x+c.rx,y:c.y+c.ry}]:c.points.map(([x,y])=>({x,y})));}
describe('original living art assets',()=>{
 it('keeps every new scenery asset inside its culling footprint without URLs or scripts',()=>{
  for(const s of[...LIVING_OUTDOOR_SCENERY,...REED_HOUSE_SCENERY]){const a=livingEnvironmentArt(s.art);for(const p of extents(a)){expect(p.x,s.id).toBeGreaterThanOrEqual(0);expect(p.y,s.id).toBeGreaterThanOrEqual(0);expect(p.x,s.id).toBeLessThanOrEqual(a.width);expect(p.y,s.id).toBeLessThanOrEqual(a.height);}expect(livingArtSvg(a)).not.toMatch(/https?:\/\/(?!www.w3.org)|<script|<image|<foreignObject/);}
 });
 it('harvesting removes orchard fruit while preserving the complete tree silhouette',()=>{
  const ripe=livingEnvironmentArt('orchard-tree'),spent=livingEnvironmentArt('orchard-tree',false);
  expect([spent.width,spent.height]).toEqual([ripe.width,ripe.height]);
  const ripeCommands=new Set(ripe.commands.map(c=>JSON.stringify(c)));
  for(const c of spent.commands)expect(ripeCommands.has(JSON.stringify(c))).toBe(true);
  for(const color of['#c8894d','#af5e43','#e8bc75']){expect(ripe.commands.some(c=>c.fill===color)).toBe(true);expect(spent.commands.some(c=>c.fill===color)).toBe(false);}
  const bounds=(a:LivingArt)=>{const points=extents(a);return[Math.min(...points.map(p=>p.x)),Math.max(...points.map(p=>p.x)),Math.min(...points.map(p=>p.y)),Math.max(...points.map(p=>p.y))];};
  expect(bounds(spent)).toEqual(bounds(ripe));
 });
 it('renders all eight materials with deterministic commands and leaves portals to the existing handler',()=>{
  for(const old of FOREST_INTERIORS){const i=augmentLivingInterior(old),a=livingInteriorFloorArt(i);expect(a.width).toBe(i.map.width*32);expect(a.height).toBe(i.map.height*32);expect(a.commands).toEqual(livingInteriorFloorArt(i).commands);expect(a.commands.length).toBeGreaterThan(200);
   for(const f of i.map.furniture){const art=livingInteriorObjectArt(f,i.style);if(f.kind==='portal')expect(art).toBeUndefined();else if(f.kind!=='structure')expect(art,f.id).toBeDefined();}
  }
 });
 it('gives friendly/hostile spirits and pond animals distinct readable assets in every facing/frame',()=>{
  const good=livingActorArt('spirit',{coat:'#adc8a0',trim:'#ebd397'}),bad=livingActorArt('spirit',{coat:'#5e4979',trim:'#bd97b5'});expect(good.commands).not.toEqual(bad.commands);
  for(const kind of['spirit','frog','duck']as const)for(const facing of['up','down','left','right']as const)for(let frame=0;frame<4;frame++){const a=livingActorArt(kind,undefined,facing,frame);for(const p of extents(a)){expect(p.x).toBeGreaterThanOrEqual(0);expect(p.x).toBeLessThanOrEqual(a.width);expect(p.y).toBeGreaterThanOrEqual(0);expect(p.y).toBeLessThanOrEqual(a.height);}}
 });
 it('strength changes anatomy while retaining the exact personal head commands and colors',()=>{
  for(const facing of['up','down','left','right']as Facing[])for(const accessory of['none','glasses','headphones','beanie']as const)for(const hair of['none','short','curly','long']as const){const avatar={...DEFAULT_AVATAR,skinColor:'#8e6046',hair,accessory},normal=personalAvatarArt(avatar,facing,1),strong=livingStrengthAvatarArt(avatar,facing,1);expect(strong.width).toBe(34);expect(strong.height).toBe(43);
   const start=normal.commands.findIndex(c=>c.kind==='rect'&&c.x===7&&c.y===3&&c.width===10&&c.height===2);expect(start).toBeGreaterThan(0);const head=normal.commands.slice(start).map(c=>c.kind==='rect'?{...c,x:c.x+5}:c);expect(strong.commands.slice(-head.length)).toEqual(head);
   expect(strong.commands.some(c=>c.fill===avatar.skinColor)).toBe(true);expect(strong.commands.some(c=>c.kind==='poly'&&c.points.some(([x,y])=>x===34&&y>=30))).toBe(true);
   for(const p of extents(strong)){expect(p.x).toBeGreaterThanOrEqual(0);expect(p.x).toBeLessThanOrEqual(34);expect(p.y).toBeGreaterThanOrEqual(0);expect(p.y).toBeLessThanOrEqual(43);}
  }
 });
});
