import { describe, expect, it, vi } from 'vitest';
import { getWorld } from '@third-space/config';
import { createPlayer, distance, isHomeSegmentWalkable } from '@third-space/simulation';
import { expandAuthoredForest } from '../../packages/config/src/authored-forest';
import { ForestCombatEncounters, FOREST_COMBAT_RULES, KEEPER_COMBAT_ENCOUNTERS, type ForestCombatant, type SpendKnifeSwing } from '../../apps/game-server/src/ForestCombatEncounters';
import { SURVIVAL } from '../../apps/game-server/src/survival-inventory';

const base = getWorld('forest'), world = { ...base, map: expandAuthoredForest(base.map) };
const firstId = 'keeper-copperbutton-raiders', finalId = 'keeper-rootbound-guardian';
const allIds = KEEPER_COMBAT_ENCOUNTERS.map(e => e.id);
function controller(enabled = [firstId]) { const c = new ForestCombatEncounters(world); c.syncStory(enabled, []); return c; }
function human(id = 'human-a', at = { x: 75.1, y: 94 }): ForestCombatant { return { ...createPlayer(id, id), ...at, health: 100, armed: true }; }
function gate() {
  const cooldowns = new Map<string, number>();
  const spend = vi.fn<SpendKnifeSwing>((actor, _target, now) => {
    if (now - (cooldowns.get(actor.id) ?? -Infinity) < SURVIVAL.attackCooldownMs) return { ok: false, reason: 'Knife is recovering' };
    cooldowns.set(actor.id, now); return { ok: true, deaths: [] };
  });
  return spend;
}
function mob(c: ForestCombatEncounters, index = 0) { return c.snapshot().mobs[index]!; }
function finish(c: ForestCombatEncounters, player: ForestCombatant, start = 1000, spend = gate()) {
  let now = start;
  for (const target of c.snapshot().mobs.filter(m => m.encounterId === firstId)) {
    Object.assign(player, { x: target.x - .9, y: target.y });
    while (c.snapshot().mobs.find(m => m.id === target.id)!.health > 0) {
      expect(c.strike(player, target.id, target.lifeRevision, now, [player], spend).ok).toBe(true); now += 800;
    }
  }
  return now;
}

describe('cooperative keeper encounters', () => {
  it('places exactly five hostile actors on valid expanded-map ground, independent of friendly NPC slots', () => {
    const c = controller(allIds);
    expect(c.diagnostics()).toMatchObject({ encounterCount: 3, mobCount: 5 });
    expect(c.snapshot().mobs).toHaveLength(5);
    for (const target of c.snapshot().mobs) { expect(target.id.startsWith('mob:')).toBe(true); expect(distance(target, world.fire!)).toBeGreaterThan(9.5); }
    expect(c.snapshot().mobs.some(m => /Pip|Tulla|Nib|Brindle/.test(m.name))).toBe(false);
  });
  it('keeps undiscovered and final-stage encounters locked until authoritative story activation', () => {
    const c = new ForestCombatEncounters(world);
    expect(c.snapshot()).toEqual({ mobs: [], encounters: [] });
    const player = human('human-a', { x: 123.1, y: 96 }), spend = gate();
    expect(c.strike(player, `mob:${finalId}:0`, 0, 1000, [player], spend).ok).toBe(false);
    c.syncStory([firstId], []); expect(c.snapshot().mobs.every(m => m.encounterId === firstId)).toBe(true);
    c.syncStory([finalId], []); expect(c.snapshot().mobs).toHaveLength(1);
    expect(c.strike(player, `mob:${finalId}:0`, 0, 2000, [player], spend).ok).toBe(true);
  });
  it('requires an equipped knife, a live outdoor human, range, line of sight and target life before spending a swing', () => {
    const c = controller(), target = mob(c), player = human(), spend = gate();
    for (const overrides of [{ armed: false }, { connected: false }, { mode: 'race' as const }, { zone: 'asylum' }, { seatId: 'bench' }, { haloUntil: 9000 }, { respawnAt: 9000 }, { health: 0 }, { x: 24, y: 24 }, { id: 'npc:forest:0' }, { id: 'mob:fake' }]) {
      expect(c.strike({ ...player, ...overrides }, target.id, 0, 1000, [player], spend).ok).toBe(false);
    }
    expect(c.strike(player, target.id, 1, 1000, [player], spend).ok).toBe(false);
    expect(c.strike(player, 'npc:goblin-pip', 0, 1000, [player], spend).ok).toBe(false);
    expect(spend).not.toHaveBeenCalled(); expect(mob(c).health).toBe(60);
    expect(c.strike(player, target.id, 0, 1000, [player], spend).ok).toBe(true); expect(mob(c).health).toBe(30);
    expect(c.strike(player, target.id, 0, 1100, [player], spend)).toEqual({ ok: false, reason: 'Knife is recovering' }); expect(mob(c).health).toBe(30);
  });
  it('does not attack or pursue anyone until a human opts in by striking', () => {
    const c = controller(), nearby = Array.from({ length: 8 }, (_, i) => human(`human-${i}`));
    for (let now = 100; now < 10000; now += 100) expect(c.update(now, nearby)).toEqual([]);
    expect(c.snapshot().mobs.every(m => m.phase === 'idle' && !m.moving && m.health === 60)).toBe(true);
  });
  it('scales health once for one to eight near armed humans and does not heal enemies when a friend joins', () => {
    for (const count of [1, 2, 8]) {
      const c = controller(), players = Array.from({ length: count }, (_, i) => human(`human-${i}`));
      const target = mob(c); c.strike(players[0]!, target.id, 0, 1000, players, gate());
      const expected = Math.ceil(60 * (1 + .35 * (count - 1)));
      expect(mob(c).maxHealth).toBe(expected); expect(mob(c).health).toBe(expected - 30);
      expect(c.snapshot().encounters[0]!.participantScale).toBe(count);
      const before = mob(c).health; c.update(1100, [...players, human('late')]); expect(mob(c).health).toBe(before);
    }
  });
  it('counts unique eligible peers only and excludes camp watchers, NPCs, inactive and distant players from scaling', () => {
    const c = controller(), p = human(), target = mob(c);
    c.strike(p, target.id, 0, 1000, [p, p, { ...p, id: 'inactive', armed: false }, { ...p, id: 'far', x: 24, y: 24 }, { ...p, id: 'npc:person' }], gate());
    expect(mob(c).maxHealth).toBe(60);
  });
  it('has a solo-completable band and publishes one stable shared defeat receipt without awarding client loot', () => {
    const c = controller(), p = human(); finish(c, p);
    const receipt = c.pendingDefeats()[0]!;
    expect(receipt).toMatchObject({ kind: 'encounter-defeated', actorId: p.id, encounterId: firstId, defeatId: 'clear-v1', participantIds: [p.id] });
    expect(c.pendingDefeats()).toHaveLength(1);
    const target = mob(c); expect(c.strike(p, target.id, 0, 20000, [p], gate()).ok).toBe(false);
    c.update(1_000_000, [p]); expect(c.pendingDefeats()).toEqual([receipt]);
    expect(c.acknowledgeDefeat('forged-receipt')).toBe(false);
    expect(c.acknowledgeDefeat(receipt.eventId)).toBe(true); expect(c.acknowledgeDefeat(receipt.eventId)).toBe(false);
    expect(c.snapshot().mobs).toEqual([]); expect(c.pendingDefeats()).toEqual([]);
  });
  it('resets an uncommitted defeat after contributor revocation without awarding loot or accepting an old target life', () => {
    const c = controller(), p = human('revoked'); finish(c, p);
    const receipt = c.pendingDefeats()[0]!;
    expect(c.discardDefeatAndReset('unknown')).toBe(false);
    expect(c.discardDefeatAndReset(receipt.eventId)).toBe(true);
    expect(c.pendingDefeats()).toEqual([]);
    expect(c.snapshot().mobs.every(m => m.health === 60 && m.lifeRevision === 1 && m.phase === 'idle')).toBe(true);
    expect(c.strike(p, mob(c).id, 0, 9000, [p], gate()).ok).toBe(false);
    finish(c, human('current-member'), 10000);
    expect(c.pendingDefeats()[0]).toMatchObject({ eventId: receipt.eventId, defeatId: receipt.defeatId, participantIds: ['current-member'] });
    c.acknowledgeDefeat(receipt.eventId);
    expect(c.discardDefeatAndReset(receipt.eventId)).toBe(false);
    expect(c.snapshot().mobs).toEqual([]);
  });
  it('restores durable clears without respawning or crediting them again after a process restart', () => {
    const first = controller(), p = human(); finish(first, p); const receipt = first.pendingDefeats()[0]!;
    const retry = controller(); finish(retry, p); expect(retry.pendingDefeats()[0]!.eventId).toBe(receipt.eventId);
    const restored = controller(); restored.syncStory(allIds, [firstId]);
    expect(restored.snapshot().mobs.some(m => m.encounterId === firstId)).toBe(false);
    expect(restored.pendingDefeats()).toEqual([]);
  });
  it('attributes cooperative clearing to contributors, not spectators or only the final hitter', () => {
    const c = controller(), a = human('a'), b = human('b'), spectator = human('spectator'), spend = gate();
    for (const target of c.snapshot().mobs) {
      Object.assign(a, { x: target.x - .9, y: target.y }); Object.assign(b, { x: target.x - .9, y: target.y });
      let now = target.id.endsWith(':0') ? 1000 : 10000, i = 0;
      while (c.snapshot().mobs.find(m => m.id === target.id)!.health > 0) { const p = i++ % 2 ? b : a; c.strike(p, target.id, 0, now, [a, b, spectator], spend); now += 800; }
    }
    expect(c.pendingDefeats()[0]!.participantIds).toEqual(['a', 'b']);
  });
  it('telegraphs a fixed impact point, lets a player dodge and cannot hit a non-contributor beside them', () => {
    const c = controller(), p = human(), spectator = human('spectator'), target = mob(c);
    c.strike(p, target.id, 0, 1000, [p], gate());
    c.update(1000, [p, spectator]); c.update(2500, [p, spectator]);
    const warning = mob(c).windup!; expect(warning).toBeDefined(); expect(warning.until - 2500).toBe(800);
    const oldX = p.x; p.x -= 2;
    const hits = c.update(warning.until, [p, spectator]); expect(hits).toEqual([]); expect(warning.x).toBe(oldX);
    expect(c.update(warning.until, [p, spectator])).toEqual([]);
  });
  it('emits one bounded hit at windup completion and excludes protected or disconnected contributors', () => {
    for (const protection of [{}, { connected: false }, { haloUntil: 10000 }, { zone: 'asylum' }, { respawnAt: 10000 }]) {
      const c = controller(), p = human(), target = mob(c); c.strike(p, target.id, 0, 1000, [p], gate()); c.update(1000, [p]); c.update(2500, [p]);
      Object.assign(p, protection); const hits = c.update(3300, [p]);
      expect(hits.length).toBe(Object.keys(protection).length ? 0 : 1);
      if (hits.length) expect(hits[0]).toMatchObject({ targetId: p.id, amount: 10 });
      expect(c.update(3300, [p])).toEqual([]);
    }
  });
  it('resets a withdrawn encounter on a deterministic timer and rejects a delayed hit from its previous life', () => {
    const c = controller(), p = human(), target = mob(c), spend = gate(); c.strike(p, target.id, 0, 1000, [p], spend);
    c.update(1000, []); c.update(6000, []);
    expect(c.snapshot().encounters[0]).toMatchObject({ phase: 'resetting', resetAt: 14000 });
    c.update(13999, []); expect(mob(c).health).toBe(30);
    c.update(14000, []); expect(mob(c)).toMatchObject({ phase: 'idle', health: 60, lifeRevision: 1 });
    expect(c.pendingDefeats()).toEqual([]);
    const count = spend.mock.calls.length;
    expect(c.strike(p, target.id, 0, 15000, [p], spend).ok).toBe(false); expect(spend.mock.calls.length).toBe(count);
    expect(c.strike(p, target.id, 1, 15000, [p], spend).ok).toBe(true);
  });
  it('bounds pathfinding, movement after a stall, and defensive snapshot/receipt copies', () => {
    const c = controller(allIds), p = human(), target = mob(c); c.strike(p, target.id, 0, 1000, [p], gate());
    p.x -= 4; c.update(1000, [p]); const before = c.snapshot(); c.update(100000, [p]);
    expect(c.diagnostics().lastPathQueries).toBeLessThanOrEqual(1);
    c.snapshot().mobs.forEach((m, i) => expect(distance(m, before.mobs[i]!)).toBeLessThanOrEqual(.120001));
    const after = c.snapshot(); c.update(90000, [p]); expect(c.snapshot()).toEqual(after);
    const exposed = c.snapshot(); exposed.mobs[0]!.health = 9999; exposed.encounters[0]!.title = 'Changed'; expect(mob(c).health).not.toBe(9999);
    const completed = controller(); finish(completed, human()); const r = completed.pendingDefeats(); r[0]!.participantIds.push('forged'); expect(completed.pendingDefeats()[0]!.participantIds).not.toContain('forged');
  });
  it('lets one equipped player defeat the guardian while surviving its full telegraphed attack loop', () => {
    const c = controller([finalId]), p = human('solo', { x: 123.1, y: 96 }), target = mob(c), spend = gate();
    let nextSwing = 1000, hitsTaken = 0;
    for (let now = 1000; now <= 10000 && !c.pendingDefeats().length; now += 100) {
      if (now >= nextSwing) { expect(c.strike(p, target.id, 0, now, [p], spend).ok).toBe(true); nextSwing += 800; }
      for (const hit of c.update(now, [p])) { p.health -= hit.amount; hitsTaken++; }
      expect(p.health).toBeGreaterThan(0);
    }
    expect(hitsTaken).toBeGreaterThanOrEqual(1);
    expect(c.pendingDefeats()[0]).toMatchObject({ encounterId: finalId, participantIds: ['solo'] });
  });
  it('does not spend a knife swing through a solid obstacle', () => {
    const definition = { id: 'wall-test', title: 'Wall fixture', members: [{ name: 'Test raider', kind: 'bramble-raider' as const, home: { x: 50, y: 50 } }] };
    const testWorld = { ...base, map: { ...base.map, solids: [{ x: 49.35, y: 49, width: .1, height: 2 }], furniture: [] } };
    const c = new ForestCombatEncounters(testWorld, [definition]); c.syncStory(['wall-test'], []);
    const p = human('human', { x: 48.7, y: 50 }), target = mob(c), spend = gate();
    expect(distance(p, target)).toBeLessThanOrEqual(SURVIVAL.attackRange); expect(isHomeSegmentWalkable(p, target, testWorld.map)).toBe(false);
    expect(c.strike(p, target.id, 0, 1000, [p], spend).ok).toBe(false); expect(spend).not.toHaveBeenCalled();
  });
});
