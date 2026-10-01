import {expect,it,vi} from 'vitest';
import type * as Phaser from 'phaser';
import {createPlayer,stepHome} from '../../packages/simulation/src';
import {parseCommand} from '../../packages/contracts/src';
import {SpiritPresentation,spiritMarks} from '../../apps/web/lib/spirit-presentation';
import {nearestSurvivalInteraction} from '../../apps/web/lib/survival-interaction';
import type {SurvivalSnapshot} from '../../packages/contracts/src/survival';

const map={id:'forest',width:30,height:30,spawn:{x:5,y:5},spawns:[{x:5,y:5}],furniture:[],seats:[],solids:[]};
const p={...createPlayer('a','A'),x:5,y:5};
const input={seq:1,axisX:1,axisY:0,jump:false};
it('predicts the same bounded snare movement, expiry and ward override without slowing another world or tunnelling',()=>{
  const snared={...p,spiritEffects:{wardUntil:0,snareUntil:6000}},plain=stepHome(p,input,.1,map,2000);
  expect(stepHome(snared,input,.1,map,2000).x-p.x).toBeCloseTo((plain.x-p.x)*.65);
  expect(stepHome(snared,input,.1,map,6000).x).toBeCloseTo(plain.x);
  expect(stepHome({...snared,spiritEffects:{wardUntil:3000,snareUntil:6000}},input,.1,map,2000).x).toBeCloseTo(plain.x);
  expect(stepHome(snared,input,.1,{...map,id:'living-room'},2000).x).toBeCloseTo(plain.x);
  expect(stepHome({...snared,zone:'interior:lantern-cave'},input,.1,map,2000).x).toBeCloseTo(plain.x);
  expect(stepHome({...snared,potionEffects:[{kind:'speed',startedAt:1000,expiresAt:21000}]},input,.25,{...map,solids:[{x:5.8,y:0,width:.3,height:30}]},2000).x).toBeLessThan(5.8);
});
it('bounds steady ward/snare/tell marks, expires them and clears between scopes',()=>{
  const players=Array.from({length:10},(_,i)=>({...p,id:String(i),spiritEffects:{wardUntil:i?3000:0,snareUntil:2000}}));
  const pulses=Array.from({length:3},(_,i)=>({id:String(i),x:5,y:5,radius:1.2,until:1500}));
  expect(spiritMarks(players,pulses,p,1000)).toHaveLength(9);
  expect(spiritMarks(players,pulses,p,3000)).toEqual([]);
  expect(spiritMarks(players,pulses,{...p,zone:'interior:lantern-cave'},1000)).toEqual([]);
  expect(spiritMarks([{...players[0]!,connected:false}],[],p,1000)).toEqual([]);
  const g:any={};for(const key of ['setDepth','clear','lineStyle','strokeCircle','fillStyle','fillCircle','lineBetween','destroy'])g[key]=vi.fn(()=>g);
  const view=new SpiritPresentation({add:{graphics:()=>g}} as unknown as Phaser.Scene);
  view.update(players,pulses,p,1000,32);expect(g.strokeCircle).toHaveBeenCalledTimes(9);
  g.strokeCircle.mockClear();view.update([],[],p,1500,32);expect(g.clear).toHaveBeenCalledTimes(2);expect(g.strokeCircle).not.toHaveBeenCalled();view.destroy();expect(g.destroy).toHaveBeenCalledOnce();
});
it('uses E for a reachable ripe tree or current backpack without extending range or crossing walls',()=>{
  const s:SurvivalSnapshot={pvpEnabled:false,players:[],events:[],backpacks:[{id:'bag',x:6,y:5}],appleTrees:[{id:'tree',x:5,y:6.5,readyAt:1000}]};
  expect(nearestSurvivalInteraction(p,s,1000,map)).toEqual({type:'survival.pickup',backpackId:'bag'});
  s.backpacks=[];expect(nearestSurvivalInteraction(p,s,999,map)).toBeUndefined();
  expect(nearestSurvivalInteraction(p,s,1000,map)).toEqual({type:'survival.harvest',treeId:'tree'});
  expect(nearestSurvivalInteraction(p,s,1000,{...map,solids:[{x:4,y:5.5,width:3,height:.2}]})).toBeUndefined();
  expect(nearestSurvivalInteraction({...p,x:8},s,1000,map)).toBeUndefined();
  expect(nearestSurvivalInteraction({...p,zone:'interior:lantern-cave'},s,1000,map)).toBeUndefined();
});
it('allows only a fresh cave recovery selector, never client reward, effect, position or custody assertions',()=>{
  const c={type:'lantern.recover',commandId:'recover',worldRevision:1,lifeRevision:0,zoneRevision:2};
  expect(parseCommand(c)).toEqual(c);
  for(const payload of [{wardUntil:9999},{rewardApples:100},{x:9,y:5.5},{custody:'home'},{targetNpcId:'washer-elsie'}])expect(parseCommand({...c,...payload})).toBeNull();
});
