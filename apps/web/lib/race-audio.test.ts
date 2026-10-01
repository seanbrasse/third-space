import { afterEach, describe, expect, it, vi } from 'vitest';
import { RaceAudio, RaceAudioEvents, raceMusicAllowed, raceSamples } from './race-audio';
import { raceBoostLabel } from './race-presentation';
import { createPlayer, resetRacePlayer } from '@third-space/simulation';
import type { PlayerState, RoomSnapshot } from '@third-space/contracts';
const player = () => resetRacePlayer(createPlayer('self', 'Self'));
const snapshot = (at = 1, patch: Partial<PlayerState> = {}, instanceId = 'race-a') => ({
  instanceId, serverTime: at, players: [{ ...player(), ...patch }], race: { phase: 'running' },
}) as RoomSnapshot;
afterEach(() => vi.unstubAllGlobals());

describe('snapshot race audio deduplication', () => {
  it('baselines joining/reconnecting, ignores duplicate/out-of-order packets and scopes new races', () => {
    const events = new RaceAudioEvents();
    expect(events.observe(snapshot(10, { raceJumpCount: 2, raceDeathCount: 1 }), 'self')).toEqual([]);
    expect(events.observe(snapshot(11, { raceJumpCount: 3, raceDeathCount: 1 }), 'self')).toEqual(['jump']);
    expect(events.observe(snapshot(11, { raceJumpCount: 3, raceDeathCount: 1 }), 'self')).toEqual([]);
    expect(events.observe(snapshot(9, { raceJumpCount: 1 }), 'self')).toEqual([]);
    expect(events.observe(snapshot(12, { raceJumpCount: 3, raceDeathCount: 2 }), 'self')).toEqual(['death']);
    expect(events.observe(null, 'self')).toEqual([]);
    expect(events.observe(snapshot(13, { raceJumpCount: 5, raceDeathCount: 3 }), 'self')).toEqual([]);
    expect(events.observe(snapshot(14, { raceJumpCount: 6 }, 'race-b'), 'self')).toEqual([]);
  });
  it('does not replay on mode/disconnect changes or emit duplicate launch/death in a snapshot', () => {
    const events = new RaceAudioEvents(); events.observe(snapshot(), 'self');
    expect(events.observe(snapshot(2, { raceJumpCount: 4, raceDeathCount: 1, racePickupCount: 1 }), 'self')).toEqual(['death']);
    expect(events.observe(snapshot(3, { connected: false }), 'self')).toEqual([]);
    expect(events.observe(snapshot(4, { raceJumpCount: 5, raceDeathCount: 2 }), 'self')).toEqual([]);
    expect(events.observe(snapshot(5, { mode: 'home' }), 'self')).toEqual([]);
    expect(events.observe(snapshot(6, { raceJumpCount: 7 }), 'self')).toEqual([]);
    expect(events.observe(snapshot(7, { raceJumpCount: 8, racePickupCount: 2 }), 'self')).toEqual(['jump', 'pickup']);
  });
});

describe('original procedural race sounds', () => {
  it('generates deterministic finite unclipped cues/theme and a seamless quiet loop boundary', () => {
    for (const kind of ['theme', 'jump', 'death', 'pickup'] as const) {
      const a = raceSamples(kind, 8000), b = raceSamples(kind, 8000);
      expect(a).toEqual(b);
      expect([...a].every(v => Number.isFinite(v) && Math.abs(v) <= 1)).toBe(true);
      expect(a.some(v => Math.abs(v) > .1)).toBe(true);
      expect(Math.abs(a[0])).toBeLessThan(.001);
      expect(Math.abs(a.at(-1)!)).toBeLessThan(.001);
    }
  });
  it('shows bounded remaining personal boost durations with clear powers', () => {
    expect(raceBoostLabel(player())).toBe('');
    expect(raceBoostLabel({ ...player(), raceSpeedBoostSeconds: 2.3, raceJumpBoostSeconds: 4.5 })).toBe('SPEED +25% · 2.3s   JUMP +18% · 4.5s');
  });
});

function audioContext() {
  const sources: ReturnType<typeof source>[] = [], gains: ReturnType<typeof gain>[] = [];
  const node = () => ({ connect: vi.fn(), disconnect: vi.fn() });
  const source = () => ({ ...node(), buffer: null as unknown, loop: false, start: vi.fn(), stop: vi.fn(), onended: null as (() => void) | null });
  const gain = () => ({ ...node(), gain: { value: 0, setTargetAtTime: vi.fn() } });
  const ctx = { state: 'running', currentTime: 10, sampleRate: 8000, destination: {},
    createBuffer: (_channels: number, size: number) => { const data = new Float32Array(size); return { getChannelData: () => data }; },
    createBufferSource: () => { const s = source(); sources.push(s); return s; },
    createGain: () => { const g = gain(); gains.push(g); return g; },
  } as unknown as AudioContext;
  return { ctx, sources, gains };
}

describe('gesture, volume and race music lifecycle', () => {
  it('requires a running unlocked context, never replays locked cues, and starts exactly one loop', () => {
    const audio = new RaceAudio(), { ctx, sources } = audioContext();
    audio.setWorld(null, snapshot(1), 'self', .5);
    audio.setWorld(null, snapshot(2, { raceJumpCount: 1 }), 'self', .5);
    audio.setWorld(ctx, snapshot(3, { raceJumpCount: 1 }), 'self', .5);
    audio.setWorld(ctx, snapshot(3, { raceJumpCount: 1 }), 'self', .5);
    expect(sources).toHaveLength(1); expect(sources[0].loop).toBe(true);
    audio.setWorld(ctx, snapshot(4, { raceJumpCount: 2 }), 'self', .5);
    expect(sources).toHaveLength(2); expect(sources[1].loop).toBe(false);
    audio.dispose(); expect(sources.every(s => s.stop.mock.calls.length === 1)).toBe(true);
  });
  it('updates volume immediately on the bus, mutes and consumes muted events without playback', () => {
    const audio = new RaceAudio(), { ctx, sources, gains } = audioContext();
    audio.setWorld(ctx, snapshot(), 'self', .7); expect(gains[0].gain.value).toBe(.7);
    audio.setWorld(ctx, snapshot(2), 'self', .2); expect(gains[0].gain.value).toBe(.2);
    audio.setMuted(true); expect(gains[0].gain.value).toBe(0); expect(sources[0].stop).toHaveBeenCalledTimes(1);
    audio.setWorld(ctx, snapshot(3, { raceDeathCount: 1 }), 'self', .2); expect(sources).toHaveLength(1);
    audio.setMuted(false); audio.setWorld(ctx, snapshot(4, { raceDeathCount: 1 }), 'self', .2);
    expect(sources).toHaveLength(2); expect(sources[1].loop).toBe(true);
    audio.dispose();
  });
  it('stops in background, disconnect and leaving race; fades on finish/results', () => {
    const audio = new RaceAudio(), { ctx, sources } = audioContext();
    audio.setWorld(ctx, snapshot(), 'self', .5);
    audio.setWorld(ctx, snapshot(2, { raceJumpCount: 1 }), 'self', .5, false);
    expect(sources).toHaveLength(1); expect(sources[0].stop).toHaveBeenCalled();
    audio.setWorld(ctx, snapshot(3, { raceJumpCount: 1 }), 'self', .5, true);
    expect(sources).toHaveLength(2);
    audio.setWorld(ctx, snapshot(4, { finishedAt: 4, raceJumpCount: 1 }), 'self', .5);
    expect(sources[1].stop).toHaveBeenCalledWith(10.15);
    audio.setWorld(ctx, snapshot(5, { mode: 'home' }), 'self', .5);
    audio.setWorld(ctx, snapshot(6, { connected: false }), 'self', .5);
    expect(sources).toHaveLength(2); audio.dispose();
    expect(raceMusicAllowed(snapshot(), player(), false)).toBe(false);
    expect(raceMusicAllowed({ ...snapshot(), race: { ...snapshot().race!, phase: 'lobby' } }, player(), true)).toBe(false);
    expect(raceMusicAllowed({ ...snapshot(), race: { ...snapshot().race!, phase: 'results' } }, player(), true)).toBe(false);
  });
  it('handles document visibility immediately without waiting for the next packet', () => {
    let handler = () => {};
    const doc = { hidden: false, addEventListener: vi.fn((_name: string, fn: () => void) => { handler = fn; }), removeEventListener: vi.fn() };
    vi.stubGlobal('document', doc);
    const audio = new RaceAudio(), { ctx, sources } = audioContext();
    audio.setWorld(ctx, snapshot(), 'self', .5);
    doc.hidden = true; handler(); expect(sources[0].stop).toHaveBeenCalledTimes(1);
    doc.hidden = false; handler(); audio.setWorld(ctx, snapshot(5, { raceJumpCount: 3 }), 'self', .5);
    expect(sources).toHaveLength(2); expect(sources[1].loop).toBe(true);
    audio.dispose(); expect(doc.removeEventListener).toHaveBeenCalledWith('visibilitychange', handler);
  });
});
