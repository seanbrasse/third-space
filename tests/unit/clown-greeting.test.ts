import {describe,expect,it} from 'vitest';
import {chooseClownGreeting,CLOWN_GREETINGS} from '../../apps/game-server/src/clown-greeting';
import {ForestEncounter} from '../../apps/game-server/src/ForestStalker';
import {getWorld} from '@third-space/config';
import {createPlayer} from '@third-space/simulation';
describe('room-owned original clown greeting',()=>{
 it('chooses a stable short original line',()=>{
  expect(chooseClownGreeting('1','tree',1000)).toEqual(chooseClownGreeting('1','tree',1000));
  const g=chooseClownGreeting('1','tree',1000);expect(CLOWN_GREETINGS).toContain(g.text);expect(g.until-g.shownAt).toBe(4500);
  expect(CLOWN_GREETINGS.every(x=>x.length<=45)).toBe(true);
 });
 it('sets one greeting at spawn, pairs acquisition giggle and retains it across updates/retargets',()=>{
  const w=getWorld('forest'),world={...w,map:{...w.map,furniture:[{id:'tree',kind:'tree' as const,footprint:{x:34,y:12,width:2,height:3},collider:null,usePoints:[],seats:[]}]}};
  const e=new ForestEncounter(world,()=>.9),p=createPlayer('a','Camper');p.x=35;p.y=18;p.connected=true;
  e.reset(1000);e.update(40000,[p]);const greeting={...e.state!.greeting!};expect(greeting.text).toBeTruthy();expect(e.drainSounds().some(x=>x.kind==='giggle')).toBe(true);
  e.update(40001,[p]);expect(e.state!.greeting).toEqual(greeting);expect(e.drainSounds()).toEqual([]);
  p.zone='asylum';const b=createPlayer('b','Friend');b.x=37;b.y=18;b.connected=true;e.update(41000,[p,b]);expect(e.state!.greeting).toEqual(greeting);
 });
});
