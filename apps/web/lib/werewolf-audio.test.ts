import { afterEach, describe, expect, it, vi } from 'vitest';
import { SoundboardAudio } from './audio';
import { gameSoundGain, gameSoundSamples } from './game-sound';
import type { Snapshot } from './types';
import type { WorldSoundEvent } from '@third-space/contracts';

afterEach(() => vi.unstubAllGlobals());
const snapshot = (extra = {}) => ({ worldId: 'forest', worldRevision: 2, epoch: 'room', instanceId: 'forest-2', serverTime: 1000,
    players: [{ id: 'self', mode: 'home', connected: true, x: 0, y: 0, vx: 0, vy: 0 }], ...extra }) as Snapshot;
const howl = (extra = {}): WorldSoundEvent => ({ id: 'room:2:werewolf:1:howl', epoch: 'room', worldRevision: 2,
    kind: 'howl', x: 13, y: 0, createdAt: 1000, expiresAt: 2800, ...extra });
function context() {
    const sources: any[] = [], node = () => ({ connect: vi.fn(), disconnect: vi.fn() });
    class Context {
        state = 'running'; sampleRate = 8000; destination = {}; currentTime = 0;
        resume = vi.fn(async () => {}); close = vi.fn(async () => {});
        createGain() { return { ...node(), gain: { value: 1, setTargetAtTime: vi.fn(), setValueAtTime: vi.fn(), cancelScheduledValues: vi.fn() } }; }
        createStereoPanner() { return { ...node(), pan: { value: 0 } }; }
        createBiquadFilter() { return { ...node(), frequency: { value: 0 } }; }
        createBuffer(_: number, length: number) { const data = new Float32Array(length); return { getChannelData: () => data }; }
        createBufferSource() { const s = { ...node(), start: vi.fn(), stop: vi.fn() }; sources.push(s); return s; }
    }
    vi.stubGlobal('AudioContext', Context); return sources;
}
describe('werewolf live spatial audio', () => {
    it('has original finite samples with headroom and distinct quiet paws, growl and howl ranges', () => {
        for (const kind of ['howl', 'growl', 'claw', 'werewolf-step'] as const) {
            const data = gameSoundSamples(kind, 8000); expect(data.length).toBeLessThanOrEqual(12800);
            expect([...data].every(Number.isFinite)).toBe(true); expect(Math.max(...data.map(Math.abs))).toBeLessThan(.9);
            expect(data.some(x => Math.abs(x) > .05)).toBe(true); expect(gameSoundGain(kind, 0, 0)).toBe(0);
        }
        expect(gameSoundGain('growl', 12, 1)).toBe(0); expect(gameSoundGain('howl', 13, 1)).toBeGreaterThan(0);
        expect(gameSoundGain('howl', 32, 1)).toBe(0); expect(gameSoundGain('werewolf-step', 1, 1)).toBeLessThan(gameSoundGain('clown-step', 1, 1));
    });
    it('does not replay a spawn howl on duplicate events, disconnect/reconnect or repeated snapshots', async () => {
        const sources = context(), audio = new SoundboardAudio(); await audio.unlock();
        audio.playWorld(howl(), snapshot(), 'self', 1); expect(sources).toHaveLength(1);
        audio.playWorld(howl(), snapshot(), 'self', 1); audio.setWorld(null, 'self', 1);
        audio.setWorld(snapshot({ worldId: 'living-room', instanceId: 'reconnected' }), 'self', 1);
        audio.playWorld(howl(), snapshot(), 'self', 1); expect(sources).toHaveLength(1);
        const state = { id: '1', kind: 'werewolf', x: 13, y: 0, phase: 'peek', startedAt: 1000, targetId: 'self', phaseUntil: 4000 };
        audio.setWorld(snapshot({ werewolf: state }), 'self', 1); const count = sources.length;
        audio.setWorld(snapshot({ werewolf: state }), 'self', 1); expect(sources).toHaveLength(count);
        audio.dispose();
    });
    it('plays a live clown acquisition giggle once, without replaying snapshots or muted events', async () => {
        const sources=context(), audio=new SoundboardAudio(); await audio.unlock();
        const giggle=howl({id:'room:2:clown:1:acquire:1',kind:'giggle',x:3,y:0});
        const s=snapshot();
        audio.playWorld(giggle,s,'self',1);audio.playWorld(giggle,s,'self',1);
        expect(sources).toHaveLength(1);
        audio.setWorld(s,'self',1);const count=sources.length;
        audio.setWorld(s,'self',1);expect(sources).toHaveLength(count);
        audio.playWorld({...giggle,id:'far',x:20},s,'self',1);expect(sources).toHaveLength(count);
        audio.setMix(1,{},new Set(),true);
        audio.playWorld({...giggle,id:'muted-acquisition'},s,'self',1);
        audio.setMix(1,{},new Set(),false);
        audio.playWorld({...giggle,id:'muted-acquisition'},s,'self',1);expect(sources).toHaveLength(count);
        // A new authoritative acquisition ID is distinct; repeated transport delivery is not.
        const retarget={...giggle,id:'room:2:clown:1:acquire:2'};
        audio.playWorld(retarget,s,'self',1);audio.playWorld(retarget,s,'self',1);
        expect(sources).toHaveLength(count+1);audio.dispose();
    });
    it('routes both creature strides through the unlocked game bus, with cadence and mute intact', async () => {
        const sources=context(), audio=new SoundboardAudio(); await audio.unlock();
        const state={phase:'chase',x:8,y:0,targetId:'self'};
        const s=snapshot({stalker:state,werewolf:state});
        audio.setWorld(s,'self',1); // Two creature steps plus the two cached forest loops.
        expect(sources).toHaveLength(4);
        audio.setWorld({...s,serverTime:1100},'self',1);expect(sources).toHaveLength(4);
        audio.setWorld({...s,serverTime:1700},'self',1);expect(sources).toHaveLength(6);
        audio.setMix(1,{},new Set(),true);
        audio.setWorld({...s,serverTime:2400},'self',1);expect(sources).toHaveLength(6);
        audio.setMix(1,{},new Set(),false);
        audio.setWorld({...s,serverTime:3100},'self',1);expect(sources).toHaveLength(8);
        audio.dispose();
    });
    it('drops expired/previous world cues and suppresses race/indoor delivery', async () => {
        const sources = context(), audio = new SoundboardAudio(); await audio.unlock();
        audio.playWorld(howl({ id: 'old', expiresAt: 999 }), snapshot(), 'self', 1);
        audio.playWorld(howl({ id: 'epoch', epoch: 'old' }), snapshot(), 'self', 1);
        audio.playWorld(howl({ id: 'revision', worldRevision: 1 }), snapshot(), 'self', 1);
        audio.playWorld(howl({ id: 'race' }), snapshot({ players: [{ id: 'self', mode: 'race', x: 0, y: 0 }] }), 'self', 1);
        audio.playWorld(howl({ id: 'inside' }), snapshot({ worldId: 'asylum', players: [{ id: 'self', mode: 'home', zone: 'asylum', x: 0, y: 0 }] }), 'self', 1);
        expect(sources).toHaveLength(0); audio.dispose();
    });
    it('respects local unlock and game mute without queueing a delayed howl', async () => {
        const sources = context(), audio = new SoundboardAudio();
        audio.playWorld(howl(), snapshot(), 'self', 1); expect(sources).toHaveLength(0);
        await audio.unlock(); audio.playWorld(howl(), snapshot(), 'self', 1); expect(sources).toHaveLength(0);
        audio.setMix(1, {}, new Set(), true); audio.playWorld(howl({ id: 'muted' }), snapshot(), 'self', 1);
        audio.setMix(1, {}, new Set(), false); audio.playWorld(howl({ id: 'muted' }), snapshot(), 'self', 1);
        expect(sources).toHaveLength(0); audio.playWorld(howl({ id: 'fresh' }), snapshot(), 'self', 1); expect(sources).toHaveLength(1);
        audio.dispose();
    });
});
