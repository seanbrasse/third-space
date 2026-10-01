import {describe,expect,it} from 'vitest';
import {catchStingKind,catchStingSamples} from './catch-sting';
import {gameSoundGain} from './game-sound';
import type {WorldSoundEvent} from '@third-space/contracts';
const hit={id:'hit',kind:'slash',x:1,y:1,victimId:'self',createdAt:1000,expiresAt:2000} as WorldSoundEvent;
describe('bounded local catch accents',()=>{
 it('requires a fresh authoritative victim event, never a nearby observer or old catch',()=>{
  expect(catchStingKind(hit,'self',1100,false)).toBe('clown-scare');
  expect(catchStingKind({...hit,kind:'claw'},'self',1100,false)).toBe('werewolf-scare');
  expect(catchStingKind({...hit,kind:'mimic-hit'},'self',1100,false)).toBe('mimic-scare');
  expect(catchStingKind(hit,'observer',1100,false)).toBeNull();
  expect(catchStingKind(hit,'self',1351,false)).toBeNull();
  expect(catchStingKind(hit,'self',1100,true)).toBeNull();
  expect(catchStingKind({...hit,kind:'giggle'},'self',1100,false)).toBeNull();
 });
 it('has a finite smooth envelope and amplitude/gain headroom for both creatures',()=>{
  for(const kind of ['clown-scare','werewolf-scare','mimic-scare'] as const)for(const rate of [8000,48000]){
   const data=catchStingSamples(kind,rate);expect(data).toHaveLength(Math.ceil(.32*rate));
   expect(data[0]).toBe(0);expect(data.at(-1)).toBe(0);expect([...data].every(Number.isFinite)).toBe(true);
   expect(Math.max(...data.map(Math.abs))).toBeLessThanOrEqual(.55);
   expect(Math.max(...data.slice(-Math.round(.01*rate)).map(Math.abs))).toBeLessThan(.003);
   expect(gameSoundGain(kind,0,1)).toBe(.16);expect(gameSoundGain(kind,0,0)).toBe(0);
  }
  expect(catchStingSamples('clown-scare',8000)).not.toEqual(catchStingSamples('werewolf-scare',8000));
 });
});
