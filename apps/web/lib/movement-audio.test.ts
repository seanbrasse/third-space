import { describe, expect, it } from 'vitest';
import { movementAudioCues } from './movement-audio';
import { gameSoundGain, clownStepInterval, werewolfStepInterval } from './game-sound';
import type { Snapshot } from './types';
const player = (id: string, extra = {}) => ({ id, mode: 'home', connected: true, x: 25, y: 25, vx: 1, vy: 0, ...extra });
const snapshot = (extra = {}) => ({ worldId: 'forest', serverTime: 1000, instanceId: 'forest', players: [player('self'), player('friend')], ...extra }) as Snapshot;
describe('audible spatial movement', () => {
    it('keeps footsteps local to the physical area rather than a voice bridge', () => {
        const s = snapshot({ players: [player('self'), player('friend'), player('indoors', {zone:'asylum'}), player('racer', {mode:'race',grounded:true})] });
        expect(movementAudioCues(s,'self',new Set()).map(c=>c.id)).toEqual(['self','friend']);
        s.players[0]!.zone='asylum';
        expect(movementAudioCues(s,'self',new Set()).map(c=>c.id)).toEqual(['self','indoors']);
    });
    it('omits disconnected, stationary, seated, respawning and muted players', () => {
        const s = snapshot({ players: [player('self'), player('offline',{connected:false}), player('still',{vx:0}), player('seated',{seatId:'seat'}), player('ghost',{respawnAt:2000}), player('muted')] });
        expect(movementAudioCues(s,'self',new Set(['muted'])).map(c=>c.id)).toEqual(['self']);
        s.players[0]!.connected=false;
        expect(movementAudioCues(s,'self',new Set())).toEqual([]);
    });
    it('emits heavy chase footsteps from actual threat positions and speeds cadence on approach', () => {
        const s=snapshot({stalker:{phase:'chase',x:30,y:25,targetId:'self'},werewolf:{phase:'chase',x:32,y:25,targetId:'self'}});
        const cues=movementAudioCues(s,'self',new Set());
        expect(cues.find(c=>c.id==='clown')).toMatchObject({kind:'clown-step',x:30,y:25,interval:clownStepInterval(5)});
        expect(cues.find(c=>c.id==='werewolf')).toMatchObject({kind:'werewolf-step',x:32,y:25,interval:werewolfStepInterval(7)});
        expect(werewolfStepInterval(1)).toBeLessThan(werewolfStepInterval(9));
        expect(clownStepInterval(1)).toBeLessThan(clownStepInterval(9));
        s.players[0]!.zone='asylum';expect(movementAudioCues(s,'self',new Set()).some(c=>c.id==='clown'||c.id==='werewolf')).toBe(false);
    });
    it('keeps warning/retreat states quiet rather than inventing pursuit', () => {
        for(const phase of ['peek','retreat'])expect(movementAudioCues(snapshot({stalker:{phase,x:30,y:25},werewolf:{phase,x:32,y:25}}),'self',new Set()).map(c=>c.kind)).toEqual(['player-step','player-step']);
    });
    it('gives approach sounds headroom at the ten-tile visibility edge, retaining hard cutoff and independent mute', () => {
        for(const kind of ['clown-step','werewolf-step'] as const){
            expect(gameSoundGain(kind,10,1)).toBeGreaterThan(.03);
            expect(gameSoundGain(kind,2,1)).toBeGreaterThan(gameSoundGain(kind,10,1));
            expect(gameSoundGain(kind,16,1)).toBe(0);expect(gameSoundGain(kind,2,0)).toBe(0);
        }
        expect(gameSoundGain('player-step',0,1)).toBe(.045);
        expect(gameSoundGain('player-step',4,1)).toBeCloseTo(.01125);
        expect(gameSoundGain('player-step',8,1)).toBe(0);
    });
});
