import { randomUUID } from 'node:crypto';
import type { Point, WorldDefinition } from '@third-space/config';
import { distance, isHomeSegmentWalkable, isHomeWalkable } from '@third-space/simulation';
import { npcSegmentOutsideFire } from './ForestNPCController';
import { SURVIVAL, type SurvivalActor, type SurvivalResult } from './survival-inventory';

export const KNIFE_FINISHER_RULES = Object.freeze({
  maxActors: 8, maxPending: 8, woundedHealth: 55, range: SURVIVAL.attackRange,
  windupMs: 650, impactGraceMs: 100, radius: .8, attackerMovement: .35, damage: 100,
});

export interface KnifeFinisherActor extends SurvivalActor {
  health: number;
  armed: boolean;
  lifeRevision: number;
  zoneRevision?: number;
  /** Incremented for every accepted injury; detects damage followed by healing between ticks. */
  damageRevision?: number;
  lastHurtAt?: number;
  /** The current authoritative knife identity, when available. */
  weaponId?: string;
}
export interface KnifeFinisherContext {
  pvpEnabled: boolean;
  worldRevision?: number;
  transitioning?: boolean;
}
export interface KnifeFinisherTell {
  id: string;
  attackerId: string;
  targetId: string;
  point: Point;
  radius: number;
  startedAt: number;
  until: number;
  attackerLifeRevision: number;
  targetLifeRevision: number;
  worldRevision: number;
}
export interface KnifeFinisherDamageIntent {
  id: string;
  attackerId: string;
  targetId: string;
  attackerLifeRevision: number;
  targetLifeRevision: number;
  attackerZoneRevision: number;
  targetZoneRevision: number;
  worldRevision: number;
  amount: number;
  occurredAt: number;
}
export type SpendFinisherSwing = (actor: SurvivalActor, target: Point, now: number) => SurvivalResult;
export type KnifeFinisherBeginResult = { ok: true; state: KnifeFinisherTell } | { ok: false; reason: string };
interface Pending {
  tell: KnifeFinisherTell;
  origin: Point;
  attackerHealth: number;
  attackerHurtAt: number;
  attackerDamageRevision: number;
  attackerZoneRevision: number;
  targetZoneRevision: number;
  weaponId?: string;
}
const cloneTell = (tell: KnifeFinisherTell): KnifeFinisherTell => ({ ...tell, point: { ...tell.point } });

/** Visible, interruptible PvP finishers. Uses the ordinary knife cooldown, never its own attack economy. */
export class KnifeFinisher {
  private pending = new Map<string, Pending>();
  private lastAt: number | null = null;
  private serial = 0;
  private readonly sessionId: string;

  constructor(private world: WorldDefinition, options: { sessionId?: string } = {}) {
    this.sessionId = options.sessionId ?? randomUUID();
  }
  private validTime(now: number) { return Number.isFinite(now) && (this.lastAt === null || now >= this.lastAt); }
  private active(actor: KnifeFinisherActor, now: number) {
    return !actor.id.startsWith('npc:') && !actor.id.startsWith('mob:') && actor.connected && actor.mode === 'home' &&
      !actor.zone && !actor.respawnAt && !actor.seatId && !actor.watching && (actor.haloUntil ?? 0) <= now &&
      Number.isFinite(actor.health) && actor.health > 0 && Number.isInteger(actor.lifeRevision) && actor.lifeRevision >= 0 &&
      Number.isFinite(actor.x) && Number.isFinite(actor.y) && isHomeWalkable(actor, this.world.map) && npcSegmentOutsideFire(actor, actor, this.world);
  }
  private clear(a: Point, b: Point) { return isHomeSegmentWalkable(a, b, this.world.map) && npcSegmentOutsideFire(a, b, this.world); }
  private permitted(context: KnifeFinisherContext) {
    const revision = context.worldRevision === undefined ? 0 : context.worldRevision;
    return context.pvpEnabled === true && !context.transitioning && Number.isInteger(revision) && revision >= 0;
  }
  snapshot(): KnifeFinisherTell[] { return [...this.pending.values()].map(p => cloneTell(p.tell)); }
  diagnostics() { return { pending: this.pending.size }; }
  isWindingUp(attackerId: string) { return this.pending.has(attackerId); }
  cancel(attackerId: string) { return this.pending.delete(attackerId); }
  cancelAll() { this.pending.clear(); }

  begin(attacker: KnifeFinisherActor, target: KnifeFinisherActor, now: number, spendSwing: SpendFinisherSwing, context: KnifeFinisherContext): KnifeFinisherBeginResult {
    if (!this.validTime(now) || !this.permitted(context) || attacker.id === target.id || !this.active(attacker, now) || !this.active(target, now))
      return { ok: false, reason: 'Finishers require two exposed players with PvP enabled' };
    if (!attacker.armed || target.health > KNIFE_FINISHER_RULES.woundedHealth)
      return { ok: false, reason: 'Equip your knife; the target must have 55 health or less' };
    if (distance(attacker, target) > KNIFE_FINISHER_RULES.range || !this.clear(attacker, target))
      return { ok: false, reason: 'Move within knife reach with a clear path' };
    // A stalled simulation must not retain a tell after ordinary knife swings become legal again.
    for (const [id, value] of this.pending) if (now > value.tell.until + KNIFE_FINISHER_RULES.impactGraceMs) this.pending.delete(id);
    if (this.pending.has(attacker.id)) return { ok: false, reason: 'Your finishing lunge is already winding up' };
    if (this.pending.size >= KNIFE_FINISHER_RULES.maxPending) return { ok: false, reason: 'Too many finishing lunges are already winding up' };
    const spent = spendSwing(attacker, target, now);
    if (!spent.ok) return { ok: false, reason: spent.reason };
    const tell: KnifeFinisherTell = {
      id: `finisher:${this.sessionId}:${++this.serial}`, attackerId: attacker.id, targetId: target.id,
      point: { x: target.x, y: target.y }, radius: KNIFE_FINISHER_RULES.radius, startedAt: now,
      until: now + KNIFE_FINISHER_RULES.windupMs, attackerLifeRevision: attacker.lifeRevision,
      targetLifeRevision: target.lifeRevision, worldRevision: context.worldRevision ?? 0,
    };
    this.pending.set(attacker.id, { tell, origin: { x: attacker.x, y: attacker.y }, attackerHealth: attacker.health,
      attackerHurtAt: attacker.lastHurtAt ?? 0, attackerDamageRevision: attacker.damageRevision ?? 0,
      attackerZoneRevision: attacker.zoneRevision ?? 0, targetZoneRevision: target.zoneRevision ?? 0, weaponId: attacker.weaponId });
    this.lastAt = now;
    return { ok: true, state: cloneTell(tell) };
  }

  /** Root applies each intent through its authoritative damage path, checking the supplied life/context revisions. */
  update(now: number, rawActors: readonly KnifeFinisherActor[], context: KnifeFinisherContext): KnifeFinisherDamageIntent[] {
    if (!this.validTime(now)) return [];
    this.lastAt = now;
    if (!this.permitted(context)) { this.pending.clear(); return []; }
    const actors = new Map(rawActors.slice(0, KNIFE_FINISHER_RULES.maxActors).map(a => [a.id, a]));
    const damage: KnifeFinisherDamageIntent[] = [], hitTargets = new Set<string>();
    for (const [id, value] of this.pending) {
      const tell = value.tell, attacker = actors.get(id), target = actors.get(tell.targetId);
      const valid = attacker && target && this.active(attacker, now) && this.active(target, now) && attacker.armed &&
        attacker.lifeRevision === tell.attackerLifeRevision && target.lifeRevision === tell.targetLifeRevision &&
        (attacker.zoneRevision ?? 0) === value.attackerZoneRevision && (target.zoneRevision ?? 0) === value.targetZoneRevision &&
        (context.worldRevision ?? 0) === tell.worldRevision && attacker.weaponId === value.weaponId &&
        attacker.health >= value.attackerHealth && (attacker.lastHurtAt ?? 0) === value.attackerHurtAt &&
        (attacker.damageRevision ?? 0) === value.attackerDamageRevision &&
        target.health <= KNIFE_FINISHER_RULES.woundedHealth && distance(attacker, value.origin) <= KNIFE_FINISHER_RULES.attackerMovement &&
        distance(target, tell.point) <= tell.radius && this.clear(attacker, target) && this.clear(value.origin, attacker) &&
        now <= tell.until + KNIFE_FINISHER_RULES.impactGraceMs;
      // Stepping out, healing, changing context, or interrupting the attacker permanently cancels this tell.
      if (!valid) { this.pending.delete(id); continue; }
      if (now < tell.until) continue;
      this.pending.delete(id);
      if (hitTargets.has(target.id) || hitTargets.has(attacker.id)) continue;
      hitTargets.add(target.id);
      damage.push({ id: `${tell.id}:impact`, attackerId: attacker.id, targetId: target.id,
        attackerLifeRevision: tell.attackerLifeRevision, targetLifeRevision: tell.targetLifeRevision,
        attackerZoneRevision: value.attackerZoneRevision, targetZoneRevision: value.targetZoneRevision,
        worldRevision: tell.worldRevision, amount: KNIFE_FINISHER_RULES.damage, occurredAt: now });
    }
    return damage;
  }
}
