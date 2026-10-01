import { describe, expect, it } from 'vitest';
import { ForestEncounter } from '../../apps/game-server/src/ForestStalker';
import { ForestWerewolf, WEREWOLF_DEFAULTS } from '../../apps/game-server/src/ForestWerewolf';
import { getWorld, type WorldDefinition } from '../../packages/config/src/index';
import { createPlayer, distance } from '../../packages/simulation/src/index';
const world: WorldDefinition = { ...getWorld('forest'), map: { ...getWorld('forest').map, solids: [], furniture: [
    { id: 'tree', kind: 'tree', footprint: { x: 34, y: 12, width: 2, height: 3 }, collider: null, usePoints: [], seats: [] },
] } };
const player = (id: string, x = 35, y = 18) => ({ ...createPlayer(id, id), x, y });
const fixture = () => { const e = new ForestEncounter(world, () => .5), p = player('target'); e.reset(1000); e.update(31000, [p]); e.update(34000, [p]); return { e, p }; };
describe('room-owned target changes and dark linger', () => {
    it.each(['fire', 'asylum', 'disconnect', 'race', 'halo', 'respawn'])('abandons %s and warns before chasing the nearest exposed friend', reason => {
        const { e, p } = fixture(), near = player('near', e.state!.x + 1, e.state!.y), far = player('far', 40, 18);
        if (reason === 'fire') { p.x = 24; p.y = 24; }
        if (reason === 'asylum') p.zone = 'asylum';
        if (reason === 'disconnect') p.connected = false;
        if (reason === 'race') p.mode = 'race';
        if (reason === 'halo') p.haloUntil = 50000;
        if (reason === 'respawn') p.respawnAt = 50000;
        expect(e.update(34100, [p, far, near])).toBeNull();
        expect(e.state?.targetId).toBe('near'); expect(e.state?.phase).toBe('peek');
        expect(e.update(34101, [p, far, near])).toBeNull();
        expect(e.state?.phaseUntil).toBe(34100 + world.stalker!.peekMs);
    });
    it('retreats, hides, holds one shared encounter for 15 seconds and reacquires an emerging player with warning', () => {
        const { e, p } = fixture(), id = e.state!.id; p.zone = 'asylum';
        e.update(34100, [p]); expect(e.state?.phase).toBe('retreat');
        const observer = player('observer', e.state!.originX!, e.state!.originY!);
        e.update(35000, [p]); expect(e.visibleTo(observer)).toBeNull();
        e.update(48000, [p]); expect(e.state?.id).toBe(id);
        p.zone = undefined; p.x = observer.x; p.y = observer.y;
        expect(e.update(48100, [p])).toBeNull(); expect(e.state?.id).toBe(id);
        expect(e.state?.phase).toBe('peek'); expect(e.visibleTo(p)?.id).toBe(id);
        expect(e.update(48101, [p])).toBeNull();
    });
    it('expires exactly at 15 seconds and never reacquires sanctuary, halo, indoor or offline players', () => {
        const { e, p } = fixture(); p.zone = 'asylum'; e.update(34100, [p]);
        const fire = player('fire', 24, 24), halo = player('halo'); halo.haloUntil = 90000;
        const offline = player('offline'); offline.connected = false;
        e.update(49099, [p, fire, halo, offline]); expect(e.state?.phase).toBe('retreat');
        e.update(49100, [p, fire, halo, offline]); expect(e.state).toBeNull();
    });
    it('does not treat a personal flashlight as sanctuary or hit a new target without its peek delay', () => {
        const { e, p } = fixture(); p.connected = false; const light = player('light', e.state!.x, e.state!.y); light.flashlightOn = true;
        expect(e.update(34100, [p, light])).toBeNull(); expect(e.state?.targetId).toBe('light');
        expect(e.update(34101, [p, light])).toBeNull(); expect(e.update(37100, [p, light])).toBeNull();
        expect(e.update(37101, [p, light])).toBe('light');
        expect(e.update(39000, [p, light])).toBeNull();
    });
    it('does not carry a caught identity exclusion into a later encounter', () => {
        const { e, p } = fixture(); p.x = e.state!.x; p.y = e.state!.y;
        expect(e.update(34100, [p])).toBe(p.id);
        e.update(49100, [p]); expect(e.state).toBeNull();
        p.x = 35; p.y = 18; e.update(61000, [p]); expect(e.state?.targetId).toBe(p.id);
    });
    it('chooses players uniformly rather than weighting their available cover count', () => {
        const w = { ...world, map: { ...world.map, furniture: [...world.map.furniture, { ...world.map.furniture[0]!, id: 'second-tree', footprint: { x: 42, y: 12, width: 2, height: 3 } }] } };
        const a = player('a', 35, 18), b = player('b', 41, 18);
        for (const [random, target] of [[.1, 'a'], [.9, 'b']] as const) {
            const e = new ForestEncounter(w, () => random); e.reset(1000); e.update(40000, [a, b]);
            expect(e.state?.targetId).toBe(target); expect(distance(e.state!, target === 'a' ? a : b)).toBeGreaterThanOrEqual(2.5);
        }
    });
    it('uses the same retarget policy for wolves without replaying the spawn howl', () => {
        const w = { ...world, map: { ...world.map, furniture: [{ ...world.map.furniture[0]!, footprint: { x: 43, y: 43, width: 2, height: 3 } }] } };
        const e = new ForestWerewolf(w, () => .5), p = player('wolf-target', 30, 45); e.reset(1000); e.update(91000, [p]);
        expect(e.drainSounds().map(s => s.kind)).toEqual(['howl']);
        p.zone = 'asylum'; const friend = player('friend', 40, 45);
        expect(e.update(91100, [p, friend])).toBeNull(); expect(e.state?.targetId).toBe('friend');
        expect(e.drainSounds()).toEqual([]); expect(WEREWOLF_DEFAULTS.intervalMs).toBe(90000);
    });
});
