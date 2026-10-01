import { afterEach, describe, expect, it, vi } from 'vitest';
import { getWorld } from '@third-space/config';
import { AsylumAmbience, asylumAudioLocation } from './asylum-ambience';
import { asylumSamples, asylumStaticGain } from './asylum-sound';
import { SoundboardAudio } from './audio';
import type { Snapshot } from './types';
afterEach(() => vi.unstubAllGlobals());
function fixture() {
    const sources: any[] = [], gains: any[] = [], buffers: any[] = [], pans: any[] = [], filters: any[] = [], contexts: Context[] = [];
    const node = () => ({ connect: vi.fn(), disconnect: vi.fn() });
    class Context {
        state: AudioContextState = 'running'; sampleRate = 8000; currentTime = 1; destination = {};
        constructor() { contexts.push(this); }
        resume = vi.fn(async () => { this.state = 'running'; }); close = vi.fn(async () => {});
        createGain() { const g = { ...node(), gain: { value: 0, cancelScheduledValues: vi.fn(), setTargetAtTime: vi.fn() } }; gains.push(g); return g; }
        createBiquadFilter() { const f = { ...node(), frequency: { value: 0 }, Q: { value: 0 } }; filters.push(f); return f; }
        createStereoPanner() { const p = { ...node(), pan: { value: 0 } }; pans.push(p); return p; }
        createBuffer(_: number, length: number) { const data = new Float32Array(length), b = { getChannelData: () => data }; buffers.push(b); return b; }
        createBufferSource() { const s = { ...node(), start: vi.fn(), stop: vi.fn(), onended: null as (() => void) | null, loop: false, buffer: null }; sources.push(s); return s; }
    }
    const ctx = new Context(), asylum = new AsylumAmbience(ctx as unknown as AudioContext, {} as AudioNode);
    return { ctx, asylum, sources, gains, buffers, pans, filters, contexts, Context };
}
const tv = getWorld('asylum').mediaSurface.source;
const idle = { inside: true, playing: false, x: tv.x, y: tv.y, volume: 1 };
function snapshot(playing = false, url = '') {
    return { worldId: 'asylum', serverTime: 1000, instanceId: 'asylum', media: { url, playing },
        players: [{ id: 'self', x: tv.x, y: tv.y, vx: 0, vy: 0, connected: true, mode: 'home', zone: 'asylum' }] } as Snapshot;
}
describe('quiet asylum sound textures', () => {
    it('generates deterministic bounded long loops with a continuous wrapping seam', () => {
        for (const kind of ['room', 'static'] as const) {
            const data = asylumSamples(kind, 8000);
            expect(data.length).toBe(8000 * (kind === 'room' ? 24 : 11));
            expect(data.every(v => Number.isFinite(v) && Math.abs(v) < .5)).toBe(true);
            expect(data).toEqual(asylumSamples(kind, 8000));
            if (kind === 'room') expect(Math.abs(data[0]! - data.at(-1)!)).toBeLessThan(.015);
            expect(data.some(v => Math.abs(v) > .03)).toBe(true);
        }
    });
    it('keeps TV static quiet, positional and subject to personal volume', () => {
        expect(asylumStaticGain(0, 1)).toBe(.055);
        expect(asylumStaticGain(5, 1)).toBeLessThan(asylumStaticGain(0, 1));
        expect(asylumStaticGain(10, 1)).toBe(0);
        expect(asylumStaticGain(0, 0)).toBe(0);
        expect(asylumStaticGain(0, .5)).toBe(.0275);
    });
});
describe('bounded asylum idle audio', () => {
    it('selects only connected indoor home players and uses shared URL/play intent', () => {
        expect(asylumAudioLocation(snapshot(true), 'self', 1)).toMatchObject({ inside: true, playing: false });
        expect(asylumAudioLocation(snapshot(true, 'https://example.com/video.mp4'), 'self', 1).playing).toBe(true);
        const s = snapshot(); s.worldId = 'forest'; expect(asylumAudioLocation(s, 'self', 1).inside).toBe(true);
        s.players[0]!.zone = undefined; expect(asylumAudioLocation(s, 'self', 1).inside).toBe(false);
        s.worldId = 'asylum'; s.players[0]!.mode = 'race'; expect(asylumAudioLocation(s, 'self', 1).inside).toBe(false);
        s.players[0]!.mode = 'home'; s.players[0]!.connected = false; expect(asylumAudioLocation(s, 'self', 1).inside).toBe(false);
        expect(asylumAudioLocation(null, 'self', 1).inside).toBe(false);
        expect(asylumAudioLocation(snapshot(), 'missing', 1).inside).toBe(false);
    });
    it('starts nothing while shared video is playing and keeps two loops through repeated idle snapshots', () => {
        const { asylum, ctx, sources, buffers, gains } = fixture();
        asylum.update({ ...idle, playing: true }); expect(sources).toHaveLength(0);
        asylum.update(idle);
        for (let i = 0; i < 10000; i++) { ctx.currentTime += .1; asylum.update(idle); }
        expect(sources).toHaveLength(2); expect(buffers).toHaveLength(2);
        for (const s of sources) { expect(s.loop).toBe(true); expect(s.start).toHaveBeenCalledTimes(1); expect(s.stop).not.toHaveBeenCalled(); }
        for (const gain of gains) expect(gain.gain.setTargetAtTime).toHaveBeenCalledTimes(1);
    });
    it('quickly fades both idle loops out on play and restores them on pause/end without replacing voices', () => {
        const { asylum, sources, gains } = fixture(); asylum.update(idle);
        expect(gains[0].gain.setTargetAtTime).toHaveBeenLastCalledWith(.08, 1, .3);
        expect(gains[1].gain.setTargetAtTime).toHaveBeenLastCalledWith(.055, 1, .3);
        for (let i = 0; i < 2; i++) {
            asylum.update({ ...idle, playing: true });
            for (const gain of gains) expect(gain.gain.setTargetAtTime).toHaveBeenLastCalledWith(0, 1, .015);
            asylum.update(idle);
        }
        expect(sources).toHaveLength(2); for (const s of sources) expect(s.stop).not.toHaveBeenCalled();
    });
    it('attenuates and pans static from the configured anchor while keeping the room bed non-positional', () => {
        const { asylum, gains, pans } = fixture(); asylum.update({ ...idle, x: tv.x - 5, volume: .5 });
        expect(gains[0].gain.setTargetAtTime).toHaveBeenLastCalledWith(.04, 1, .3);
        expect(gains[1].gain.setTargetAtTime).toHaveBeenLastCalledWith(asylumStaticGain(5, .5), 1, .3);
        expect(pans[0].pan.value).toBe(0); expect(pans[1].pan.value).toBe(.625);
        asylum.update({ ...idle, x: tv.x + 11 });
        expect(gains[1].gain.setTargetAtTime).toHaveBeenLastCalledWith(0, 1, .3); expect(pans[1].pan.value).toBe(-1);
    });
    it('preserves sources through suspension, remembers play intent while suspended and never resumes itself', () => {
        const { asylum, ctx, sources, gains } = fixture(); ctx.state = 'suspended'; asylum.update(idle); expect(sources).toHaveLength(0);
        ctx.state = 'running'; asylum.update(idle); ctx.state = 'suspended'; asylum.update({ ...idle, playing: true });
        expect(sources).toHaveLength(2); for (const gain of gains) expect(gain.gain.setTargetAtTime).toHaveBeenLastCalledWith(0, 1, .015);
        ctx.state = 'running'; asylum.update(idle); expect(sources).toHaveLength(2); expect(ctx.resume).not.toHaveBeenCalled();
        ctx.state = 'closed'; asylum.update(idle); expect(sources).toHaveLength(2);
    });
    it('recovers only an unexpectedly ended voice and does not restart it during playback', () => {
        const { asylum, sources, buffers } = fixture(); asylum.update(idle); const ended = sources[0]; ended.onended();
        asylum.update({ ...idle, playing: true }); expect(sources).toHaveLength(2);
        asylum.update(idle); expect(sources).toHaveLength(3); expect(sources[2].buffer).toBe(ended.buffer); expect(buffers).toHaveLength(2);
        ended.onended(); asylum.update(idle); expect(sources).toHaveLength(3);
    });
    it('frees all nodes on leaving and reuses cached buffers on return/reconnect, with idempotent teardown', () => {
        const { asylum, sources, buffers, gains, pans, filters } = fixture(); asylum.update(idle);
        asylum.update({ ...idle, inside: false }); asylum.clear();
        for (const s of sources) { expect(s.stop).toHaveBeenCalledTimes(1); expect(s.onended).toBeNull(); }
        for (const n of [...gains, ...pans, ...filters]) expect(n.disconnect).toHaveBeenCalledTimes(1);
        asylum.update(idle); expect(sources).toHaveLength(4); expect(buffers).toHaveLength(2); asylum.dispose();
        for (const s of sources) expect(s.stop).toHaveBeenCalledTimes(1);
    });
});
describe('room audio integration', () => {
    it('unlocks only on a user action from the latest snapshot and leaves shared video preferences unchanged', async () => {
        const { sources, gains, Context, contexts } = fixture(); vi.stubGlobal('AudioContext', Context);
        const audio = new SoundboardAudio(), s = snapshot(); const mediaBefore = structuredClone(s.media);
        audio.setMix(1, {}, new Set(), true); audio.setWorld(s, 'self', .5); expect(sources).toHaveLength(0);
        await audio.unlock(); expect(sources).toHaveLength(2); expect(gains[0].gain.value).toBe(0);
        expect(gains[1].gain.setTargetAtTime).toHaveBeenLastCalledWith(.04, 1, .3);
        audio.setMix(1, {}, new Set(), false); expect(gains[0].gain.value).toBe(1);
        for (let i = 0; i < 100; i++) audio.setWorld(s, 'self', .5); expect(sources).toHaveLength(2);
        const ctx = contexts.at(-1)!; ctx.state = 'suspended'; audio.setWorld(snapshot(true, 'https://example.com/video.mp4'), 'self', .5);
        await audio.unlock(); expect(sources).toHaveLength(2); expect(gains[1].gain.setTargetAtTime).toHaveBeenLastCalledWith(0, 1, .015);
        audio.setWorld(s, 'self', 0); expect(gains[1].gain.setTargetAtTime).toHaveBeenLastCalledWith(0, 1, .015);
        expect(s.media).toEqual(mediaBefore); audio.dispose();
        for (const source of sources) expect(source.stop).toHaveBeenCalledTimes(1);
    });
    it('cleans indoor voices on forest exit, race and disconnect and does not stack audio on return', async () => {
        const { sources, buffers, Context } = fixture(); vi.stubGlobal('AudioContext', Context);
        const audio = new SoundboardAudio(); await audio.unlock(); const s = snapshot();
        for (const reason of ['forest', 'race', 'disconnect'] as const) {
            audio.setWorld(s, 'self', 1); const indoorSources = sources.slice(-2);
            const other = structuredClone(s);
            if (reason === 'forest') { other.worldId = 'forest'; other.players[0]!.zone = undefined; }
            if (reason === 'race') other.players[0]!.mode = 'race';
            audio.setWorld(reason === 'disconnect' ? null : other, 'self', 1);
            for (const source of indoorSources) expect(source.stop).toHaveBeenCalledTimes(1);
        }
        // Two asylum and two forest samples stay cached regardless of visits.
        expect(buffers).toHaveLength(4); audio.dispose();
    });
});
