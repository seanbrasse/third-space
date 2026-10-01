import { afterEach, describe, expect, it, vi } from 'vitest';
import { ForestAmbience } from './forest-ambience';
import { SoundboardAudio } from './audio';
import type { Snapshot } from './types';
afterEach(() => vi.unstubAllGlobals());
function fixture() {
    const sources: any[] = [], gains: any[] = [], buffers: any[] = [];
    const node = () => ({ connect: vi.fn(), disconnect: vi.fn() });
    class Context {
        state: AudioContextState = 'running'; sampleRate = 8000; currentTime = 1; destination = {};
        resume = vi.fn(async () => { this.state = 'running'; }); close = vi.fn(async () => {});
        createGain() { const g = { ...node(), gain: { value: 0, cancelScheduledValues: vi.fn(), setTargetAtTime: vi.fn(), setValueAtTime: vi.fn() } }; gains.push(g); return g; }
        createBiquadFilter() { return { ...node(), frequency: { value: 0 }, Q: { value: 0 } }; }
        createStereoPanner() { return { ...node(), pan: { value: 0 } }; }
        createBuffer(_: number, length: number) { const data = new Float32Array(length), b = { getChannelData: () => data }; buffers.push(b); return b; }
        createBufferSource() { const s = { ...node(), start: vi.fn(), stop: vi.fn(), onended: null as (() => void) | null, loop: false, buffer: null }; sources.push(s); return s; }
    }
    const ctx = new Context(), forest = new ForestAmbience(ctx as unknown as AudioContext, {} as AudioNode);
    return { ctx, forest, sources, gains, buffers, Context };
}
const outside = { outside: true, x: 24, y: 24, volume: 1 };
describe('continuous bounded forest ambience', () => {
    it('continues beyond multiple loop lengths with exactly two sources and cached buffers', () => {
        const { forest, sources, buffers, ctx } = fixture(); forest.update(outside);
        for (let i = 0; i < 10000; i++) { ctx.currentTime += .1; forest.update({ ...outside, x: 24 + i % 14 }); }
        expect(sources).toHaveLength(2); expect(buffers).toHaveLength(2);
        for (const source of sources) { expect(source.loop).toBe(true); expect(source.start).toHaveBeenCalledTimes(1); expect(source.stop).not.toHaveBeenCalled(); }
    });
    it('keeps existing sources through browser suspension and allocates nothing until resumed', () => {
        const { forest, ctx, sources } = fixture(); ctx.state = 'suspended'; forest.update(outside); expect(sources).toHaveLength(0);
        ctx.state = 'running'; forest.update(outside); ctx.state = 'suspended'; forest.update(outside);
        expect(sources).toHaveLength(2); for (const source of sources) expect(source.stop).not.toHaveBeenCalled();
        ctx.state = 'running'; forest.update(outside); expect(sources).toHaveLength(2);
    });
    it('crossfades to indoor silence and back without duplicate loops, with positional fire and volume', () => {
        const { forest, gains, sources } = fixture(); forest.update(outside);
        expect(gains[0].gain.setTargetAtTime).toHaveBeenLastCalledWith(.14, 1, .15);
        expect(gains[1].gain.setTargetAtTime).toHaveBeenLastCalledWith(.32, 1, .15);
        forest.update({ ...outside, outside: false });
        for (const gain of gains) expect(gain.gain.setTargetAtTime).toHaveBeenLastCalledWith(0, 1, .045);
        forest.update({ ...outside, x: 40, volume: .5 });
        expect(gains[0].gain.setTargetAtTime).toHaveBeenLastCalledWith(.07, 1, .15);
        expect(gains[1].gain.setTargetAtTime).toHaveBeenLastCalledWith(0, 1, .045);
        forest.update({ ...outside, volume: 0 }); expect(gains[0].gain.setTargetAtTime).toHaveBeenLastCalledWith(0, 1, .045);
        expect(sources).toHaveLength(2);
    });
    it('reaches exact silence after a tiny edge gain, outside its radius and indoors', () => {
        const { forest, gains, ctx } = fixture();
        forest.update({ ...outside, x: 32.85 });
        const fire = gains[1].gain;
        expect(fire.setTargetAtTime.mock.lastCall![0]).toBeGreaterThan(0);
        expect(fire.setTargetAtTime.mock.lastCall![0]).toBeLessThan(.002);
        ctx.currentTime = 2;
        forest.update({ ...outside, x: 34 });
        expect(fire.setTargetAtTime).toHaveBeenLastCalledWith(0, 2, .045);
        expect(fire.setValueAtTime).toHaveBeenLastCalledWith(0, 2.18);
        const calls = fire.setTargetAtTime.mock.calls.length;
        forest.update({ ...outside, x: 60 });
        expect(fire.setTargetAtTime).toHaveBeenCalledTimes(calls);
        forest.update(outside); forest.update({ ...outside, outside: false });
        expect(fire.setValueAtTime).toHaveBeenLastCalledWith(0, 2.18);
    });
    it('recovers only an unexpectedly ended loop and reuses its buffer', () => {
        const { forest, sources, buffers } = fixture(); forest.update(outside); const old = sources[0]; old.onended(); forest.update(outside);
        expect(sources).toHaveLength(3); expect(sources[2].buffer).toBe(old.buffer); expect(buffers).toHaveLength(2);
        expect(sources[1].start).toHaveBeenCalledTimes(1); forest.update(outside); expect(sources).toHaveLength(3);
    });
    it('clears once on disconnect, reuses buffers on reconnect and releases them on dispose', () => {
        const { forest, sources, buffers } = fixture(); forest.update(outside); forest.clear(); forest.clear();
        for (const source of sources) { expect(source.stop).toHaveBeenCalledTimes(1); expect(source.onended).toBeNull(); }
        forest.update(outside); expect(sources).toHaveLength(4); expect(buffers).toHaveLength(2); forest.dispose();
        for (const source of sources) expect(source.stop).toHaveBeenCalledTimes(1);
    });
    it('starts from the latest forest location immediately after a user unlock and preserves game mute', async () => {
        const { sources, Context } = fixture(); vi.stubGlobal('AudioContext', Context);
        const audio = new SoundboardAudio(); const snapshot = { worldId: 'forest', serverTime: 1000, instanceId: 'forest', players: [{ id: 'self', x: 24, y: 24, vx: 0, vy: 0, connected: true, mode: 'home' }] } as Snapshot;
        audio.setWorld(snapshot, 'self', 1); expect(sources).toHaveLength(0);
        await audio.unlock(); expect(sources).toHaveLength(2); audio.setWorld(snapshot, 'self', 1); expect(sources).toHaveLength(2);
        audio.setMix(1, {}, new Set(), true); expect(sources[0].stop).not.toHaveBeenCalled();
        audio.setWorld(null, 'self', 0); for (const source of sources) expect(source.stop).toHaveBeenCalledTimes(1);
        audio.dispose();
    });
    it('recovers suspended audio on a real gesture without creating a new context or unmuting', async () => {
        const { sources, gains, Context } = fixture(); vi.stubGlobal('AudioContext', Context);
        const audio = new SoundboardAudio(); await audio.resumeAfterGesture(); expect(sources).toHaveLength(0);
        await audio.unlock(); const snapshot = { worldId: 'forest', serverTime: 1000, instanceId: 'forest', players: [{ id: 'self', x: 24, y: 24, vx: 0, vy: 0, connected: true, mode: 'home' }] } as Snapshot;
        audio.setWorld(snapshot, 'self', 1); audio.setMix(1, {}, new Set(), true);
        const context = (audio as unknown as { context: AudioContext }).context;
        Object.assign(context, { state: 'suspended' });
        await audio.resumeAfterGesture(); expect(context.state).toBe('running'); expect(sources).toHaveLength(2); expect(gains[0].gain.value).toBe(0);
        const calls = (context.resume as ReturnType<typeof vi.fn>).mock.calls.length;
        await audio.resumeAfterGesture(); expect(context.resume).toHaveBeenCalledTimes(calls);
        audio.dispose();
    });
    it('silences actual room audio in race/asylum and returns with the same two loops and independent mute', async () => {
        const { sources, gains, Context } = fixture(); vi.stubGlobal('AudioContext', Context);
        const audio = new SoundboardAudio(); await audio.unlock();
        const snapshot = { worldId: 'forest', serverTime: 1000, instanceId: 'forest', players: [{ id: 'self', x: 24, y: 24, vx: 0, vy: 0, connected: true, mode: 'home' }] } as Snapshot;
        audio.setWorld(snapshot, 'self', 1);
        for (const reason of ['race', 'asylum', 'offline'] as const) {
            const changed = structuredClone(snapshot);
            if (reason === 'race') changed.players[0]!.mode = 'race';
            if (reason === 'asylum') { changed.worldId = 'asylum'; changed.players[0]!.zone = 'asylum'; }
            if (reason === 'offline') changed.players[0]!.connected = false;
            audio.setWorld(changed, 'self', 1);
            expect(gains[1].gain.setTargetAtTime).toHaveBeenLastCalledWith(0, 1, .045);
            expect(gains[2].gain.setTargetAtTime).toHaveBeenLastCalledWith(0, 1, .045);
            audio.setWorld(snapshot, 'self', 1);
            for (const source of sources.slice(0,2)) { expect(source.start).toHaveBeenCalledTimes(1); expect(source.stop).not.toHaveBeenCalled(); }
        }
        audio.setMix(1, {}, new Set(), true); expect(gains[0].gain.value).toBe(0);
        audio.setMix(1, {}, new Set(), false); expect(gains[0].gain.value).toBe(1);
        audio.dispose(); for (const source of sources) expect(source.stop).toHaveBeenCalledTimes(1);
    });
});
