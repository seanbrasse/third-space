import { describe, expect, it } from 'vitest';
import { ForestWerewolf, WEREWOLF_DEFAULTS } from '../../apps/game-server/src/ForestWerewolf';
import { ForestEncounter } from '../../apps/game-server/src/ForestStalker';
import { getWorld, GAME_CONFIG, type WorldDefinition } from '../../packages/config/src/index';
import { createPlayer, distance, isHomeSegmentWalkable, isHomeWalkable } from '../../packages/simulation/src/index';

const world: WorldDefinition = { ...getWorld('forest'), map: { ...getWorld('forest').map, solids: [], furniture: [
    { id: 'far-tree', kind: 'tree', footprint: { x: 43, y: 43, width: 2, height: 3 }, collider: null, usePoints: [], seats: [] },
] } };
const player = (id = 'target') => ({ ...createPlayer(id, id), x: 30, y: 45 });
const fixture = (w = world) => { const wolf = new ForestWerewolf(w, () => .5), p = player(); wolf.reset(1000); return { wolf, p }; };
const spawn = (wolf: ForestWerewolf, p = player()) => { wolf.update(151000, [p]); expect(wolf.state?.kind).toBe('werewolf'); };

describe('authoritative rare werewolf', () => {
    it('uses five times the actual clown interval and faster than its peak stride', () => {
        expect(WEREWOLF_DEFAULTS.intervalMs).toBe(world.stalker!.intervalMs * 5);
        expect(WEREWOLF_DEFAULTS.speedMultiplier).toBeGreaterThan(1.35);
        const { wolf, p } = fixture(); wolf.update(150999, [p]); expect(wolf.state).toBeNull(); spawn(wolf, p);
    });
    it('spawns beyond every active player snapshot visibility boundary, including protected observers', () => {
        const { wolf, p } = fixture(); spawn(wolf, p); const point = { ...wolf.state! };
        expect(distance(point, p)).toBeGreaterThan(world.stalker!.viewRadius + 2);
        expect(wolf.visibleTo(p)).toBeNull();
        for (const protection of ['normal', 'halo', 'respawning', 'seated']) {
            const f = fixture(), observer = { ...player('observer'), ...point, id: 'observer' };
            if (protection === 'halo') observer.haloUntil = 999999;
            if (protection === 'respawning') observer.respawnAt = 999999;
            if (protection === 'seated') observer.seatId = 'seat';
            f.wolf.update(151000, [f.p, observer]); expect(f.wolf.state).toBeNull(); expect(f.wolf.drainSounds()).toEqual([]);
        }
    });
    it('defers without a candidate, retries safely, and excludes offline/race/indoor observers', () => {
        const { wolf, p } = fixture(), observer = { ...player('watcher'), x: 43, y: 45 };
        wolf.update(151000, [p, observer]); expect(wolf.state).toBeNull();
        wolf.update(155999, [p]); expect(wolf.state).toBeNull(); wolf.update(156000, [p]); expect(wolf.state).not.toBeNull();
        for (const reason of ['offline', 'race', 'indoor']) {
            const f = fixture(), o = { ...observer };
            if (reason === 'offline') o.connected = false;
            if (reason === 'race') o.mode = 'race';
            if (reason === 'indoor') o.zone = 'asylum';
            f.wolf.update(151000, [f.p, o]); expect(f.wolf.state).not.toBeNull();
        }
        const empty = fixture({ ...world, map: { ...world.map, furniture: [] } }); empty.wolf.update(151000, [empty.p]); expect(empty.wolf.state).toBeNull();
    });
    it('howls exactly once, growls live, skips catch-up bursts and never giggles', () => {
        const { wolf, p } = fixture(); spawn(wolf, p);
        expect(wolf.drainSounds().map(s => s.kind)).toEqual(['howl']);
        wolf.update(151000, [p]); expect(wolf.drainSounds()).toEqual([]);
        expect(wolf.state?.giggleAt).toBeUndefined(); wolf.update(154000, [p]); wolf.update(154500, [p]);
        const growl = wolf.drainSounds(); expect(growl.map(s => s.kind)).toEqual(['growl']);
        wolf.update(154500, [p]); expect(wolf.drainSounds()).toEqual([]);
        wolf.update(157200, [p]); expect(wolf.drainSounds().map(s => s.kind)).toEqual(['growl']);
    });
    it('gallops at the tuned speed, obeys swept collision, and catches once', () => {
        const { wolf, p } = fixture(); spawn(wolf, p); wolf.update(154000, [p]); const before = { ...wolf.state! };
        wolf.update(154100, [p]); expect(distance(before, wolf.state!)).toBeCloseTo(GAME_CONFIG.homeSpeed * 1.7 * .1);
        let catches = 0;
        for (let now = 154200; now <= 170000; now += 100) { const previous = wolf.state && { ...wolf.state }; if (wolf.update(now, [p])) catches++;
            if (previous && wolf.state?.phase === 'chase') expect(isHomeSegmentWalkable(previous, wolf.state, world.map)).toBe(true); }
        expect(catches).toBe(1);
    });
    it('routes around solids and cannot catch across an obstructed segment', () => {
        const w = { ...world, map: { ...world.map, solids: [{ x: 36, y: 38, width: 1, height: 15 }] } }, { wolf, p } = fixture(w);
        spawn(wolf, p); wolf.update(154000, [p]);
        for (let now = 154100; now < 167000; now += 100) { const previous = wolf.state && { ...wolf.state }; const caught = wolf.update(now, [p]);
            if (previous && wolf.state?.phase === 'chase') { expect(isHomeWalkable(wolf.state, w.map)).toBe(true); expect(isHomeSegmentWalkable(previous, wolf.state, w.map)).toBe(true); }
            if (caught) expect(isHomeSegmentWalkable(wolf.state!, p, w.map)).toBe(true); }
    });
    it('retreats on disconnect/race/zone/fire and resets cleanly on a world change', () => {
        for (const reason of ['disconnect', 'race', 'zone', 'fire']) { const { wolf, p } = fixture(); spawn(wolf, p); wolf.drainSounds(); wolf.update(154000, [p]);
            if (reason === 'disconnect') p.connected = false;
            if (reason === 'race') p.mode = 'race';
            if (reason === 'zone') p.zone = 'asylum';
            if (reason === 'fire') { p.x = 24; p.y = 24; }
            expect(wolf.update(154100, [p])).toBeNull(); expect(wolf.state?.phase).toBe('retreat'); expect(wolf.drainSounds()).toEqual([]);
        }
        const { wolf, p } = fixture(); spawn(wolf, p); wolf.reset(151001); expect(wolf.drainSounds()).toEqual([]); expect(wolf.state).toBeNull();
        wolf.update(301000, [p]); expect(wolf.state).toBeNull(); wolf.update(301001, [p]); expect(wolf.drainSounds()).toHaveLength(1);
    });
    it('keeps a safe-camp perimeter appearance five times rarer and never turns it into a hunt', () => {
        const campWorld = { ...world, map: { ...world.map, furniture: [{ ...world.map.furniture[0]!, footprint: { x: 37, y: 22, width: 2, height: 3 } }] } };
        const wolf = new ForestWerewolf(campWorld, () => .5), p = { ...player(), x: 24, y: 24 };
        wolf.reset(1000); wolf.update(1000, [p]); wolf.update(2250999, [p]); expect(wolf.state).toBeNull();
        wolf.update(2251000, [p]); expect(wolf.state?.intent).toBe('perimeter'); expect(wolf.visibleTo(p)).toBeNull();
        expect(wolf.drainSounds().map(s => s.kind)).toEqual(['howl']); wolf.update(2251900, [p]); expect(wolf.visibleTo(p)).not.toBeNull(); p.x = wolf.state!.x; p.y = wolf.state!.y;
        expect(wolf.update(2254000, [p])).toBeNull(); expect(wolf.state?.phase).toBe('retreat');
    });
    it('preserves the clown default profile', () => {
        const clown = new ForestEncounter(world, () => .5); clown.reset(1000); const p = { ...player(), x: 40, y: 45 }; clown.update(31000, [p]);
        expect(clown.state?.phase).toBe('peek'); expect(clown.state?.kind).toBeUndefined();
    });
});
