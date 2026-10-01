import {describe,expect,it} from 'vitest';
import {clownGreetingPresentation,greetingViewportPoint} from './clown-greeting';
import type {ForestStalker} from '@third-space/contracts';
const state={id:'1',phase:'peek',greeting:{id:'1:hello',text:'There you are…',shownAt:1000,until:5500}} as ForestStalker;
describe('timed synchronized clown text',()=>{
 it('uses server timestamps, fades once, never resets for late join/reconnect',()=>{
  expect(clownGreetingPresentation(state,1000)?.text).toBe('There you are…');
  expect(clownGreetingPresentation(state,5100)?.alpha).toBeCloseTo(400/700);
  expect(clownGreetingPresentation(state,5500)).toBeNull();
  expect(clownGreetingPresentation({...state},5501)).toBeNull();
  expect(clownGreetingPresentation({...state,phase:'retreat'},1100)).toBeNull();
  expect(clownGreetingPresentation({...state,kind:'werewolf'},1100)).toBeNull();
 });
 it('keeps a readable bubble inside mobile bounds',()=>{
  for(const p of [{x:-20,y:-10},{x:400,y:500}]){
   const at=greetingViewportPoint(p.x,p.y,180,50,320,400);
   expect(at.x-90).toBeGreaterThanOrEqual(8);expect(at.x+90).toBeLessThanOrEqual(312);
   expect(at.y-50).toBeGreaterThanOrEqual(8);expect(at.y).toBeLessThanOrEqual(392);
  }
 });
});
