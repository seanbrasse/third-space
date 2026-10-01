import { describe, expect, it } from 'vitest';
import { ForestEncounter } from '../../apps/game-server/src/ForestStalker';
import { ForestWerewolf } from '../../apps/game-server/src/ForestWerewolf';
import { ENCOUNTER_TUNING as T, encounterSegmentSafe } from '../../apps/game-server/src/encounter-tuning';
import { getWorld, type WorldDefinition } from '../../packages/config/src/index';
import { createPlayer, distance, isHomeSegmentWalkable } from '../../packages/simulation/src/index';
const world: WorldDefinition = { ...getWorld('forest'), map: { ...getWorld('forest').map, solids: [], furniture: [] } };
const player = (id = 'a', x = 45, y = 45) => ({ ...createPlayer(id, id), x, y });
function fixture(wolf = false, w = world) {
    const e = wolf ? new ForestWerewolf(w, () => .5) : new ForestEncounter(w, () => .5);
    e.reset(1000); e.state = { id: 'active', x: 40, y: 45, originX: 40, originY: 45, targetId: 'a', coverId: 'tree', intent: 'hunt', phase: 'chase', startedAt: 1000, phaseUntil: 100000 };
    return e;
}
describe('aggressive but telegraphed encounter pacing', () => {
    it('emits a reliable live acquisition giggle, then only distinct acquisitions after the 5-second cooldown', () => {
        const w = { ...world, map: { ...world.map, furniture: [{ id: 'tree', kind: 'tree' as const, footprint: { x: 34, y: 12, width: 2, height: 3 }, collider: null, usePoints: [], seats: [] }] } };
        const e = new ForestEncounter(w, () => .9), p = player('a', 35, 18); e.reset(1000); e.update(40000, [p]);
        const cues = e.drainSounds(); expect(cues).toHaveLength(1); expect(cues[0]?.kind).toBe('giggle'); expect(cues[0]?.id).toContain(':acquire:');
        e.update(40001, [p]); expect(e.drainSounds()).toEqual([]);
        p.zone = 'asylum'; const b = player('b', 37, 18); e.update(41000, [p, b]); expect(e.state?.targetId).toBe('b'); expect(e.drainSounds()).toEqual([]);
        b.zone = 'asylum'; p.zone = undefined; e.update(46000, [p, b]); const retarget = e.drainSounds(); expect(retarget).toHaveLength(1); expect(retarget[0]?.id).not.toBe(cues[0]?.id);
        e.update(46001, [p, b]); expect(e.drainSounds()).toEqual([]);
        e.reset(47000); expect(e.drainSounds()).toEqual([]);
    });
    it('switches mid-chase only for a substantial advantage, then holds target through cooldown', () => {
        const e = fixture(), a = player('a', 49, 45), b = player('b', 42, 45);
        e.update(2000, [a, b]); expect(e.state?.targetId).toBe('b'); expect(e.state?.phase).toBe('peek');
        expect(e.state?.phaseUntil).toBe(2000 + T.retargetWarningMs);
        e.update(2900, [a, b]); expect(e.state?.phase).toBe('chase');
        a.x = 40.9; b.x = 49;
        e.update(3000, [a, b]); expect(e.state?.targetId).toBe('b');
        e.update(4500, [a, b]); expect(e.state?.targetId).toBe('a'); expect(e.state?.phase).toBe('peek');
    });
    it('avoids distance-tie jitter and excludes protected closer observers', () => {
        const e = fixture(), a = player('a', 45, 45), b = player('b', 44.5, 45), halo = player('halo', 41, 45); halo.haloUntil = 100000;
        const indoors = player('indoors', 40.5, 45); indoors.zone = 'asylum';
        e.update(2000, [a, b, halo, indoors]); expect(e.state?.targetId).toBe('a'); expect(T.wolfStride).toBeLessThan(T.clownStride);
    });
    it('makes an initially hidden wolf visibly peek before chasing and howls only once', () => {
        const w = { ...world, map: { ...world.map, furniture: [{ id: 'tree', kind: 'tree' as const, footprint: { x: 43, y: 43, width: 2, height: 3 }, collider: null, usePoints: [], seats: [] }] } };
        const e = new ForestWerewolf(w, () => .5), p = player('a', 30, 45);
        e.reset(1000); e.update(91000, [p]); expect(e.visibleTo(p)).toBeNull(); expect(e.drainSounds().map(s => s.kind)).toEqual(['howl']);
        e.update(92800, [p]); expect(e.visibleTo(p)?.phase).toBe('peek'); expect(distance(e.state!, p)).toBeGreaterThanOrEqual(7.5);
        expect(e.update(93999, [p])).toBeNull(); expect(e.state?.phase).toBe('peek');
        e.update(94000, [p]); expect(e.state?.phase).toBe('chase'); expect(e.drainSounds()).toEqual([]);
    });
    it('winds up visibly without movement, commits a fixed endpoint, allows a dodge and respects cooldown', () => {
        const e = fixture(true), p = player('a', 43.5, 45);
        expect(e.update(2000, [p])).toBeNull(); const leap = { ...e.state!.leap! };
        expect(leap.phase).toBe('windup'); expect(leap.until).toBe(2800);
        e.update(2799, [p]); expect(e.state?.x).toBe(40); expect(e.state?.y).toBe(45);
        p.y = 47; e.update(2800, [p]); expect(e.state?.leap?.phase).toBe('air'); expect(e.state?.leap?.toY).toBe(45);
        let prev = { ...e.state! };
        for (let t = 2850; t <= 3250; t += 50) { expect(e.update(t, [p])).toBeNull(); expect(isHomeSegmentWalkable(prev, e.state!, world.map)).toBe(true); prev = { ...e.state! }; }
        expect(e.state?.x).toBe(43.5); expect(e.state?.y).toBe(45); expect(e.state?.leap).toBeUndefined();
        e.update(3400, [p]); expect(e.state?.x).toBe(43.5);
        p.x = 47; p.y = 45; e.update(3700, [p]); expect(e.state?.leap).toBeUndefined();
        p.x = e.state!.x + 3.5; e.update(8500, [p]); expect(e.state?.leap?.phase).toBe('windup');
    });
    it.each(['asylum', 'campfire', 'disconnect', 'halo'])('cancels a windup when target becomes safe by %s', reason => {
        const e = fixture(true), p = player('a', 43.5, 45); e.update(2000, [p]); expect(e.state?.leap).toBeDefined();
        if (reason === 'asylum') p.zone = 'asylum';
        if (reason === 'campfire') { p.x = 24; p.y = 24; }
        if (reason === 'disconnect') p.connected = false;
        if (reason === 'halo') p.haloUntil = 100000;
        expect(e.update(2100, [p])).toBeNull(); expect(e.state?.leap).toBeUndefined(); expect(e.state?.phase).toBe('retreat');
    });
    it('retreats instead of starting a wolf hunt whose cover blocked the visible peek', () => {
        const w = { ...world, map: { ...world.map, solids: [{ x:41,y:38,width:1,height:15 }], furniture:[{id:'tree',kind:'tree' as const,footprint:{x:43,y:43,width:2,height:3},collider:null,usePoints:[],seats:[]}] } };
        const e=new ForestWerewolf(w,()=>.5),p=player('a',30,45);e.reset(1000);e.update(91000,[p]);e.update(94000,[p]);
        expect(e.state?.phase).toBe('retreat');expect(e.state?.leap).toBeUndefined();
    });
    it('will not leap through walls or across a sanctuary chord even when its endpoint is safe', () => {
        const w = { ...world, map: { ...world.map, solids: [{ x: 41, y: 44, width: .5, height: 2 }] } }, e = fixture(true, w), p = player('a', 43.5, 45);
        e.update(2000, [p]); expect(e.state?.leap).toBeUndefined();
        expect(encounterSegmentSafe({ x: 14, y: 24 }, { x: 34, y: 24 }, world)).toBe(false);
        expect(encounterSegmentSafe({ x: 40, y: 45 }, { x: 43.5, y: 45 }, world)).toBe(true);
    });
    it('never teleports a hit during windup/flight or the post-landing reaction window', () => {
        const e = fixture(true), p = player('a', 43.5, 45);
        for (const t of [2000, 2500, 2800, 3000, 3250, 3649]) expect(e.update(t, [p])).toBeNull();
        expect(e.update(3650, [p])).toBe('a'); expect(e.state?.phase).toBe('retreat');
    });
});
