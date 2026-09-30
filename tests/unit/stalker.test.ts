import { describe, it, expect } from 'vitest';
import { ForestEncounter } from '../../apps/game-server/src/ForestStalker';
import { getWorld, type WorldDefinition } from '../../packages/config/src/index';
import { createPlayer, isHomeWalkable, isHomeSegmentWalkable, distance } from '../../packages/simulation/src/index';
const world: WorldDefinition = { ...getWorld('forest'), map: { ...getWorld('forest').map, solids: [], furniture: [{ id: 'tree', kind: 'tree', footprint: { x: 34, y: 12, width: 2, height: 3 }, collider: null, usePoints: [], seats: [] }] } };
function fixture(w = world) { const encounter = new ForestEncounter(w, () => .5), p = createPlayer('explorer', 'Explorer'); p.x = 35; p.y = 18; encounter.reset(1000); return { encounter, p }; }
function spawn(e: ForestEncounter, p: ReturnType<typeof createPlayer>) { e.update(31000, [p]); expect(e.state?.phase).toBe('peek'); }
describe('one shared forest encounter', () => {
    it('waits around thirty seconds and only schedules eligible explorers near cover', () => { const { encounter: e, p } = fixture(); e.update(30999, [p]); expect(e.state).toBeNull(); spawn(e, p); const id = e.state!.id; e.update(31001, [p]); expect(e.state!.id).toBe(id); expect(e.state!.coverId).toBe('tree'); });
    it('never spawns for campfire, disconnected, racing or recently respawned avatars', () => { for (const kind of ['safe', 'offline', 'race', 'halo']) {
        const { encounter: e, p } = fixture();
        if (kind === 'safe') {
            p.x = 24;
            p.y = 28;
        }
        if (kind === 'offline')
            p.connected = false;
        if (kind === 'race')
            p.mode = 'race';
        if (kind === 'halo')
            p.haloUntil = 40000;
        e.update(31000, [p]);
        expect(e.state).toBeNull();
    } });
    it('shows the same single stalker only in its local area', () => { const { encounter: e, p } = fixture(); spawn(e, p); expect(e.visibleTo(p)?.id).toBe(e.state!.id); const far = { ...p, x: 2, y: 2 }; expect(e.visibleTo(far)).toBeNull(); expect(e.visibleTo({ ...p, mode: 'race' })).toBeNull(); });
    it('pursues a moving target, catches once and then retreats', () => { const { encounter: e, p } = fixture(); spawn(e, p); e.update(34000, [p]); expect(e.state?.phase).toBe('chase'); const before = { ...e.state! }; p.x = 37; p.y = 19; e.update(34100, [p]); expect(distance(e.state!, p)).toBeLessThan(distance(before, p)); let catches = 0; for (let now = 34200; now < 50000; now += 100)
        if (e.update(now, [p]))
            catches++; expect(catches).toBe(1); expect(e.state).toBeNull(); });
    it('breaks off immediately when the target returns to fire, disconnects or enters a race', () => { for (const reason of ['safe', 'offline', 'race']) {
        const { encounter: e, p } = fixture();
        spawn(e, p);
        e.update(34000, [p]);
        if (reason === 'safe') {
            p.x = 24;
            p.y = 28;
        }
        if (reason === 'offline')
            p.connected = false;
        if (reason === 'race')
            p.mode = 'race';
        expect(e.update(34100, [p])).toBeNull();
        expect(e.state?.phase).toBe('retreat');
        e.update(35100, [p]);
        expect(e.state).toBeNull();
    } });
    it('routes around map solids and cannot catch through a wall', () => { const w = { ...world, map: { ...world.map, solids: [{ x: 33, y: 16, width: 6, height: 1 }] } }; const { encounter: e, p } = fixture(w); spawn(e, p); e.update(34000, [p]); let previous = { ...e.state! }; for (let now = 34100; now < 45000; now += 100) {
        e.update(now, [p]);
        if (e.state?.phase !== 'chase')
            break;
        expect(isHomeWalkable(e.state, w.map)).toBe(true);
        expect(isHomeSegmentWalkable(previous, e.state, w.map)).toBe(true);
        previous = { ...e.state };
    } });
    it('reset removes old encounters and starts a fresh cadence', () => { const { encounter: e, p } = fixture(); spawn(e, p); e.reset(32000); expect(e.state).toBeNull(); e.update(61000, [p]); expect(e.state).toBeNull(); e.update(62000, [p]); expect(e.state?.phase).toBe('peek'); });
});
