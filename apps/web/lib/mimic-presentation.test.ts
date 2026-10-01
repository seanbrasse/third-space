import { expect,it } from 'vitest';
import { DEFAULT_AVATAR,type ForestMimicState } from '@third-space/contracts';
import { mimicPresentation } from './mimic-presentation';
import { mimicSoundSamples } from './mimic-sound';
const s:ForestMimicState={kind:'mimic',id:'1',x:0,y:0,originX:0,originY:0,targetId:'p',coverId:'t',disguisePlayerId:'p',disguise:DEFAULT_AVATAR,phase:'morph',phaseUntil:2600,startedAt:0,transformed:false};
it('morphs continuously and reduced motion has no jitter',()=>{expect(mimicPresentation(s,1000,false).progress).toBe(0);expect(mimicPresentation(s,1800,false).progress).toBe(.5);expect(mimicPresentation(s,2600,false).progress).toBe(1);expect(mimicPresentation({...s,phase:'chase',transformed:true},3000,true)).toMatchObject({frame:0,rotation:0,monsterAlpha:1,avatarAlpha:0});});
it('uses deterministic bounded short envelopes without clicks or volume spikes',()=>{for(const kind of ['mimic-roar','mimic-hit','mimic-step'] as const){const a=mimicSoundSamples(kind,48000);expect(a).toEqual(mimicSoundSamples(kind,48000));expect(Math.abs(a[0]!)).toBe(0);expect(Math.max(...a.map(Math.abs))).toBeLessThan(.65);expect(Math.abs(a.at(-1)!)).toBeLessThan(.001);}});
