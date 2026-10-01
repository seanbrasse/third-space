import { describe, expect, it, vi } from 'vitest';
import { getWorld, type Point } from '@third-space/config';
import { createPlayer, distance, isHomeSegmentWalkable, isHomeWalkable } from '@third-space/simulation';
import type { ForestNPC } from '../../packages/contracts/src/forest-npc';
import type { SpendKnifeSwing } from '../../apps/game-server/src/ForestCombatEncounters';
import { npcSegmentOutsideFire } from '../../apps/game-server/src/ForestNPCController';
import { SURVIVAL } from '../../apps/game-server/src/survival-inventory';
import { GoblinPatrol, GOBLIN_PATROL_RULES as R, STOLEN_LANTERN_GOBLINS, type GoblinPatrolContext, type GoblinPatrolDefinition, type GoblinPatrolHuman } from '../../apps/game-server/src/GoblinPatrol';

const base = getWorld('forest');
const world = { ...base, map: { ...base.map, solids: [], furniture: [] } };
const def: GoblinPatrolDefinition = { id: 'mob:stolen-lantern:test', name: 'Test goblin', home: { x: 50, y: 50 }, patrol: [{ x: 50, y: 50 }, { x: 52, y: 50 }] };
const epoch = 1_790_000_000_000;
function human(id = 'human', point: Point = { x: 50.8, y: 50 }): GoblinPatrolHuman { return { ...createPlayer(id, id), ...point, health: 100, armed: true, lifeRevision: 0, zoneRevision: 0 }; }
function npc(id = 'npc:civilian', point: Point = { x: 50.7, y: 50 }): ForestNPC { return { ...createPlayer(id, id), ...point, name: id, role: 'Worker', art: 'villager', activity: 'working', phase: 'wander', moving: false, health: 100, maxHealth: 100, lifeRevision: 0 }; }
function setup(definitions: readonly GoblinPatrolDefinition[] = [def]) { return new GoblinPatrol(world, { definitions, sessionId: 'test' }); }
function mob(c: GoblinPatrol) { return c.snapshot().mobs[0]!; }
function gate() {
  const cooldowns = new Map<string, number>();
  return vi.fn<SpendKnifeSwing>((actor, _target, now) => {
    if (now - (cooldowns.get(actor.id) ?? -Infinity) < SURVIVAL.attackCooldownMs) return { ok: false, reason: 'Knife is recovering' };
    cooldowns.set(actor.id, now); return { ok: true, deaths: [] };
  });
}
function humanWindup(c: GoblinPatrol, p = human(), context: GoblinPatrolContext = {}, now = epoch) {
  c.update(now, [p], [], context); expect(mob(c).windup).toBeUndefined();
  c.update(now + R.firstTellMs, [p], [], context);
  expect(mob(c).windup).toMatchObject({ x: p.x, y: p.y, radius: R.attackRadius, until: now + R.firstTellMs + R.windupMs });
  return { p, tell: mob(c).windup! };
}

describe('stolen-lantern goblin patrol', () => {
  it('patrols the real outdoor cave/pond map on bounded walkable paths without humans or rendering interest', () => {
    const c = new GoblinPatrol(base), moved = new Set<string>();
    expect(c.snapshot().mobs).toHaveLength(2);
    expect(c.snapshot().mobs.map(m => m.name)).toEqual(['Grib Wickfinger', 'Skrit Reedknife']);
    expect(c.snapshot().mobs.every(m => m.id.startsWith('mob:stolen-lantern:') && m.kind === 'bramble-raider')).toBe(true);
    for (let now = epoch; now <= epoch + 30000; now += 100) {
      const before = c.snapshot().mobs;
      expect(c.update(now, [], [])).toEqual({ damage: [], snares: [] });
      for (const [i, m] of c.snapshot().mobs.entries()) {
        expect(isHomeWalkable(m, base.map)).toBe(true);
        expect(isHomeSegmentWalkable(before[i]!, m, base.map)).toBe(true);
        expect(npcSegmentOutsideFire(before[i]!, m, base)).toBe(true);
        expect(distance(m, STOLEN_LANTERN_GOBLINS[i]!.home)).toBeLessThanOrEqual(R.leashRadius);
        expect(distance(before[i]!, m)).toBeLessThanOrEqual(R.patrolSpeed * .1 + 1e-8);
        if (m.moving) moved.add(m.id);
      }
      expect(c.diagnostics().lastPathQueries).toBeLessThanOrEqual(1);
    }
    expect(moved.size).toBe(2);
  });

  it('rejects invalid route definitions, caps hostiles at two and defensively copies routes/snapshots', () => {
    for (const invalid of [{ ...def, id: 'npc:goblin-pip' }, { ...def, home: { x: 24, y: 24 } }, { ...def, patrol: [] }, { ...def, patrol: [{ x: 80, y: 50 }] }, { ...def, patrol: Array(9).fill(def.home) }, { ...def, home: { x: NaN, y: 50 } }]) expect(setup([invalid]).snapshot().mobs).toEqual([]);
    const input = structuredClone(def), c = setup([input, { ...def, id: `${def.id}-2` }, { ...def, id: `${def.id}-3` }]);
    expect(c.snapshot().mobs).toHaveLength(2); input.home.x = 99;
    const copy = c.snapshot(); copy.mobs[0]!.x = 999; expect(mob(c).x).toBe(50);
    expect(setup([def, def]).snapshot().mobs).toHaveLength(1);
  });

  it('both authored patrols can reach actual orchard/pond civilians while eight observers remain outside acquisition range', () => {
    const c = new GoblinPatrol(base), civilians = [npc('npc:orchard-worker-mara', { x: 56, y: 84 }), npc('npc:washer-elsie', { x: 99, y: 68 })];
    const humans = [human('cave-observer', { x: 75, y: 82 }), human('pond-observer', { x: 110, y: 72 }), ...Array.from({ length: 6 }, (_, i) => human(`camp-${i}`, { x: 24, y: 24 }))];
    const attackers = new Set<string>();
    for (let now = epoch; now < epoch + 35000; now += 100) for (const hit of c.update(now, humans, civilians).damage) {
      expect(hit.targetKind).toBe('npc'); expect(civilians.some(n => n.id === hit.targetId)).toBe(true); attackers.add(hit.mobId);
    }
    expect([...attackers].sort()).toEqual(STOLEN_LANTERN_GOBLINS.map(g => g.id).sort());
  });

  it('autonomously threatens a civilian and emits authoritative once-only NPC damage with a full first tell', () => {
    const c = setup(), p = human('witness', { x: 54, y: 50 }), n = npc();
    c.update(epoch, [p], [n]);
    expect(c.snapshot().encounters[0]!.phase).toBe('active');
    expect(c.update(epoch + 999, [p], [n]).damage).toEqual([]); expect(mob(c).windup).toBeUndefined();
    c.update(epoch + 1000, [p], [n]); const tell = mob(c).windup!;
    expect(tell).toMatchObject({ x: n.x, y: n.y, until: epoch + 1900 });
    const hit = c.update(tell.until, [p], [n]).damage;
    expect(hit).toEqual([{ id: expect.any(String), mobId: def.id, targetId: n.id, targetKind: 'npc', targetLifeRevision: 0, targetZoneRevision: 0, amount: 10, occurredAt: tell.until }]);
    expect(c.update(tell.until, [p], [n]).damage).toEqual([]);
    c.update(tell.until + R.recoveryMs - 1, [p], [n]); expect(mob(c).windup).toBeUndefined();
    c.update(tell.until + R.recoveryMs, [p], [n]);
    const next = c.update(mob(c).windup!.until, [p], [n]).damage;
    expect(next).toHaveLength(1); expect(next[0]!.id).not.toBe(hit[0]!.id);
  });

  it.each([
    { connected: false }, { mode: 'race' as const }, { zone: 'interior:lantern-cave' }, { haloUntil: epoch + 100000 },
    { watching: true }, { seatId: 'bench' }, { respawnAt: epoch + 100000 }, { health: 0 }, { health: NaN },
    { x: 24, y: 24 }, { x: 100, y: 90 }, { id: 'npc:fake' }, { id: 'mob:fake' }, { lifeRevision: NaN }, { zoneRevision: Infinity },
  ])('does not awaken attacks on civilians for an ineligible area observer %j', protection => {
    const c = setup(), p = { ...human('observer', { x: 54, y: 50 }), ...protection }, n = npc();
    for (let now = epoch; now <= epoch + 6000; now += 100) {
      expect(c.update(now, [p], [n]).damage).toEqual([]); expect(mob(c).windup).toBeUndefined();
    }
    expect(c.snapshot().encounters[0]!.phase).toBe('idle');
  });

  it('excludes Ada, recovering or root-protected Mara, protected IDs, wildlife and spirits from civilian selection', () => {
    for (const [n, context] of [
      [npc('npc:keeper-ada'), {}], [Object.assign(npc('npc:orchard-worker-mara'), { activity: 'recovering' as const }), {}],
      [npc('npc:orchard-worker-mara'), { isProtectedNpc: () => true }], [npc(), { protectedNpcIds: ['civilian'] }],
      [npc(), { protectedNpcIds: new Set(['npc:civilian']) }], [Object.assign(npc(), { art: 'duck' as const }), {}],
      [Object.assign(npc(), { art: 'spirit' as const }), {}], [Object.assign(npc(), { health: Infinity }), {}],
    ] as [ForestNPC, GoblinPatrolContext][]) {
      const c = setup(), p = human('observer', { x: 61, y: 50 });
      for (let now = epoch; now < epoch + 5000; now += 100) expect(c.update(now, [p], [n], context).damage).toEqual([]);
      expect(c.snapshot().encounters[0]!.phase).toBe('idle');
    }
  });

  it('honors NPC LOS and cancels when root protection appears during a tell', () => {
    const blocked = { ...world, map: { ...world.map, solids: [{ x: 50.3, y: 49, width: .3, height: 2 }] } };
    const c = new GoblinPatrol(blocked, { definitions: [def] }), p = human('observer', { x: 49, y: 53 }), n = npc('npc:worker', { x: 51.4, y: 50 });
    c.update(epoch, [p], [n]); c.update(epoch + 1000, [p], [n]);
    expect(mob(c).windup).toBeUndefined();
    const open = setup(); open.update(epoch, [p], [npc()]); open.update(epoch + 1000, [p], [npc()]);
    expect(open.update(epoch + 1900, [p], [npc()], { isProtectedNpc: () => true }).damage).toEqual([]);
    expect(mob(open).phase).toBe('returning');
  });

  it('does not acquire a target through the campfire boundary even when both endpoints are outside it', () => {
    const home = { x: 33.45, y: 26 }, c = setup([{ ...def, home, patrol: [home] }]);
    const p = human('observer', { x: 44, y: 26 }), n = npc('npc:worker', { x: 33.45, y: 22 });
    expect(c.snapshot().mobs).toHaveLength(1); expect(npcSegmentOutsideFire(n, n, world)).toBe(true);
    expect(isHomeSegmentWalkable(home, n, world.map)).toBe(true); expect(npcSegmentOutsideFire(home, n, world)).toBe(false);
    for (let now = epoch; now < epoch + 5000; now += 100) expect(c.update(now, [p], [n]).damage).toEqual([]);
    expect(c.snapshot().encounters[0]!.phase).toBe('idle');
  });

  it.each([{ zone: 'interior:lantern-cave' }, { zoneRevision: 1 }, { lifeRevision: 1 }, { connected: false }, { watching: true }, { seatId: 'bench' }, { haloUntil: epoch + 9999 }, { respawnAt: epoch + 9999 }, { health: 0 }, { x: 24, y: 24 }, { x: NaN }, { lifeRevision: Infinity }])('fences human damage against live context changes %j', change => {
    const c = setup(), { p, tell } = humanWindup(c);
    Object.assign(p, change); expect(c.update(tell.until, [p], []).damage).toEqual([]);
    expect(mob(c).windup).toBeUndefined();
  });

  it('commits a fixed impact point that can be dodged without transferring damage to bystanders', () => {
    const c = setup(), { p, tell } = humanWindup(c), bystander = human('other', tell);
    p.y += tell.radius + .1;
    expect(c.update(tell.until, [p, bystander], []).damage).toEqual([]);
    expect(tell.y).toBe(50); expect(mob(c).phase).toBe('recovering');
  });

  it('rejects stale tells after a server pause, backward/nonfinite time, and caps elapsed movement', () => {
    const c = setup(), { p, tell } = humanWindup(c);
    expect(c.update(tell.until + R.impactGraceMs + 1, [p], []).damage).toEqual([]);
    const before = c.snapshot();
    for (const now of [NaN, Infinity, -1, epoch]) { expect(c.update(now, [p], [])).toEqual({ damage: [], snares: [] }); expect(c.snapshot()).toEqual(before); expect(c.diagnostics().lastPathQueries).toBe(0); }
    const idle = setup(); idle.update(epoch, [], []); const prior = mob(idle);
    idle.update(epoch + 1000000, [], []); expect(distance(prior, mob(idle))).toBeLessThanOrEqual(.08 + 1e-8);
  });

  it('a ward repels goblins and protects nearby civilians; expiration restores ordinary eligibility', () => {
    const c = setup(), p = human('warder', { x: 53, y: 50 }), n = npc(); p.wardUntil = epoch + 5000;
    let largestDistance = 0;
    for (let now = epoch; now <= epoch + 4500; now += 100) { expect(c.update(now, [p], [n]).damage).toEqual([]); largestDistance = Math.max(largestDistance, distance(p, mob(c))); }
    expect(largestDistance).toBeGreaterThan(4); expect(mob(c).phase).toBe('returning');
    const hits = [];
    for (let now = epoch + 5000; now < epoch + 17000; now += 100) hits.push(...c.update(now, [p], [n]).damage);
    expect(hits.some(h => h.targetId === n.id)).toBe(true);
  });

  it('wards and night light cancel committed attacks; a turned-off or backward beam does not grant protection', () => {
    for (const protection of ['ward', 'light', 'world-light']) {
      const c = setup(), { p, tell } = humanWindup(c);
      const context = { night: true, isLit: protection === 'world-light' ? () => true : undefined };
      if (protection === 'ward') p.wardUntil = tell.until + 10000;
      if (protection === 'light') Object.assign(p, { flashlightOn: true, flashlightBattery: 100, facing: 'left' });
      expect(c.update(tell.until, [p], [], context).damage).toEqual([]); expect(mob(c).phase).toBe('returning');
    }
    for (const change of [{ flashlightOn: false, facing: 'left' as const }, { flashlightOn: true, facing: 'right' as const }, { flashlightOn: true, flashlightBattery: 0, facing: 'left' as const }]) {
      const c = setup(), p = Object.assign(human('observer', { x: 53, y: 50 }), { flashlightBattery: 100 }, change), n = npc();
      c.update(epoch, [p], [n], { night: true }); c.update(epoch + 1000, [p], [n], { night: true });
      expect(c.update(epoch + 1900, [p], [n], { night: true }).damage[0]?.targetId).toBe(n.id);
    }
  });

  it.each(['dead', 'missing', 'new-life'] as const)('keeps visible positions after an NPC is %s, retargets with a fresh tell and returns within six seconds', casualty => {
    const c = setup(), p = human('nearby', { x: 51, y: 50 }), n = npc();
    c.update(epoch, [p], [n]); c.update(epoch + 1000, [p], [n]); const before = mob(c);
    if (casualty === 'dead') { n.health = 0; n.phase = 'respawning'; }
    if (casualty === 'new-life') n.lifeRevision = 1;
    const npcs = casualty === 'missing' ? [] : [n], start = epoch + 1100;
    expect(c.update(start, [p], npcs).damage).toEqual([]);
    expect(mob(c)).toMatchObject({ x: before.x, y: before.y, phase: 'recovering' });
    expect(mob(c).windup).toBeUndefined(); expect(c.diagnostics().postCasualtyPursuits).toBe(1);
    c.update(start + 899, [p], npcs); expect(mob(c).windup).toBeUndefined();
    c.update(start + 900, [p], npcs); const tell = mob(c).windup!;
    expect(tell).toMatchObject({ x: p.x, y: p.y, until: start + 1800 });
    const first = c.update(tell.until, [p], npcs).damage;
    expect(first).toHaveLength(1); expect(first[0]).toMatchObject({ targetKind: 'human', targetId: p.id });
    expect(c.update(start + 6000, [p], npcs).damage).toEqual([]);
    expect(mob(c).phase).toBe('returning'); expect(c.snapshot().mobs).toHaveLength(1); expect(c.diagnostics().postCasualtyPursuits).toBe(0);
  });

  it('walks home visibly from a casualty pursuit and never resumes it after the deadline', () => {
    const c = setup(), p = human('nearby', { x: 54, y: 50 }), n = npc();
    c.update(epoch, [p], [n]); n.health = 0; const start = epoch + 100;
    let last = mob(c), furthest = 0;
    for (let now = start; now <= start + 6000; now += 100) {
      c.update(now, [p], [n]); const current = mob(c);
      expect(distance(last, current)).toBeLessThanOrEqual(R.chaseSpeed * .1 + 1e-8); furthest = Math.max(furthest, distance(current, def.home)); last = current;
    }
    expect(furthest).toBeGreaterThan(1); expect(mob(c).phase).toBe('returning');
    const turning = mob(c);
    for (let now = start + 6100; now <= start + 9000; now += 100) { expect(c.update(now, [p], [n]).damage).toEqual([]); expect(c.snapshot().mobs).toHaveLength(1); }
    expect(distance(mob(c), def.home)).toBeLessThan(distance(turning, def.home));
  });

  it.each([{ watching: true }, { haloUntil: epoch + 10000 }, { wardUntil: epoch + 10000 }, { zone: 'interior:lantern-cave' }, { connected: false }])('never retargets a protected nearby human after a casualty %j', protection => {
    const c = setup(), p = human('nearby', { x: 51, y: 50 }), n = npc(); c.update(epoch, [p], [n]);
    n.health = 0; Object.assign(p, protection); c.update(epoch + 100, [p], [n]);
    expect(mob(c).phase).toBe('returning'); expect(c.diagnostics().postCasualtyPursuits).toBe(0);
    expect(c.update(epoch + 2000, [p], [n]).damage).toEqual([]); expect(c.snapshot().mobs).toHaveLength(1);
  });

  it('shares the authoritative knife cooldown, rejects invalid strikes and fences mob respawn lives', () => {
    const c = setup(), p = human(), spend = gate();
    for (const change of [{ armed: false }, { watching: true }, { zone: 'interior:lantern-cave' }, { x: 24, y: 24 }, { lifeRevision: NaN }]) expect(c.strike({ ...p, ...change }, def.id, 0, epoch, spend).ok).toBe(false);
    for (const damage of [NaN, Infinity, 0, -1]) expect(c.strike(p, def.id, 0, epoch, spend, damage).ok).toBe(false);
    expect(c.strike(p, def.id, 1, epoch, spend).ok).toBe(false); expect(spend).not.toHaveBeenCalled();
    expect(c.strike(p, def.id, 0, epoch, spend).ok).toBe(true); expect(mob(c).health).toBe(30);
    expect(c.strike(p, def.id, 0, epoch, spend).ok).toBe(false); expect(mob(c).health).toBe(30);
    expect(c.strike(p, def.id, 0, epoch + 800, spend).ok).toBe(true); expect(mob(c).phase).toBe('defeated');
    expect(c.strike(p, def.id, 0, epoch + 1600, spend).ok).toBe(false);
    c.update(epoch + 800 + R.respawnMs - 1, [p], []); expect(mob(c).health).toBe(0);
    const respawn = epoch + 800 + R.respawnMs; c.update(respawn, [p], []);
    expect(mob(c)).toMatchObject({ health: 60, lifeRevision: 1 }); expect(mob(c).windup).toBeUndefined();
    expect(c.strike(p, def.id, 0, respawn, spend).ok).toBe(false);
    c.update(respawn + 999, [p], []); expect(mob(c).windup).toBeUndefined();
    const state = c.snapshot(); c.update(epoch + 801, [p], []); expect(c.snapshot()).toEqual(state);
  });

  it('killing a goblin during its committed tell cancels the impact and cannot be replayed', () => {
    const c = setup(), { p, tell } = humanWindup(c), spend = gate();
    expect(c.strike(p, def.id, 0, tell.until - 1, spend, 60).ok).toBe(true);
    expect(mob(c)).toMatchObject({ phase: 'defeated', health: 0 }); expect(mob(c).windup).toBeUndefined();
    expect(c.update(tell.until, [p], [])).toEqual({ damage: [], snares: [] });
    expect(c.strike(p, def.id, 0, tell.until + 800, spend, 60).ok).toBe(false); expect(spend).toHaveBeenCalledTimes(1);
  });

  it('spends at most one navigation query per 100ms across two hostiles and eight spread humans', () => {
    const c = new GoblinPatrol(base), humans = [human('cave', { x: 65, y: 84 }), human('pond', { x: 101, y: 72 }), ...Array.from({ length: 6 }, (_, i) => human(`spread-${i}`, { x: 16 + i * 12, y: 99 }))];
    const npcs = Array.from({ length: 36 }, (_, i) => npc(`npc:spread-${i}`, { x: 20 + i * 2, y: 100 }));
    let lastQuery = -Infinity, queries = 0;
    for (let now = epoch; now <= epoch + 8000; now += 10) {
      // Both nearby players keep exploring; neither room interest nor a stationary windup removes the navigation load.
      humans[0]!.y = 84 + Math.floor((now - epoch) / 1000) % 2 * 2;
      humans[1]!.x = 101 + Math.floor((now - epoch) / 1000) % 2 * 2;
      c.update(now, humans, npcs, { pathSearchBudget: 1 });
      expect(c.diagnostics().pathPoints).toBeLessThanOrEqual(2 * R.maxPathPoints);
      if (c.diagnostics().lastPathQueries) { expect(now - lastQuery).toBeGreaterThanOrEqual(100); lastQuery = now; queries++; }
    }
    expect(queries).toBeGreaterThan(2);
    for (const budget of [0, -1, NaN, Infinity]) { c.update(epoch + 9000, humans, npcs, { pathSearchBudget: budget }); expect(c.diagnostics().lastPathQueries).toBe(0); }
  });
});

describe('Morrow night pulse', () => {
  const spirit = () => Object.assign(npc('npc:spirit-morrow', { x: 101, y: 70 }), { art: 'spirit' as const });
  const player = () => human('traveler', { x: 102, y: 70 });
  const pulseController = () => setup([]);
  function windup() { const c = pulseController(), p = player(), n = spirit(); c.update(epoch, [p], [n], { night: true }); return { c, p, n, tell: c.snapshot().pulses[0]! }; }

  it('uses a visible fixed 1.2-second night tell, emits a five-second life/zone-fenced snare once and cools down for 20 seconds', () => {
    const c = pulseController(), p = player(), n = spirit();
    c.update(epoch, [p], [n], { night: false }); expect(c.snapshot().pulses).toEqual([]);
    c.update(epoch, [p], [n], { night: true }); const tell = c.snapshot().pulses[0]!;
    expect(tell).toMatchObject({ x: p.x, y: p.y, radius: 1.2, until: epoch + 1200 });
    c.snapshot().pulses[0]!.x = 999; expect(c.snapshot().pulses[0]!.x).toBe(p.x);
    expect(c.update(tell.until - 1, [p], [n], { night: true }).snares).toEqual([]);
    const result = c.update(tell.until, [p], [n], { night: true }); expect(result.damage).toEqual([]);
    expect(result.snares).toEqual([{ id: `${tell.id}:snare`, sourceNpcId: n.id, targetId: p.id, targetLifeRevision: 0, targetZoneRevision: 0, until: tell.until + 5000, occurredAt: tell.until }]);
    expect(c.update(tell.until, [p], [n], { night: true }).snares).toEqual([]);
    c.update(epoch + 19999, [p], [n], { night: true }); expect(c.snapshot().pulses).toEqual([]);
    c.update(epoch + 20000, [p], [n], { night: true }); expect(c.snapshot().pulses[0]!.id).not.toBe(tell.id);
  });

  it.each([{ zone: 'interior:lantern-cave' }, { zoneRevision: 1 }, { lifeRevision: 1 }, { health: 0 }, { watching: true }, { haloUntil: epoch + 9999 }, { seatId: 'seat' }, { connected: false }, { wardUntil: epoch + 9999 }, { flashlightOn: true, flashlightBattery: 100 }, { x: 24, y: 24 }, { lifeRevision: NaN }])('cancels a pulse when target safety/context changes %j', change => {
    const { c, p, n, tell } = windup(); expect(tell).toBeDefined(); Object.assign(p, change);
    expect(c.update(tell.until, [p], [n], { night: true }).snares).toEqual([]); expect(c.snapshot().pulses).toEqual([]);
  });

  it.each(['dodge', 'day', 'source-dead', 'source-new-life', 'source-away', 'source-missing', 'lit', 'late'] as const)('cancels the fixed pulse on %s and preserves its cooldown', reason => {
    const { c, p, n, tell } = windup(); const context: GoblinPatrolContext = { night: true };
    if (reason === 'dodge') p.y += 1.3;
    if (reason === 'day') context.night = false;
    if (reason === 'source-dead') n.health = 0;
    if (reason === 'source-new-life') n.lifeRevision = 1;
    if (reason === 'source-away') n.x -= 4;
    if (reason === 'lit') context.isLit = () => true;
    const now = tell.until + (reason === 'late' ? R.impactGraceMs + 1 : 0);
    expect(c.update(now, [p], reason === 'source-missing' ? [] : [n], context).snares).toEqual([]);
    expect(c.snapshot().pulses).toEqual([]);
    c.update(now + 1, [player()], [spirit()], { night: true }); expect(c.snapshot().pulses).toEqual([]);
  });

  it('requires source-to-target LOS, rechecks it at impact and lets a nearby ward protect a companion', () => {
    const wall = { x: 101.4, y: 69, width: .2, height: 2 }, local = { ...world, map: { ...world.map, solids: [wall] } };
    const c = new GoblinPatrol(local, { definitions: [] }), p = player(), n = spirit();
    c.update(epoch, [p], [n], { night: true }); expect(c.snapshot().pulses).toEqual([]);
    local.map.solids = []; c.update(epoch + 1, [p], [n], { night: true }); expect(c.snapshot().pulses).toHaveLength(1);
    local.map.solids = [wall]; expect(c.update(epoch + 1201, [p], [n], { night: true }).snares).toEqual([]);
    const warded = pulseController(), guard = human('guard', { x: 102, y: 72 }); guard.wardUntil = epoch + 9999;
    warded.update(epoch, [p, guard], [n], { night: true }); expect(warded.snapshot().pulses).toEqual([]);
  });
});
