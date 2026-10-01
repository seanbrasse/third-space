import { describe, expect, it, vi } from 'vitest';
import { getWorld } from '@third-space/config';
import { createPlayer } from '@third-space/simulation';
import { KnifeFinisher, KNIFE_FINISHER_RULES, type KnifeFinisherActor, type SpendFinisherSwing } from '../../apps/game-server/src/KnifeFinisher';
import { SurvivalInventory, SURVIVAL } from '../../apps/game-server/src/survival-inventory';

const base = getWorld('forest'), world = { ...base, map: { ...base.map, solids: [], furniture: [] } };
const context = { pvpEnabled: true, worldRevision: 2 };
const actor = (id = 'attacker', over: Partial<KnifeFinisherActor> = {}): KnifeFinisherActor => ({ ...createPlayer(id, id), x: 50, y: 50, armed: true, health: 100, lifeRevision: 0, zoneRevision: 0, damageRevision: 0, weaponId: `knife:${id}`, ...over });
const target = (over: Partial<KnifeFinisherActor> = {}) => actor('target', { x: 51, health: 55, armed: false, ...over });
const controller = () => new KnifeFinisher(world, { sessionId: 'test' });
const spend = () => vi.fn<SpendFinisherSwing>(() => ({ ok: true, deaths: [] }));
function begun() { const c = controller(), a = actor(), b = target(), swing = spend(); expect(c.begin(a, b, 1000, swing, context).ok).toBe(true); return { c, a, b, swing }; }

describe('authoritative finishing lunge', () => {
  it('publishes a fixed tell, waits 650 ms, and returns exactly one bounded impact with both life fences', () => {
    const { c, a, b, swing } = begun();
    expect(c.snapshot()).toEqual([{ id: 'finisher:test:1', attackerId: a.id, targetId: b.id, point: { x: 51, y: 50 }, radius: .8, startedAt: 1000, until: 1650, attackerLifeRevision: 0, targetLifeRevision: 0, worldRevision: 2 }]);
    expect(swing).toHaveBeenCalledTimes(1); expect(c.isWindingUp(a.id)).toBe(true);
    expect(c.update(1649, [a, b], context)).toEqual([]);
    expect(c.update(1650, [a, b], context)).toEqual([{ id: 'finisher:test:1:impact', attackerId: a.id, targetId: b.id, attackerLifeRevision: 0, targetLifeRevision: 0, attackerZoneRevision: 0, targetZoneRevision: 0, worldRevision: 2, amount: 100, occurredAt: 1650 }]);
    expect(c.isWindingUp(a.id)).toBe(false); expect(c.update(1650, [a, b], context)).toEqual([]); expect(c.snapshot()).toEqual([]);
  });

  it.each([{ health: 56 }, { health: 100 }, { health: 0 }, { health: NaN }, { connected: false }, { zone: 'interior:inn' }, { mode: 'race' as const }, { seatId: 'bench' }, { watching: true }, { respawnAt: 2000 }, { haloUntil: 2000 }, { x: 24, y: 24 }, { x: 53 }, { lifeRevision: -1 }, { id: 'npc:mara' }, { id: 'mob:bandit' }])('rejects an ineligible target before spending %j', over => {
    const c = controller(), swing = spend(); expect(c.begin(actor(), target(over), 1000, swing, context).ok).toBe(false);
    expect(swing).not.toHaveBeenCalled(); expect(c.snapshot()).toEqual([]);
  });

  it.each([{ armed: false }, { health: 0 }, { connected: false }, { zone: 'interior:inn' }, { mode: 'race' as const }, { seatId: 'bench' }, { watching: true }, { respawnAt: 2000 }, { haloUntil: 2000 }, { x: 24, y: 24 }, { lifeRevision: 1.5 }, { id: 'npc:pretender' }])('rejects an ineligible attacker before spending %j', over => {
    const c = controller(), swing = spend(); expect(c.begin(actor('attacker', over), target(), 1000, swing, context).ok).toBe(false);
    expect(swing).not.toHaveBeenCalled();
  });

  it('requires PvP and a stable world, and rejects self-targets and blocked segments', () => {
    const swing = spend(), a = actor();
    for (const ctx of [{ ...context, pvpEnabled: false }, { ...context, transitioning: true }, ...[NaN, Infinity, -1, .5].map(worldRevision => ({ ...context, worldRevision }))]) expect(controller().begin(a, target(), 1000, swing, ctx).ok).toBe(false);
    expect(controller().begin(a, { ...a, health: 30 }, 1000, swing, context).ok).toBe(false);
    const c = new KnifeFinisher({ ...world, map: { ...world.map, solids: [{ x: 50.4, y: 49, width: .1, height: 2 }] } });
    expect(c.begin(a, target(), 1000, swing, context).ok).toBe(false); expect(swing).not.toHaveBeenCalled();
  });

  it('does not create a tell when the common swing is unavailable or duplicate a pending start', () => {
    const c = controller(), blocked = vi.fn<SpendFinisherSwing>(() => ({ ok: false, reason: 'Knife is recovering' }));
    expect(c.begin(actor(), target(), 1000, blocked, context)).toEqual({ ok: false, reason: 'Knife is recovering' }); expect(c.snapshot()).toEqual([]);
    const { c: ready, a, b, swing } = begun(); expect(ready.begin(a, b, 1001, swing, context).ok).toBe(false); expect(swing).toHaveBeenCalledTimes(1);
  });

  it.each([{ x: 50.36 }, { health: 99 }, { health: 100, damageRevision: 1 }, { health: 100, lastHurtAt: 1100 }, { armed: false }, { weaponId: 'replacement-knife' }, { lifeRevision: 1 }, { zoneRevision: 1 }, { seatId: 'bench' }, { watching: true }, { haloUntil: 3000 }, { zone: 'interior:inn' }, { connected: false }])('permanently interrupts when attacker changes %j', over => {
    const { c, a, b } = begun(); expect(c.update(1100, [{ ...a, ...over }, b], context)).toEqual([]); expect(c.snapshot()).toEqual([]);
    expect(c.update(1650, [a, b], context)).toEqual([]);
  });

  it.each([{ x: 51.81 }, { health: 56 }, { health: 0 }, { lifeRevision: 1 }, { zoneRevision: 1 }, { haloUntil: 3000 }, { respawnAt: 3000 }, { seatId: 'bench' }, { watching: true }, { zone: 'interior:inn' }, { connected: false }, { x: 24, y: 24 }])('lets target evade or gain protection before impact %j', over => {
    const { c, a, b } = begun(); expect(c.update(1100, [a, { ...b, ...over }], context)).toEqual([]); expect(c.snapshot()).toEqual([]);
    expect(c.update(1650, [a, b], context)).toEqual([]);
  });

  it('allows small attacker adjustments and target movement inside the committed area without tracking the target point', () => {
    const { c, a, b } = begun(); a.x += .3; b.y += .7;
    expect(c.update(1500, [a, b], context)).toEqual([]); expect(c.snapshot()[0]!.point).toEqual({ x: 51, y: 50 });
    expect(c.update(1650, [a, b], context)).toHaveLength(1);
  });

  it('rechecks line of sight at impact and cancels on missing actors or changed world/PvP context', () => {
    for (const ctx of [{ ...context, worldRevision: 3 }, { ...context, pvpEnabled: false }, { ...context, transitioning: true }, ...[NaN, Infinity, -1, .5].map(worldRevision => ({ ...context, worldRevision }))]) {
      const { c, a, b } = begun(); expect(c.update(1650, [a, b], ctx)).toEqual([]); expect(c.snapshot()).toEqual([]);
    }
    const { c, a } = begun(); expect(c.update(1650, [a], context)).toEqual([]);
    // Immutable maps normally change by world revision. This fixture isolates the independent LOS recheck.
    const w = { ...world, map: { ...world.map, solids: [] as { x: number; y: number; width: number; height: number }[] } }, wall = new KnifeFinisher(w);
    const attacker = actor(), victim = target(); expect(wall.begin(attacker, victim, 1000, spend(), context).ok).toBe(true);
    w.map.solids.push({ x: 50.4, y: 49, width: .1, height: 2 });
    expect(wall.update(1650, [attacker, victim], context)).toEqual([]);
  });

  it('expires a stalled impact before the shared normal attack cooldown ends', () => {
    const { c, a, b } = begun(); expect(KNIFE_FINISHER_RULES.windupMs + KNIFE_FINISHER_RULES.impactGraceMs).toBeLessThan(SURVIVAL.attackCooldownMs);
    expect(c.update(1751, [a, b], context)).toEqual([]); expect(c.snapshot()).toEqual([]);
    const onTime = begun(); expect(onTime.c.update(1750, [onTime.a, onTime.b], context)).toHaveLength(1);
  });

  it('uses the real survival cooldown to prevent ordinary strikes interleaving and applies a single death', () => {
    const a = actor(), b = target(), inventory = new SurvivalInventory({ random: () => 0, spawnPoints: [{ x: 50, y: 50 }, { x: 55, y: 50 }], trees: [], safe: () => false, walkable: () => true, lineOfSight: () => true });
    inventory.tick(0, [a, b]); const knife = inventory.snapshot().backpacks[0]!;
    expect(inventory.pickup(a, knife.id, 0).ok).toBe(true); expect(inventory.equip(a.id, 'knife').ok).toBe(true);
    expect(inventory.damageWorld(b, 45, 1).ok).toBe(true);
    const c = controller(), common: SpendFinisherSwing = (attacker, victim, now) => inventory.strikeWorldTarget(attacker, victim, now);
    expect(c.begin(a, { ...b, health: inventory.ensure(b.id).health }, 1000, common, context).ok).toBe(true);
    expect(inventory.attack(a, b, 1100).ok).toBe(false); expect(inventory.strikeWorldTarget(a, b, 1649).ok).toBe(false);
    const hits = c.update(1650, [a, b], context); expect(hits).toHaveLength(1);
    expect(inventory.damageWorld(b, hits[0]!.amount, 1650)).toEqual({ ok: true, deaths: [b.id] });
    expect(c.update(1650, [a, b], context)).toEqual([]); expect(inventory.snapshot().events.filter(e => e.kind === 'death')).toHaveLength(1);
    expect(inventory.strikeWorldTarget(a, { x: 51, y: 50 }, 1799).ok).toBe(false);
    expect(inventory.strikeWorldTarget(a, { x: 51, y: 50 }, 1800).ok).toBe(true);
  });

  it('never lands an old finisher after a normal swing following a server stall', () => {
    const a = actor(), b = target(), swingTimes = new Map<string, number>();
    const shared = vi.fn<SpendFinisherSwing>((attacker, _target, now) => {
      if (now - (swingTimes.get(attacker.id) ?? -Infinity) < SURVIVAL.attackCooldownMs) return { ok: false, reason: 'Knife is recovering' };
      swingTimes.set(attacker.id, now); return { ok: true, deaths: [] };
    });
    const c = controller(); expect(c.begin(a, b, 1000, shared, context).ok).toBe(true);
    expect(shared(a, b, 1800).ok).toBe(true); expect(c.update(1801, [a, b], context)).toEqual([]);
    expect(c.begin(a, b, 1802, shared, context).ok).toBe(false);
  });

  it('keeps cancellation on the existing cooldown, rejects backward clocks, and exposes defensive tells', () => {
    const { c, a, b } = begun(), tell = c.snapshot()[0]!; tell.point.x = 999; tell.until = 1;
    expect(c.snapshot()[0]!.point.x).toBe(51); expect(c.update(999, [a, b], context)).toEqual([]); expect(c.snapshot()).toHaveLength(1);
    expect(c.begin(a, b, NaN, spend(), context).ok).toBe(false); expect(c.cancel(a.id)).toBe(true); expect(c.cancel(a.id)).toBe(false);
    expect(c.update(1650, [a, b], context)).toEqual([]);
  });

  it('bounds eight simultaneous tells, avoids duplicate victims, and cancels all without damage', () => {
    const c = controller(), players = Array.from({ length: 8 }, (_, i) => actor(`p${i}`, { x: 50 + (i % 2) * .4, health: 30 }));
    for (const [i, a] of players.entries()) expect(c.begin(a, players[(i + 1) % players.length]!, 1000, spend(), context).ok).toBe(true);
    const ninth = actor('overflow', { health: 30 }), extraSwing = spend(); expect(c.begin(ninth, players[0]!, 1000, extraSwing, context).ok).toBe(false);
    expect(extraSwing).not.toHaveBeenCalled(); expect(c.diagnostics().pending).toBe(8);
    const damage = c.update(1650, players, context); expect(damage.length).toBeLessThanOrEqual(8); expect(new Set(damage.map(d => d.targetId)).size).toBe(damage.length); expect(c.diagnostics().pending).toBe(0);
    const other = begun(); other.c.cancelAll(); expect(other.c.snapshot()).toEqual([]); expect(other.c.update(1650, [other.a, other.b], context)).toEqual([]);
  });
});
