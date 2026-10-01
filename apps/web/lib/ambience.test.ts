import {describe,it,expect} from 'vitest';
import {ambienceSamples,fireAmbienceGain} from './ambience';
describe('night ambience',()=>{
 it('keeps long-loop textures bounded and finite at browser sample rates',()=>{for(const kind of ['night','fire','owl','wolf'] as const){const samples=ambienceSamples(kind,8000);expect(samples.every(Number.isFinite)).toBe(true);expect(Math.max(...samples.slice(0,8000).map(Math.abs))).toBeLessThan(1);expect(samples.some(v=>Math.abs(v)>.01)).toBe(true);}});
 it('makes crackles stronger nearby and silent beyond the fire range',()=>{expect(fireAmbienceGain(0,.5)).toBeGreaterThan(fireAmbienceGain(5,.5));expect(fireAmbienceGain(9,1)).toBe(0);expect(fireAmbienceGain(0,0)).toBe(0);});
});
