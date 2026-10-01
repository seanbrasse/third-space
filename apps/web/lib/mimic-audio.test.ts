import { expect, it } from 'vitest';
import { createPlayer } from '@third-space/simulation';
import { DEFAULT_AVATAR, type RoomSnapshot, type ForestMimicState } from '@third-space/contracts';
import { movementAudioCues } from './movement-audio';
import { gameSoundGain, gameSoundSamples } from './game-sound';
const p=createPlayer('p','Player');
const mimic:ForestMimicState={kind:'mimic',id:'1',x:p.x+2,y:p.y,originX:p.x+2,originY:p.y,targetId:'p',coverId:'t',disguisePlayerId:'p',disguise:DEFAULT_AVATAR,phase:'approach',phaseUntil:5000,startedAt:0,transformed:false};
const snapshot={players:[p],mimic,worldId:'forest',serverTime:1000} as unknown as RoomSnapshot;
it('uses calm player steps in disguise then aggressive heavy steps, and silence during morph/retreat',()=>{
 expect(movementAudioCues(snapshot,'p',new Set())).toContainEqual(expect.objectContaining({id:'mimic',kind:'player-step',interval:700}));
 expect(movementAudioCues({...snapshot,mimic:{...mimic,phase:'chase',transformed:true}},'p',new Set())).toContainEqual(expect.objectContaining({id:'mimic',kind:'mimic-step'}));
 for(const phase of ['morph','retreat'] as const)expect(movementAudioCues({...snapshot,mimic:{...mimic,phase}},'p',new Set()).some(c=>c.id==='mimic')).toBe(false);
});
it('respects indoor/race separation, local disconnection and game volume hard cutoff',()=>{
 for(const changes of [{zone:'asylum' as const},{mode:'race' as const},{connected:false}])expect(movementAudioCues({...snapshot,players:[{...p,...changes}]},'p',new Set()).some(c=>c.id==='mimic')).toBe(false);
 for(const kind of ['mimic-step','mimic-roar','mimic-hit'] as const){expect(gameSoundGain(kind,0,0)).toBe(0);expect(gameSoundGain(kind,32,1)).toBe(0);expect(gameSoundGain(kind,0,1)).toBeGreaterThan(gameSoundGain(kind,6,1));expect(gameSoundSamples(kind,8000).length).toBeGreaterThan(0);}
});
