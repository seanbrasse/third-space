import { describe, it, expect, vi, afterEach } from 'vitest';
import { gameSoundGain, clownStepInterval, gameSoundSamples } from './game-sound';
import { SoundboardAudio } from './audio';
import type { Snapshot } from './types';
afterEach(() => vi.unstubAllGlobals());
describe('quiet positional game sounds', () => {
    it('keeps peer movement below threats and fades to silence at range', () => { expect(gameSoundGain('player-step', 1, .5)).toBeLessThan(gameSoundGain('clown-step', 1, .5) / 4); for (const kind of ['player-step', 'clown-step', 'giggle', 'slash'] as const) {
        expect(gameSoundGain(kind, 2, .5)).toBeGreaterThan(gameSoundGain(kind, 6, .5));
        expect(gameSoundGain(kind, kind === 'clown-step' ? 16 : 12, 1)).toBe(0);
        expect(gameSoundGain(kind, 0, 0)).toBe(0);
    } expect(gameSoundGain('player-step', 8, 1)).toBe(0); });
    it('speeds up heavy steps as the target gets closer', () => { expect(clownStepInterval(0)).toBe(220); expect(clownStepInterval(8)).toBe(520); expect(clownStepInterval(2)).toBeLessThan(clownStepInterval(6)); });
    it('creates finite short samples with headroom instead of clipping', () => { for (const kind of ['player-step', 'clown-step', 'giggle', 'slash'] as const) {
        const data = gameSoundSamples(kind, 8000);
        expect(data.length).toBeLessThanOrEqual(6400);
        expect([...data].every(Number.isFinite)).toBe(true);
        expect(Math.max(...data.map(Math.abs))).toBeLessThan(1);
        expect(data.some(x => Math.abs(x) > .05)).toBe(true);
    } });
    it('plays nearby movement once per cadence, deduplicates impacts, and mutes all new cues', async () => {
        const sources: any[] = [];
        const node = () => ({ connections: [] as any[], connect(to: any) { this.connections.push(to); }, disconnect: vi.fn() });
        class Context {
            state = 'running';
            currentTime = 0;
            sampleRate = 8000;
            destination = {};
            resume = vi.fn(async () => { });
            close = vi.fn(async () => { });
            createGain() { return { ...node(), gain: { value: 1 } }; }
            createStereoPanner() { return { ...node(), pan: { value: 0 } }; }
            createBuffer(_: number, length: number, sampleRate: number) { const a = new Float32Array(length); return { duration: length / sampleRate, getChannelData: () => a }; }
            createBufferSource() { const s = { ...node(), buffer: null as any, onended: null as any, start: vi.fn(), stop: vi.fn() }; sources.push(s); return s; }
        }
        vi.stubGlobal('AudioContext', Context);
        const audio = new SoundboardAudio();
        await audio.unlock();
        audio.setMix(1, {}, new Set());
        const snapshot = { instanceId: 'home', serverTime: 1000, worldId: 'living-room', players: [{ id: 'self', x: 0, y: 0, vx: 0, vy: 0, connected: true, mode: 'home' }, { id: 'peer', x: 1, y: 0, vx: 4, vy: 0, connected: true, mode: 'home' }] } as unknown as Snapshot;
        audio.setWorld(snapshot, 'self', .5);
        expect(sources).toHaveLength(1);
        const footGain = sources[0].connections[0].gain.value;
        audio.setWorld({ ...snapshot, serverTime: 1100 }, 'self', .5);
        expect(sources).toHaveLength(1);
        const hit = { id: 'hit', kind: 'slash' as const, x: 1, y: 0, createdAt: 1000, expiresAt: 2000 };
        audio.playWorld(hit, snapshot, 'self', .5);
        audio.playWorld(hit, snapshot, 'self', .5);
        expect(sources).toHaveLength(2);
        expect(sources[1].connections[0].gain.value).toBeGreaterThan(footGain);
        audio.playWorld({ ...hit, id: 'far', x: 20 }, snapshot, 'self', .5);
        audio.playWorld({ ...hit, id: 'expired', expiresAt: 900 }, snapshot, 'self', .5);
        expect(sources).toHaveLength(2);
        audio.setMix(1, {}, new Set(), true);
        const bus = sources[1].connections[0].connections[0].connections[0];
        expect(bus.gain.value).toBe(0);
        audio.playWorld({ ...hit, id: 'muted' }, snapshot, 'self', .5);
        expect(sources).toHaveLength(2);
        audio.setMix(1, {}, new Set(), false);
        expect(bus.gain.value).toBe(1);
        audio.playWorld({ ...hit, id: 'muted' }, snapshot, 'self', .5);
        expect(sources).toHaveLength(2);
        audio.dispose();
    });
});
