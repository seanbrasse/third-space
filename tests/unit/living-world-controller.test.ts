import { describe, expect, it, vi } from 'vitest';
import { getWorld, type Point } from '@third-space/config';
import { createPlayer, distance, isHomeSegmentWalkable, isHomeWalkable } from '@third-space/simulation';
import { expandAuthoredForest } from '../../packages/config/src/authored-forest';
import { augmentLivingForest } from '../../packages/config/src/living-environment';
import type { ForestNPC } from '../../packages/contracts/src/forest-npc';
import { ForestNPCController } from '../../apps/game-server/src/ForestNPCController';
import { authoredForestNPCDefinitions } from '../../apps/game-server/src/authored-forest-npcs';
import { LivingWorldController, LIVING_WORLD_RULES, type LivingWorldDefinition, type LivingWorldHuman } from '../../apps/game-server/src/LivingWorldController';
import { LANTERN_ROAD, livingWorldNPCDefinitions } from '../../apps/game-server/src/living-world-npcs';
import type { SpendKnifeSwing } from '../../apps/game-server/src/ForestCombatEncounters';

const base = getWorld('forest');
const world = { ...base, map: { ...base.map, width: 144, height: 112, solids: [], furniture: [] } };
const road: LivingWorldDefinition = { incidentId: 'test-lantern-road', npcId: 'npc:mara', origin: { x: 50, y: 50 }, destination: { x: 70, y: 50 }, route: [{ x: 70, y: 50 }], bandits: [{ x: 53, y: 50 }, { x: 53, y: 52 }] };
function human(id = 'human', at: Point = { x: 49, y: 50 }): LivingWorldHuman { return { ...createPlayer(id, id), ...at, armed: true, health: 100, lifeRevision: 0 }; }
function npc(at: Point = road.origin): ForestNPC { return { ...createPlayer(road.npcId, 'Mara'), ...at, name: 'Mara', art: 'villager', role: 'Fruit picker', activity: 'fruit-picking', phase: 'wander', moving: false, health: 100, maxHealth: 100, lifeRevision: 0 }; }
function setup(definition = road) { return new LivingWorldController(world, { definition, sessionId: 'test-session', random: () => 0 }); }
const swing = () => vi.fn<SpendKnifeSwing>(() => ({ ok: true, deaths: [] }));
function activate(c: LivingWorldController, p = human(), n = npc(), now = 100) { c.update(now, [p], [n]); expect(c.protect(p, now, n)).toEqual({ ok: true }); return { p, n }; }
function finishBandits(c: LivingWorldController, p: LivingWorldHuman, at = 1000) {
  const spend = swing();
  for (const mob of c.snapshot().mobs) {
    Object.assign(p, { x: mob.x - .8, y: mob.y });
    expect(c.strike(p, mob.id, mob.lifeRevision, at, spend, 500)).toEqual({ ok: true }); at += 800;
  }
  return at;
}

describe('living Lantern Road runtime', () => {
  it('authors seven reachable bounded routines with working civilians and distinct spirits/wildlife', () => {
    const expanded = { ...base, map: augmentLivingForest(expandAuthoredForest(base.map)) }, defs = livingWorldNPCDefinitions();
    expect(defs).toHaveLength(7); expect(new Set(defs.map(d => d.id)).size).toBe(7);
    const c = new ForestNPCController(expanded, () => 0, defs);
    expect(c.snapshot()).toHaveLength(7);
    expect(c.get(LANTERN_ROAD.npcId)).toMatchObject(LANTERN_ROAD.origin);
    expect(defs.slice(0, 3).map(d => d.activity)).toEqual(['fruit-picking', 'washing', 'woodwork']);
    expect(defs.slice(3).map(d => d.art)).toEqual(['spirit', 'spirit', 'frog', 'duck']);
    for (const d of defs) for (const point of [d.home!, ...(d.patrol ?? []), ...(d.nightPatrol ?? [])]) expect(isHomeWalkable(point, expanded.map)).toBe(true);
    const living = new LivingWorldController(expanded);
    expect(living.snapshot().mobs).toHaveLength(2);
    expect(living.snapshot().mobs.every(m => m.id.startsWith('mob:') && isHomeWalkable(m, expanded.map))).toBe(true);
  });

  it('stays dormant around eight camp viewers, indoors, halo-protected or distant humans', () => {
    for (const p of [human('camp', { x: 24, y: 24 }), { ...human(), zone: 'interior:inn' }, { ...human(), haloUntil: 999999 }, { ...human(), watching: true }, human('far', { x: 100, y: 80 })]) {
      const c = setup(); for (let now = 0; now < 60000; now += 1000) c.update(now, Array.from({ length: 8 }, (_, i) => ({ ...p, id: `human-${i}` })), [npc()]);
      expect(c.snapshot().rescue.phase).toBe('dormant'); expect(c.pendingEvents()).toEqual([]);
      expect(c.snapshot().mobs.every(m => m.phase === 'idle' && !m.moving)).toBe(true);
    }
  });

  it('starts a rare nearby help incident with a moving, nonblocking civilian intent and a single receipt', () => {
    const c = setup(), p = human(), n = npc();
    c.update(0, [p], [n]); expect(c.snapshot().rescue.phase).toBe('dormant');
    const first = c.update(LIVING_WORLD_RULES.activationWarmupMs, [p], [n]);
    expect(c.snapshot().rescue).toMatchObject({ phase: 'endangered', helpTargetId: p.id });
    expect(first.steering[0]).toMatchObject({ npcId: n.id, activity: 'fleeing', bubble: { text: expect.stringContaining('Bandits') } });
    expect(first.events.map(e => e.event)).toEqual(['discovered']);
    expect(c.update(LIVING_WORLD_RULES.activationWarmupMs, [p], [n]).events).toEqual(first.events);
    expect(c.acknowledgeEvent(first.events[0]!.eventId)).toBe(true); expect(c.acknowledgeEvent(first.events[0]!.eventId)).toBe(false);
  });

  it('does not accept another nearby resident as the rescue target', () => {
    const c = setup(), p = human(), other = { ...npc(), id: 'npc:someone-else' };
    c.update(0, [p], [other]); expect(c.protect(p, 100, other).ok).toBe(false);
    expect(c.snapshot().rescue.phase).toBe('dormant'); expect(c.pendingEvents()).toEqual([]);
  });

  it('continues authoritative pursuit when all humans leave and lets ignored civilians be attacked and killed', () => {
    const c = setup(), { n } = activate(c); let count = 0, failed = false;
    for (let now = 200; now <= 45000; now += 100) {
      const result = c.update(now, [], [n]);
      for (const hit of result.damage) { expect(hit.targetId).toBe(n.id); n.health = Math.max(0, n.health - hit.amount); count++; if (!n.health) n.phase = 'respawning'; }
      if (c.snapshot().rescue.phase === 'cooldown') { failed = true; break; }
    }
    expect(count).toBeGreaterThanOrEqual(10); expect(n.health).toBe(0); expect(failed).toBe(true);
    expect(c.pendingEvents().filter(e => e.event === 'setback')).toHaveLength(1);
    expect(c.snapshot().mobs).toEqual([]);
  });

  it('declining dismisses personal help while nearby bandits can still turn on an exposed player', () => {
    const def = { ...road, bandits: [{ x: 50.9, y: 50 }, { x: 53, y: 52 }] };
    const c = setup(def), p = human('near', { x: 50.7, y: 50 }), n = npc({ x: 49, y: 50 });
    activate(c, p, n); expect(c.decline(p, 100, n)).toEqual({ ok: true });
    c.update(2100, [p], [n]); const target = c.snapshot().mobs[0]!;
    expect(target.windup).toMatchObject({ x: p.x, y: p.y });
    const hits = c.update(target.windup!.until, [p], [n]).damage;
    expect(hits.some(h => h.targetId === p.id && h.targetKind === 'human')).toBe(true);
    expect(c.snapshot().rescue.helpTargetId).toBeUndefined();
    expect(c.update(target.windup!.until, [p], [n]).damage).toEqual([]);
  });

  it('retains the incident witness after declining so death emits a setback without participation credit', () => {
    const c = setup(), p = human('declining-witness'), n = npc();
    c.update(0, [p], [n]); c.update(12000, [p], [n]);
    expect(c.snapshot().rescue).toMatchObject({ phase: 'endangered', helperIds: [], helpTargetId: p.id });
    expect(c.decline(p, 12000, n).ok).toBe(true); expect(c.snapshot().rescue.helpTargetId).toBeUndefined();
    n.health = 0; n.phase = 'respawning'; c.update(12100, [p], [n]);
    const setback = c.pendingEvents().filter(event => event.event === 'setback');
    expect(setback).toHaveLength(1); expect(setback[0]).toMatchObject({ actorId: p.id, participantIds: [] });
    expect(c.snapshot().rescue).toMatchObject({ phase: 'cooldown', helperIds: [] });
    c.update(12200, [p], [n]); expect(c.pendingEvents().filter(event => event.event === 'setback')).toEqual(setback);
  });

  it('retains the original witness after they walk away so ignored death emits a setback without credit', () => {
    const c = setup(), p = human('departing-witness'), n = npc();
    c.update(0, [p], [n]); c.update(12000, [p], [n]);
    Object.assign(p, { x: 100, y: 80 }); c.update(12100, [p], [n]);
    expect(c.snapshot().rescue).toMatchObject({ phase: 'endangered', helperIds: [] }); expect(c.snapshot().rescue.helpTargetId).toBeUndefined();
    n.health = 0; n.phase = 'respawning'; c.update(12200, [p], [n]);
    const setback = c.pendingEvents().filter(event => event.event === 'setback');
    expect(setback).toHaveLength(1); expect(setback[0]).toMatchObject({ actorId: 'departing-witness', participantIds: [] });
    expect(c.snapshot().rescue).toMatchObject({ phase: 'cooldown', helperIds: [] });
  });

  it.each([{ zone: 'interior:inn' }, { haloUntil: 9999 }, { respawnAt: 9999 }, { connected: false }, { watching: true }, { seatId: 'bench' }, { x: 24, y: 24 }])('rechecks safe eligibility at windup impact %j', protection => {
    const c = setup({ ...road, bandits: [{ x: 50.9, y: 50 }, { x: 53, y: 52 }] });
    const p = human('near', { x: 50.7, y: 50 }), n = npc({ x: 49, y: 50 }); activate(c, p, n);
    c.update(2100, [p], [n]); const warning = c.snapshot().mobs[0]!.windup!;
    expect(warning).toBeDefined(); Object.assign(p, protection);
    expect(c.update(warning.until, [p], [n]).damage.filter(h => h.targetId === p.id)).toEqual([]);
  });

  it('commits a fixed impact point, lets a player dodge and emits unique damage only once', () => {
    const c = setup({ ...road, bandits: [{ x: 50.9, y: 50 }, { x: 53, y: 52 }] });
    const p = human('near', { x: 50.7, y: 50 }), n = npc({ x: 49, y: 50 }); activate(c, p, n);
    c.update(2100, [p], [n]); const warning = c.snapshot().mobs[0]!.windup!;
    p.y += 2; expect(c.update(warning.until, [p], [n]).damage.filter(h => h.targetId === p.id)).toEqual([]);
    expect(warning.y).toBe(50);
  });

  it('obeys directional live flashlight and lamp protection at night, including mid-windup', () => {
    const c = setup({ ...road, bandits: [{ x: 50.9, y: 50 }, { x: 53, y: 52 }] });
    const p = human('near', { x: 50.7, y: 50 }), n = npc({ x: 49, y: 50 }); activate(c, p, n);
    c.update(2100, [p], [n], { night: true }); expect(c.snapshot().mobs[0]!.windup).toBeDefined();
    Object.assign(p, { flashlightOn: true, flashlightBattery: 1, facing: 'right' });
    expect(c.update(3000, [p], [n], { night: true }).damage).toEqual([]); expect(c.snapshot().mobs[0]!.windup).toBeUndefined();
    p.flashlightBattery = 0; c.update(3300, [p], [n], { night: true }); expect(c.snapshot().mobs[0]!.windup).toBeDefined();
    expect(c.update(4200, [p], [n], { night: true, isLit: () => true }).damage).toEqual([]);
  });

  it('fences strike range, actor eligibility, finite damage, common cooldown and stale bandit lives before spending', () => {
    const c = setup(), { p } = activate(c), spend = swing(), target = c.snapshot().mobs[0]!;
    expect(c.strike(p, target.id, 0, 1000, spend).ok).toBe(false);
    Object.assign(p, { x: target.x - .8, y: target.y });
    for (const change of [{ armed: false }, { haloUntil: 10000 }, { zone: 'inn' }, { id: 'npc:forged' }, { watching: true }]) expect(c.strike({ ...p, ...change }, target.id, 0, 1000, spend).ok).toBe(false);
    expect(c.strike(p, target.id, 2, 1000, spend).ok).toBe(false); expect(c.strike(p, target.id, 0, 1000, spend, NaN).ok).toBe(false); expect(spend).not.toHaveBeenCalled();
    expect(c.strike(p, target.id, 0, 1000, spend, 15).ok).toBe(true); expect(c.snapshot().mobs[0]!.health).toBe(45);
    expect(c.strike(p, target.id, 0, 1001, spend).ok).toBe(false); expect(spend).toHaveBeenCalledTimes(1);
  });

  it('records protection only after threats clear, then waits for an actual companion and destination arrival', () => {
    const c = setup(), { p, n } = activate(c); expect(c.pendingEvents().map(e => e.event)).toEqual(['discovered']);
    finishBandits(c, p); c.update(3000, [p], [n]);
    expect(c.snapshot().rescue.phase).toBe('escorting'); expect(c.pendingEvents().filter(e => e.event === 'protected')).toHaveLength(1);
    const paused = c.update(3100, [], [n]); expect(paused.steering[0]).toMatchObject({ goal: road.origin, speed: 0 });
    Object.assign(p, { x: n.x, y: n.y }); expect(c.escort(p, 3100, n).ok).toBe(true);
    expect(c.update(3200, [p], [n]).steering[0]!.goal).toEqual(road.destination);
    Object.assign(n, road.destination); expect(c.update(3300, [], [n]).events.some(e => e.event === 'escort-arrived')).toBe(false);
    Object.assign(p, road.destination); c.update(3400, [p], [n]);
    expect(c.snapshot().rescue.phase).toBe('recovering'); expect(c.pendingEvents().filter(e => e.event === 'escort-arrived')).toHaveLength(1);
    c.update(3500, [p], [n]); expect(c.pendingEvents()).toHaveLength(3);
    c.syncStory('complete'); expect(c.snapshot().rescue.phase).toBe('complete');
  });

  it('recovers failure on a bounded retry, preserving unique receipts and rejecting old enemy revisions', () => {
    const c = setup(), { p, n } = activate(c), old = c.snapshot().mobs[0]!;
    n.health = 0; n.phase = 'respawning'; c.update(1000, [p], [n]); const receipt = c.pendingEvents().find(e => e.event === 'setback')!;
    expect(c.snapshot().rescue).toMatchObject({ phase: 'cooldown', retryAt: 46000 });
    c.update(46000, [p], [n]); expect(c.snapshot().rescue.phase).toBe('cooldown');
    n.health = 100; n.phase = 'wander'; c.update(46100, [p], [n]);
    expect(c.snapshot().rescue.phase).toBe('dormant'); expect(c.snapshot().mobs[0]!.lifeRevision).toBe(old.lifeRevision + 1);
    expect(c.pendingEvents()).toContainEqual(receipt);
    Object.assign(p, { x: old.x - .8, y: old.y }); const spend = swing();
    expect(c.strike(p, old.id, old.lifeRevision, 47000, spend).ok).toBe(false); expect(spend).not.toHaveBeenCalled();
    Object.assign(p, road.origin); expect(c.protect(p, 47000, n).ok).toBe(true);
    expect(c.snapshot().rescue.attemptId).not.toBe(receipt.attemptId);
    c.update(48000, [p], [n]); expect(c.pendingEvents().filter(e => e.event === 'setback')).toHaveLength(1);
  });

  it('remembers only recent witnessed harm with range and LOS, then forgets without permanent labels', () => {
    const c = setup(), p = human('violent', { x: 50, y: 50 }), n = npc(), witness = { ...npc({ x: 54, y: 50 }), id: 'npc:witness', name: 'Elsie' };
    const far = { ...witness, id: 'npc:far', x: 100 }; c.update(0, [], [n, witness, far]);
    expect(c.update(100, [p], [n, witness, far]).steering).toEqual([]);
    c.observeViolence(p, n.id, 100, [n, witness, far]);
    const frightened = c.update(200, [p], [n, witness, far]).steering;
    expect(frightened.map(s => s.npcId)).toContain(witness.id); expect(frightened.map(s => s.npcId)).not.toContain(far.id);
    expect(frightened.find(s => s.npcId === witness.id)!.bubble!.text).toBe('I saw you strike Mara. Please stay back.');
    c.update(LIVING_WORLD_RULES.memoryMs + 200, [], [n, witness, far]); expect(c.diagnostics().witnessMemories).toBe(0);
  });

  it('bounds global route work and motion with eight humans spread across the map and 36 NPCs', () => {
    const c = setup(), { p, n } = activate(c), humans = [p, ...Array.from({ length: 7 }, (_, i) => human(`spread-${i}`, { x: 70 + i * 8, y: 20 + i * 10 }))];
    const npcs = [n, ...Array.from({ length: 35 }, (_, i) => ({ ...npc({ x: 48 + i % 6, y: 48 + Math.floor(i / 6) }), id: `npc:worker:${i}` }))];
    let before = c.snapshot().mobs;
    for (let now = 200; now <= 10000; now += 100) {
      c.update(now, humans, npcs, { pathSearchBudget: now % 200 ? 0 : 1 });
      const after = c.snapshot().mobs; for (const [i, m] of after.entries()) { expect(distance(m, before[i]!)).toBeLessThanOrEqual(.190001); expect(isHomeSegmentWalkable(before[i]!, m, world.map)).toBe(true); }
      expect(c.diagnostics().lastPathQueries).toBeLessThanOrEqual(now % 200 ? 0 : 1); expect(c.diagnostics().lastSteeringCount).toBeLessThanOrEqual(36); before = after;
    }
    c.update(9999, humans, npcs); expect(c.snapshot().mobs).toEqual(before);
    c.update(15000, humans, npcs); c.snapshot().mobs.forEach((m, i) => expect(distance(m, before[i]!)).toBeLessThanOrEqual(.190001));
  });

  it('does not route or strike through obstacles, and does not accept an incomplete authored encounter', () => {
    const blocked = { ...world, map: { ...world.map, solids: [{ x: 51.8, y: 45, width: .2, height: 10 }] } };
    const c = new LivingWorldController(blocked, { definition: road }), p = human('blocked', { x: 51.7, y: 50 }), spend = swing(); c.update(0, [p], [npc()]);
    expect(c.strike(p, c.snapshot().mobs[0]!.id, 0, 1000, spend).ok).toBe(false); expect(spend).not.toHaveBeenCalled();
    const invalid = setup({ ...road, bandits: [road.bandits[0]!] }); expect(invalid.snapshot().mobs).toEqual([]);
    invalid.update(0, [human()], [npc()]); invalid.update(12000, [human()], [npc()]); expect(invalid.snapshot().rescue.phase).toBe('dormant');
  });

  it('keeps defensive snapshots and receipts, and restoration never replays an already complete rescue', () => {
    const c = setup(), { p, n } = activate(c), snapshot = c.snapshot(), receipts = c.pendingEvents();
    snapshot.mobs[0]!.health = 999; snapshot.rescue.helperIds.push('forged'); receipts[0]!.participantIds.push('forged');
    expect(c.snapshot().mobs[0]!.health).toBe(60); expect(c.snapshot().rescue.helperIds).not.toContain('forged'); expect(c.pendingEvents()[0]!.participantIds).not.toContain('forged');
    const restored = setup(); restored.syncStory('complete'); for (let now = 0; now < 100000; now += 1000) restored.update(now, [p], [n]);
    expect(restored.pendingEvents()).toEqual([]); expect(restored.snapshot().mobs).toEqual([]); expect(restored.snapshot().rescue.phase).toBe('complete');
  });

  it('holds recovered Mara in the village and only reacts to personally evidenced fear nearby', () => {
    const c = setup(), p = { ...human(), afraidNpcIds: ['npc:mara', 'washer-elsie'] }, n = npc(road.destination);
    const elsie = { ...npc({ x: 51, y: 50 }), id: 'npc:washer-elsie' }, stranger = { ...npc({ x: 51, y: 52 }), id: 'npc:stranger' };
    c.syncStory('complete'); const result = c.update(100, [p], [n, elsie, stranger]);
    expect(result.steering.find(s => s.npcId === n.id)).toMatchObject({ goal: road.destination, activity: 'fruit-picking' });
    expect(result.steering.find(s => s.npcId === elsie.id)).toMatchObject({ activity: 'fleeing' });
    expect(result.steering.find(s => s.npcId === stranger.id)).toBeUndefined();
    p.zone = 'interior:inn'; expect(c.update(200, [p], [n, elsie, stranger]).steering).toHaveLength(1);
  });

  it('rejects a committed hit if either NPC or human target changes life before impact', () => {
    for (const targetKind of ['npc', 'human']) {
      const c = setup({ ...road, bandits: [{ x: 50.9, y: 50 }, { x: 53, y: 52 }] });
      const n = npc({ x: targetKind === 'npc' ? 50.7 : 49, y: 50 });
      const p = human('near', { x: targetKind === 'human' ? 50.7 : 49, y: 50 }); activate(c, p, n);
      c.update(2100, [p], [n]); const warning = c.snapshot().mobs[0]!.windup!; expect(warning).toBeDefined();
      const target = targetKind === 'npc' ? n : p; target.lifeRevision = 1;
      expect(c.update(warning.until, [p], [n]).damage.filter(h => h.targetId === target.id)).toEqual([]);
    }
  });

  it('escorts using the real NPC controller under one shared search budget, then stays at shelter', () => {
    const npcs = new ForestNPCController(world, () => 0, [{ id: road.npcId, name: 'Mara', role: 'Fruit picker', home: road.origin, lines: ['Help!'], patrol: [road.origin], activity: 'fruit-picking' }]);
    const c = setup(), p = human(); activate(c, p, npcs.get(road.npcId)); finishBandits(c, p);
    let arrived = false;
    for (let now = 3000; now <= 30000; now += 100) {
      const n = npcs.get(road.npcId)!; Object.assign(p, { x: n.x, y: n.y + 1 });
      const result = c.update(now, [p], npcs.snapshot());
      for (const s of result.steering) npcs.steer(s.npcId, s.goal, now, { speed: s.speed, activity: s.activity, until: s.until, bubble: s.bubble?.text });
      npcs.update(now, { pathSearchBudget: 1 - c.diagnostics().lastPathQueries });
      expect(npcs.diagnostics().lastPathSearches + c.diagnostics().lastPathQueries).toBeLessThanOrEqual(1);
      if (c.snapshot().rescue.phase === 'recovering') arrived = true;
    }
    expect(arrived).toBe(true); expect(distance(npcs.get(road.npcId)!, road.destination)).toBeLessThan(.2);
    expect(c.pendingEvents().filter(e => e.event === 'escort-arrived')).toHaveLength(1);
  });

  it('restores an escort at a real epoch with nobody connected, then accepts a helper and reaches shelter', () => {
    const epoch = 1_800_000_000_000;
    const npcs = new ForestNPCController(world, () => 0, [{ id: road.npcId, name: 'Mara', role: 'Fruit picker', home: road.origin, lines: ['The road is clear. Will you walk with me?'], patrol: [road.origin] }]);
    const c = setup(); c.syncStory('escorting');
    const first = c.update(epoch, [], npcs.snapshot());
    expect(c.snapshot().rescue.phase).toBe('escorting'); expect(first.events).toEqual([]);
    expect(first.steering[0]).toMatchObject({ npcId: road.npcId, goal: road.origin, speed: 0 });
    c.update(epoch + 5000, [], npcs.snapshot()); expect(c.snapshot().rescue.phase).toBe('escorting');
    const p = human('returning-helper', road.origin); expect(c.escort(p, epoch + 5100, npcs.get(road.npcId)).ok).toBe(true);
    for (let now = epoch + 5200; now <= epoch + 35000; now += 100) {
      const n = npcs.get(road.npcId)!; Object.assign(p, { x: n.x, y: n.y });
      const update = c.update(now, [p], npcs.snapshot());
      for (const intent of update.steering) npcs.steer(intent.npcId, intent.goal, now, { ...intent, bubble: intent.bubble?.text });
      npcs.update(now, { pathSearchBudget: 1 - c.diagnostics().lastPathQueries });
    }
    expect(c.snapshot().rescue.phase).toBe('recovering'); expect(distance(npcs.get(road.npcId)!, road.destination)).toBeLessThan(.2);
    expect(c.pendingEvents().map(event => event.event)).toEqual(['escort-arrived']);
    expect(c.pendingEvents()[0]!.participantIds).toEqual([p.id]);
  });

  it('applies hits to a moving unprotected worker and bounds recovery after lethal damage', () => {
    const npcs = new ForestNPCController(world, () => 0, [{ id: road.npcId, name: 'Mara', role: 'Fruit picker', home: road.origin, lines: ['Help!'], patrol: [road.origin] }]);
    const c = setup(), p = human(); activate(c, p, npcs.get(road.npcId)); let hits = 0, failedAt = 0;
    for (let now = 200; now <= 120000; now += 100) {
      const result = c.update(now, [], npcs.snapshot());
      for (const hit of result.damage) { npcs.damage(hit.targetId, hit.amount, now); hits++; }
      for (const s of result.steering) npcs.steer(s.npcId, s.goal, now, { speed: s.speed, activity: s.activity, until: s.until, bubble: s.bubble?.text });
      npcs.update(now, { pathSearchBudget: 1 - c.diagnostics().lastPathQueries });
      if (c.snapshot().rescue.phase === 'cooldown') { failedAt = now; break; }
    }
    expect(hits).toBeGreaterThan(0);
    if (!failedAt) { npcs.damage(road.npcId, 500, 120100); c.update(120100, [], npcs.snapshot()); failedAt = 120100; }
    expect(npcs.get(road.npcId)!.phase).toBe('respawning');
    npcs.update(failedAt + 45000); c.update(failedAt + 45000, [], npcs.snapshot());
    expect(c.snapshot().rescue.phase).toBe('dormant'); expect(npcs.get(road.npcId)!.health).toBe(100);
  });

  it('walks the full augmented Lantern Road around the goblin tent with all authored NPCs sharing one search budget', () => {
    const expanded = { ...base, map: augmentLivingForest(expandAuthoredForest(base.map)) };
    const npcs = new ForestNPCController(expanded, () => 0, authoredForestNPCDefinitions());
    const c = new LivingWorldController(expanded, { sessionId: 'full-route', random: () => 0 }), p = human('escort', LANTERN_ROAD.origin);
    c.update(0, [p], npcs.snapshot()); expect(c.protect(p, 0, npcs.get(LANTERN_ROAD.npcId)).ok).toBe(true);
    finishBandits(c, p); let arrived = false;
    for (let now = 3000; now <= 120000; now += 100) {
      const n = npcs.get(LANTERN_ROAD.npcId)!; Object.assign(p, { x: n.x, y: n.y });
      const result = c.update(now, [p], npcs.snapshot());
      for (const s of result.steering) npcs.steer(s.npcId, s.goal, now, { speed: s.speed, activity: s.activity, until: s.until, bubble: s.bubble?.text });
      npcs.update(now, { pathSearchBudget: 1 - c.diagnostics().lastPathQueries });
      const after = npcs.get(LANTERN_ROAD.npcId)!;
      expect(isHomeSegmentWalkable(n, after, expanded.map)).toBe(true); expect(distance(n, after)).toBeLessThanOrEqual(.135001);
      expect(npcs.diagnostics().lastPathSearches + c.diagnostics().lastPathQueries).toBeLessThanOrEqual(1);
      if (c.snapshot().rescue.phase === 'recovering') { arrived = true; break; }
    }
    expect(arrived).toBe(true); expect(distance(npcs.get(LANTERN_ROAD.npcId)!, LANTERN_ROAD.destination)).toBeLessThanOrEqual(LIVING_WORLD_RULES.arrivalRange);
  });
});
