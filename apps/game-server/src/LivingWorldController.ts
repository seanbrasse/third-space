import { randomUUID } from 'node:crypto';
import type { Point, WorldDefinition } from '@third-space/config';
import type { Facing } from '@third-space/contracts';
import type { ForestNPC } from '../../../packages/contracts/src/forest-npc';
import type { ForestCombatEncounter, ForestMob } from '../../../packages/contracts/src/forest-mobs';
import { distance, findHomePath, isHomeSegmentWalkable, isHomeWalkable } from '@third-space/simulation';
import type { ForestCombatant, SpendKnifeSwing } from './ForestCombatEncounters';
import { npcSegmentOutsideFire } from './ForestNPCController';
import { LANTERN_ROAD } from './living-world-npcs';
import { SURVIVAL } from './survival-inventory';

export const LIVING_WORLD_RULES = Object.freeze({
  maxHumans: 8, maxNpcs: 36, maxHostiles: 2, maxTickMs: 100,
  activationWarmupMs: 12000, activationCheckMs: 8000, activationChance: .22,
  discoveryRange: 9, helpCooldownMs: 90000, interactionRange: 2.5,
  approachRange: 12, noticeRange: 5, turnOnHumanRange: 3.5, leashRadius: 18,
  health: 60, speed: 1.9, fleeSpeed: 1.65, civilianFleeSpeed: 1.1, escortSpeed: 1.35,
  damage: 10, attackRadius: 1.05, windupMs: 900, recoveryMs: 1500,
  firstTellMs: 2000, attackCooldownMs: 800, pathRefreshMs: 800,
  postCasualtyMs: 6000,
  maxPathQueries: 1, maxPathPoints: 96, retryMs: 45000,
  dangerTimeoutMs: 180000, escortTimeoutMs: 240000,
  escortFollowRange: 6, arrivalRange: 1.7, witnessRange: 8, fearRange: 7,
  memoryMs: 180000, maxWitnesses: 288, maxPendingEvents: 16,
  lightRange: 5, lightConeDot: .35,
});

export interface LivingWorldHuman extends ForestCombatant {
  facing?: Facing;
  flashlightOn?: boolean;
  flashlightBattery?: number;
  lifeRevision?: number;
  /** Authoritative personal relationships founded on actual harmful acts; never raw client claims. */
  afraidNpcIds?: readonly string[];
}
export interface LivingWorldSteeringIntent {
  npcId: string; goal: Point; speed: number;
  activity: 'fleeing' | 'escorting' | 'warning' | 'recovering' | 'fruit-picking'; until: number;
  bubble?: { id: string; text: string; until: number };
}
export interface LivingWorldDamageIntent {
  id: string; mobId: string; targetId: string; targetKind: 'human' | 'npc';
  targetLifeRevision?: number; amount: number; occurredAt: number;
}
export interface LivingWorldEvent {
  eventId: string; event: 'discovered' | 'protected' | 'escort-arrived' | 'setback';
  incidentId: string; attemptId: string; actorId: string; participantIds: string[];
  npcId: string; occurredAt: number;
}
export type LivingWorldRescuePhase = 'dormant' | 'endangered' | 'escorting' | 'cooldown' | 'recovering' | 'complete';
export interface LivingWorldRescueSnapshot {
  phase: LivingWorldRescuePhase; incidentId: string; attemptId?: string; npcId: string;
  helperIds: string[]; helpTargetId?: string; destination: Point; retryAt?: number;
}
export interface LivingWorldDefinition {
  incidentId: string; npcId: string; origin: Point; destination: Point;
  route: readonly Point[]; bandits: readonly Point[];
}
export interface LivingWorldContext {
  night?: boolean;
  /** Room supplies the remaining global route-search budget after NPC work. */
  pathSearchBudget?: number;
  /** Optional authoritative lamps/wards in addition to the directional flashlight. */
  isLit?: (point: Point) => boolean;
}
interface MobActor { state: ForestMob; home: Point; path: Point[]; nextPathAt: number; readyAt: number; targetId?: string; targetLifeRevision?: number; hitSerial: number }
interface Witness { npcId: string; actorId: string; victimName: string; until: number }
type ActionResult = { ok: true } | { ok: false; reason: string };
const cloneMob = (m: ForestMob): ForestMob => ({ ...m, ...(m.windup ? { windup: { ...m.windup } } : {}) });

/** A room-owned simulation. Interest sets, sockets, and human membership never enter this controller. */
export class LivingWorldController {
  private readonly definition: LivingWorldDefinition;
  private readonly random: () => number;
  private readonly sessionId: string;
  private mobs: MobActor[] = [];
  private phase: LivingWorldRescuePhase = 'dormant';
  private lastAt: number | null = null;
  private nextCheckAt: number | null = null;
  private retryAt = 0;
  private postCasualtyUntil: number | null = null;
  private casualtyRetreatStarted = false;
  private startedAt: number | null = null;
  private attempt = 0;
  private attemptId = '';
  private incidentWitnessId?: string;
  private helpTargetId?: string;
  private helpers = new Set<string>();
  private declined = new Set<string>();
  private helpAt = new Map<string, number>();
  private attackAt = new Map<string, number>();
  private pending = new Map<string, LivingWorldEvent>();
  private witnesses = new Map<string, Witness>();
  private pathCursor = 0;
  private routeIndex = 0;
  private lastPathQueries = 0;
  private lastSteeringCount = 0;
  private latestNpc?: ForestNPC;
  private outcomeSerial = 0;

  constructor(private world: WorldDefinition, options: { random?: () => number; sessionId?: string; definition?: LivingWorldDefinition } = {}) {
    this.definition = options.definition ?? LANTERN_ROAD;
    this.random = options.random ?? Math.random;
    this.sessionId = options.sessionId ?? randomUUID();
    // An incomplete authored encounter is disabled, never silently made easier.
    if (this.definition.bandits.length !== LIVING_WORLD_RULES.maxHostiles || !this.definition.npcId.startsWith('npc:') ||
      !this.walkable(this.definition.origin) || !this.walkable(this.definition.destination) ||
      this.definition.bandits.some(p => !this.walkable(p)) || this.definition.route.length > 12 || this.definition.route.some(p => !this.walkable(p))) return;
    this.mobs = this.definition.bandits.map((home, i) => ({ home: { ...home }, path: [], nextPathAt: 0, readyAt: 0, hitSerial: 0, state: {
      id: `mob:${this.definition.incidentId}:${i}`, encounterId: this.definition.incidentId,
      name: i ? 'Briarhook bandit' : 'Thornmask bandit', kind: 'bramble-raider', ...home, facing: 'down',
      health: LIVING_WORLD_RULES.health, maxHealth: LIVING_WORLD_RULES.health, lifeRevision: 0, phase: 'idle', moving: false,
    } }));
  }

  private walkable(p: Point) { return Number.isFinite(p.x) && Number.isFinite(p.y) && isHomeWalkable(p, this.world.map) && npcSegmentOutsideFire(p, p, this.world); }
  private segment(a: Point, b: Point) { return isHomeSegmentWalkable(a, b, this.world.map) && npcSegmentOutsideFire(a, b, this.world); }
  private active(p: LivingWorldHuman, now: number) {
    return !p.id.startsWith('npc:') && !p.id.startsWith('mob:') && p.connected && p.mode === 'home' && !p.zone &&
      !p.respawnAt && !p.seatId && !p.watching && (p.haloUntil ?? 0) <= now && p.health > 0 && this.walkable(p);
  }
  private alive(npc: ForestNPC | undefined): npc is ForestNPC { return !!npc && npc.phase !== 'respawning' && npc.health > 0 && this.walkable(npc); }
  private validTime(now: number) { return Number.isFinite(now) && (this.lastAt === null || now >= this.lastAt); }
  private attemptReady() { return this.mobs.length === 2 && this.pending.size <= LIVING_WORLD_RULES.maxPendingEvents - 4; }

  snapshot(): { mobs: ForestMob[]; encounters: ForestCombatEncounter[]; rescue: LivingWorldRescueSnapshot } {
    const visible = this.phase === 'dormant' || this.phase === 'endangered' || (this.phase === 'cooldown' && this.postCasualtyUntil !== null);
    const pursuingAfterCasualty = this.phase === 'cooldown' && this.postCasualtyUntil !== null && (this.lastAt ?? 0) < this.postCasualtyUntil;
    return {
      mobs: visible ? this.mobs.map(m => cloneMob(m.state)) : [],
      encounters: visible && this.mobs.length ? [{ id: this.definition.incidentId, title: 'Lantern Road', phase: this.phase === 'endangered' || pursuingAfterCasualty ? 'active' : this.phase === 'cooldown' ? 'resetting' : 'idle', participantScale: 1, ...(this.phase === 'cooldown' ? { resetAt: this.retryAt } : {}) }] : [],
      rescue: { phase: this.phase, incidentId: this.definition.incidentId, npcId: this.definition.npcId,
        ...(this.attemptId ? { attemptId: this.attemptId } : {}), helperIds: [...this.helpers].sort(),
        ...(this.helpTargetId ? { helpTargetId: this.helpTargetId } : {}), destination: { ...this.definition.destination },
        ...(this.phase === 'cooldown' ? { retryAt: this.retryAt } : {}) },
    };
  }
  diagnostics() { return { hostiles: this.mobs.length, lastPathQueries: this.lastPathQueries, lastSteeringCount: this.lastSteeringCount, pendingEvents: this.pending.size, witnessMemories: this.witnesses.size, helpCooldowns: this.helpAt.size, attackCooldowns: this.attackAt.size }; }
  pendingEvents(): LivingWorldEvent[] { return [...this.pending.values()].map(e => ({ ...e, participantIds: [...e.participantIds] })); }
  /** Acknowledge only after the durable home transaction accepts or deduplicates this event. */
  acknowledgeEvent(eventId: string) { return this.pending.delete(eventId); }

  /** Restore forward progress after restart; a stale store read cannot rewind an in-flight physical outcome. */
  syncStory(stage: 'quiet' | 'endangered' | 'escorting' | 'recovering' | 'complete') {
    if (stage === 'complete') this.phase = 'complete';
    else if (stage === 'recovering' && this.phase !== 'complete') this.phase = 'recovering';
    else if (stage === 'escorting' && (this.phase === 'dormant' || (this.phase === 'cooldown' && this.postCasualtyUntil === null))) {
      this.phase = 'escorting'; this.startedAt = this.lastAt; this.attemptId ||= `${this.sessionId}:restored`; this.routeIndex = 0;
    }
    if (this.phase === 'recovering' || this.phase === 'complete') { this.helpTargetId = undefined; for (const m of this.mobs) { m.path = []; delete m.state.windup; } }
  }
  private emit(event: LivingWorldEvent['event'], now: number, actorId = [...this.helpers].sort()[0] ?? this.incidentWitnessId ?? this.helpTargetId) {
    if (!actorId || this.pending.size >= LIVING_WORLD_RULES.maxPendingEvents) return;
    const eventId = `living:${this.attemptId}:${event}:${++this.outcomeSerial}`;
    this.pending.set(eventId, { eventId, event, incidentId: this.definition.incidentId, attemptId: this.attemptId,
      actorId, participantIds: [...this.helpers].sort(), npcId: this.definition.npcId, occurredAt: now });
  }
  private begin(now: number, actorId: string) {
    this.postCasualtyUntil = null; this.casualtyRetreatStarted = false;
    this.phase = 'endangered'; this.startedAt = now; this.routeIndex = 0;
    this.attemptId = `${this.sessionId}:${++this.attempt}`; this.helpers.clear(); this.declined.clear();
    this.incidentWitnessId = actorId; this.helpTargetId = actorId; this.helpAt.set(actorId, now + LIVING_WORLD_RULES.helpCooldownMs);
    for (const mob of this.mobs) { mob.readyAt = now + LIVING_WORLD_RULES.firstTellMs; mob.state.phase = 'recovering'; }
    this.emit('discovered', now, actorId);
  }
  private reset(now: number) {
    this.postCasualtyUntil = null; this.casualtyRetreatStarted = false;
    this.phase = 'dormant'; this.incidentWitnessId = undefined; this.helpTargetId = undefined; this.helpers.clear(); this.declined.clear();
    this.nextCheckAt = now + LIVING_WORLD_RULES.activationWarmupMs;
    for (const mob of this.mobs) {
      Object.assign(mob.state, mob.home, { health: LIVING_WORLD_RULES.health, maxHealth: LIVING_WORLD_RULES.health,
        lifeRevision: mob.state.lifeRevision + 1, phase: 'idle', moving: false });
      delete mob.state.windup; delete mob.state.hurtAt; delete mob.state.defeatedAt;
      mob.path = []; mob.targetId = undefined; mob.readyAt = now; mob.nextPathAt = now;
    }
  }
  private setback(now: number, casualty = false) {
    this.emit('setback', now); this.phase = 'cooldown'; this.retryAt = now + LIVING_WORLD_RULES.retryMs;
    this.postCasualtyUntil = casualty ? now + LIVING_WORLD_RULES.postCasualtyMs : null;
    this.casualtyRetreatStarted = false;
    this.helpTargetId = undefined;
    for (const mob of this.mobs) {
      // Preserve real positions and health, but never carry a civilian's committed strike onto a human.
      mob.path = []; mob.nextPathAt = now; mob.state.moving = false; mob.targetId = undefined; mob.targetLifeRevision = undefined; delete mob.state.windup;
      mob.readyAt = Math.max(mob.readyAt, now);
      if (mob.state.health > 0) mob.state.phase = 'recovering';
    }
  }
  private nearNpc(actor: LivingWorldHuman, now: number, npc = this.latestNpc) {
    return this.validTime(now) && this.active(actor, now) && this.alive(npc) && npc.id === this.definition.npcId && distance(actor, npc) <= LIVING_WORLD_RULES.interactionRange && this.segment(actor, npc);
  }
  protect(actor: LivingWorldHuman, now: number, npc = this.latestNpc): ActionResult {
    if (!this.nearNpc(actor, now, npc) || !['dormant', 'endangered'].includes(this.phase) || !this.attemptReady()) return { ok: false, reason: 'Reach Mara on Lantern Road first' };
    if (this.phase === 'dormant') this.begin(now, actor.id);
    if (this.helpers.size < LIVING_WORLD_RULES.maxHumans) this.helpers.add(actor.id);
    this.declined.delete(actor.id); this.helpTargetId = actor.id; return { ok: true };
  }
  decline(actor: LivingWorldHuman, now: number, npc = this.latestNpc): ActionResult {
    if (this.phase !== 'endangered' || !this.nearNpc(actor, now, npc)) return { ok: false, reason: 'That request is no longer nearby' };
    if (this.declined.size < LIVING_WORLD_RULES.maxHumans) this.declined.add(actor.id);
    this.helpers.delete(actor.id); if (this.helpTargetId === actor.id) this.helpTargetId = undefined;
    return { ok: true };
  }
  escort(actor: LivingWorldHuman, now: number, npc = this.latestNpc): ActionResult {
    if (this.phase !== 'escorting' || !this.nearNpc(actor, now, npc)) return { ok: false, reason: 'Clear the road and reach Mara first' };
    if (this.helpers.size < LIVING_WORLD_RULES.maxHumans) this.helpers.add(actor.id);
    this.helpTargetId = actor.id; this.startedAt = now; return { ok: true };
  }

  strike(actor: LivingWorldHuman, mobId: string, lifeRevision: number, now: number, spendSwing: SpendKnifeSwing, damage: number = SURVIVAL.attackDamage): ActionResult {
    const mob = this.mobs.find(m => m.state.id === mobId);
    const available = ['dormant', 'endangered'].includes(this.phase) || (this.phase === 'cooldown' && this.postCasualtyUntil !== null);
    if (!this.validTime(now) || !mob || !available || mob.state.health <= 0 || lifeRevision !== mob.state.lifeRevision || !Number.isFinite(damage) || damage <= 0)
      return { ok: false, reason: 'That threat is no longer available' };
    if (!actor.armed || !this.active(actor, now) || distance(actor, mob.state) > SURVIVAL.attackRange || !this.segment(actor, mob.state)) return { ok: false, reason: 'Equip a knife and reach the bandit outside safety' };
    if ((this.attackAt.get(actor.id) ?? -Infinity) + LIVING_WORLD_RULES.attackCooldownMs > now) return { ok: false, reason: 'Knife is recovering' };
    if (this.phase === 'dormant' && (!this.attemptReady() || !this.alive(this.latestNpc))) return { ok: false, reason: 'The road encounter is recovering' };
    const spent = spendSwing(actor, mob.state, now); if (!spent.ok) return spent;
    this.attackAt.set(actor.id, now);
    if (this.phase === 'dormant') this.begin(now, actor.id);
    if (this.phase === 'endangered' && this.helpers.size < LIVING_WORLD_RULES.maxHumans) this.helpers.add(actor.id);
    mob.state.health = Math.max(0, mob.state.health - Math.min(500, damage)); mob.state.hurtAt = now;
    if (!mob.state.health) { mob.state.phase = 'defeated'; mob.state.defeatedAt = now; mob.state.moving = false; mob.path = []; delete mob.state.windup; }
    return { ok: true };
  }

  /** Call only after an accepted, authoritative harmful NPC strike. Witnesses remember what they actually saw. */
  observeViolence(actor: LivingWorldHuman, victimId: string, now: number, npcs: readonly ForestNPC[], humanVictim?:{id:string;name:string;x:number;y:number}) {
    const victim = npcs.find(n => n.id === victimId)??(humanVictim?.id===victimId?humanVictim:undefined);
    if (!victim || !this.validTime(now) || !this.active(actor, now) || distance(actor, victim) > SURVIVAL.attackRange || !this.segment(actor, victim)) return;
    for (const npc of npcs.slice(0, LIVING_WORLD_RULES.maxNpcs)) {
      if (!this.alive(npc) || !this.civilian(npc) || distance(npc, actor) > LIVING_WORLD_RULES.witnessRange || !this.segment(npc, actor) || !this.segment(npc,victim)) continue;
      const key = `${npc.id}|${actor.id}`;
      if (!this.witnesses.has(key) && this.witnesses.size >= LIVING_WORLD_RULES.maxWitnesses) continue;
      this.witnesses.set(key, { npcId: npc.id, actorId: actor.id, victimName: victim.name.slice(0, 40), until: now + LIVING_WORLD_RULES.memoryMs });
    }
  }
  private civilian(npc: ForestNPC) { return ['villager', 'wizard', 'witch', 'king', 'queen', 'catfolk', 'goblin'].includes(npc.art); }
  private lit(point: Point, humans: readonly LivingWorldHuman[], now: number, context: LivingWorldContext) {
    if (!context.night) return false;
    if (context.isLit?.(point)) return true;
    return humans.some(p => {
      if (!this.active(p, now) || !p.flashlightOn || (p.flashlightBattery ?? 0) <= 0) return false;
      const d = distance(p, point); if (d > LIVING_WORLD_RULES.lightRange || !this.segment(p, point)) return false;
      const dir = p.facing === 'left' ? { x: -1, y: 0 } : p.facing === 'right' ? { x: 1, y: 0 } : p.facing === 'up' ? { x: 0, y: -1 } : { x: 0, y: 1 };
      return d < .75 || ((point.x - p.x) * dir.x + (point.y - p.y) * dir.y) / d >= LIVING_WORLD_RULES.lightConeDot;
    });
  }
  private fleeGoal(npc: Point, threat: Point): Point {
    const d = distance(npc, threat) || 1, dx = (npc.x - threat.x) / d, dy = (npc.y - threat.y) / d;
    const candidates = [{ x: dx * 4, y: dy * 4 }, { x: -dy * 3, y: dx * 3 }, { x: dy * 3, y: -dx * 3 }, { x: dx * 2, y: dy * 2 }];
    for (const offset of candidates) { const p = { x: npc.x + offset.x, y: npc.y + offset.y }; if (this.walkable(p) && this.segment(npc, p)) return p; }
    return { x: npc.x, y: npc.y };
  }

  update(now: number, rawHumans: readonly LivingWorldHuman[], rawNpcs: readonly ForestNPC[], context: LivingWorldContext = {}) {
    const damage: LivingWorldDamageIntent[] = [], steering: LivingWorldSteeringIntent[] = [];
    if (!this.validTime(now)) return { damage, steering, events: this.pendingEvents() };
    const dt = this.lastAt === null ? 0 : Math.min(LIVING_WORLD_RULES.maxTickMs, now - this.lastAt) / 1000;
    this.lastAt = now; this.lastPathQueries = 0; this.lastSteeringCount = 0;
    this.nextCheckAt ??= now + LIVING_WORLD_RULES.activationWarmupMs;
    const humans = [...new Map(rawHumans.slice(0, LIVING_WORLD_RULES.maxHumans).map(p => [p.id, p])).values()];
    const npcs = rawNpcs.slice(0, LIVING_WORLD_RULES.maxNpcs), npc = npcs.find(n => n.id === this.definition.npcId);
    this.latestNpc = npc;
    for (const [id, until] of this.helpAt) if (until <= now) this.helpAt.delete(id);
    for (const [id, at] of this.attackAt) if (at + LIVING_WORLD_RULES.attackCooldownMs <= now) this.attackAt.delete(id);
    for (const [id, memory] of this.witnesses) if (memory.until <= now) this.witnesses.delete(id);
    const exposed = humans.filter(p => this.active(p, now));
    if (this.phase === 'cooldown' && now >= this.retryAt && this.alive(npc)) this.reset(now);
    if (this.phase === 'dormant' && now >= this.nextCheckAt) {
      this.nextCheckAt = now + LIVING_WORLD_RULES.activationCheckMs;
      const nearby = this.alive(npc) ? exposed.filter(p => !this.helpAt.has(p.id) && distance(p, npc) <= LIVING_WORLD_RULES.discoveryRange && this.segment(p, npc)).sort((a, b) => distance(a, npc) - distance(b, npc) || a.id.localeCompare(b.id))[0] : undefined;
      if (nearby && this.attemptReady() && this.random() < LIVING_WORLD_RULES.activationChance) this.begin(now, nearby.id);
    }
    if (this.phase === 'endangered' || this.phase === 'escorting') {
      // A restored room has no simulation clock until its first tick. Zero is not an epoch-safe start.
      this.startedAt ??= now;
      if (!this.alive(npc) || now - this.startedAt > (this.phase === 'endangered' ? LIVING_WORLD_RULES.dangerTimeoutMs : LIVING_WORLD_RULES.escortTimeoutMs)) this.setback(now, !this.alive(npc) && this.phase === 'endangered');
      else this.rescueStep(now, npc, exposed, steering);
    }
    if (this.phase === 'endangered' && this.alive(npc)) this.mobStep(now, dt, humans, exposed, npc, context, damage);
    if (this.phase === 'cooldown' && this.postCasualtyUntil !== null) {
      const pursuing = now < this.postCasualtyUntil;
      if (!pursuing && !this.casualtyRetreatStarted) {
        this.casualtyRetreatStarted = true;
        for (const mob of this.mobs) {
          delete mob.state.windup; mob.targetId = undefined; mob.targetLifeRevision = undefined;
          mob.path = []; mob.nextPathAt = now; mob.readyAt = now;
          if (mob.state.health > 0) mob.state.phase = 'returning';
        }
      }
      // After six seconds, even a windup already in progress is cancelled and every survivor walks home.
      this.mobStep(now, dt, humans, pursuing ? exposed : [], undefined, context, damage);
    }
    if ((this.phase === 'recovering' || this.phase === 'complete') && this.alive(npc)) {
      steering.push({ npcId: npc.id, goal: { ...this.definition.destination }, speed: .9,
        activity: this.phase === 'recovering' ? 'recovering' : 'fruit-picking', until: now + 1200 });
    }
    // Fear is based on nearby observable mobs or a recent witnessed act, never private reputation omniscience.
    const already = new Set(steering.map(s => s.npcId));
    for (const actor of npcs) {
      if (already.has(actor.id) || !this.alive(actor) || !this.civilian(actor)) continue;
      const mob = this.phase === 'endangered' || (this.phase === 'cooldown' && this.postCasualtyUntil !== null && now < this.postCasualtyUntil) ? this.mobs.filter(m => m.state.health > 0 && distance(m.state, actor) <= LIVING_WORLD_RULES.noticeRange && this.segment(actor, m.state)).sort((a, b) => distance(a.state, actor) - distance(b.state, actor))[0] : undefined;
      const witness = [...this.witnesses.values()].filter(w => w.npcId === actor.id).map(w => ({ memory: w, player: exposed.find(p => p.id === w.actorId) })).find(w => w.player && distance(w.player, actor) <= LIVING_WORLD_RULES.fearRange && this.segment(actor, w.player));
      const remembered = exposed.find(p => (p.afraidNpcIds?.includes(actor.id) || p.afraidNpcIds?.includes(actor.id.slice(4))) && distance(p, actor) <= LIVING_WORLD_RULES.fearRange && this.segment(actor, p));
      const threat = mob?.state ?? witness?.player ?? remembered;
      if (threat) steering.push({ npcId: actor.id, goal: this.fleeGoal(actor, threat), speed: LIVING_WORLD_RULES.fleeSpeed, activity: 'fleeing', until: now + 1200,
        ...(witness ? { bubble: { id: `witness:${actor.id}:${witness.memory.actorId}:${witness.memory.until}`, text: `I saw you strike ${witness.memory.victimName}. Please stay back.`, until: now + 1200 } } : remembered ? { bubble: { id: `caution:${actor.id}:${remembered.id}`, text: 'Please give me some room. I still remember being hurt.', until: now + 1200 } } : {}) });
    }
    this.lastSteeringCount = steering.length;
    return { damage, steering, events: this.pendingEvents() };
  }

  private rescueStep(now: number, npc: ForestNPC, exposed: LivingWorldHuman[], steering: LivingWorldSteeringIntent[]) {
    const nearby = exposed.filter(p => !this.declined.has(p.id) && distance(p, npc) <= LIVING_WORLD_RULES.approachRange && this.segment(p, npc));
    let target = nearby.find(p => p.id === this.helpTargetId);
    if (!target) {
      target = nearby.filter(p => this.helpers.has(p.id) || !this.helpAt.has(p.id)).sort((a, b) => Number(this.helpers.has(b.id)) - Number(this.helpers.has(a.id)) || distance(a, npc) - distance(b, npc) || a.id.localeCompare(b.id))[0];
      this.helpTargetId = target?.id;
      if (target) this.helpAt.set(target.id, now + LIVING_WORLD_RULES.helpCooldownMs);
    }
    if (this.phase === 'endangered') {
      const live = this.mobs.filter(m => m.state.health > 0);
      const companion = nearby.find(p => this.helpers.has(p.id) && distance(p, npc) <= LIVING_WORLD_RULES.escortFollowRange);
      if (!live.length || (companion && now - (this.startedAt ?? now) > LIVING_WORLD_RULES.firstTellMs && live.every(m => distance(m.state, npc) > 10))) {
        if (!this.helpers.size && target) this.helpers.add(target.id);
        if (this.helpers.size) { this.phase = 'escorting'; this.startedAt = now; this.emit('protected', now); for (const m of this.mobs) { m.path = []; m.state.moving = false; delete m.state.windup; } }
      }
      if (this.phase === 'endangered') {
        const threat = live.sort((a, b) => distance(a.state, npc) - distance(b.state, npc))[0];
        const goal = target && distance(target, npc) > 1.6 ? { x: target.x, y: target.y } : threat && distance(threat.state, npc) <= LIVING_WORLD_RULES.noticeRange + 1 ? this.fleeGoal(npc, threat.state) : { x: npc.x, y: npc.y };
        steering.push({ npcId: npc.id, goal, speed: LIVING_WORLD_RULES.civilianFleeSpeed, activity: 'fleeing', until: now + 1200,
          ...(target ? { bubble: { id: `help:${this.attemptId}:${target.id}`, text: 'Bandits on the road! Please, help me reach Bramblewick.', until: now + 1200 } } : {}) });
      }
    }
    if (this.phase === 'escorting') {
      const helper = nearby.find(p => this.helpers.has(p.id) && distance(p, npc) <= LIVING_WORLD_RULES.escortFollowRange);
      if (helper && distance(npc, this.definition.destination) <= LIVING_WORLD_RULES.arrivalRange) {
        this.phase = 'recovering'; this.emit('escort-arrived', now, helper.id); this.helpTargetId = undefined; return;
      }
      if (helper) {
        while (this.routeIndex < this.definition.route.length && distance(npc, this.definition.route[this.routeIndex]!) <= 1.2) this.routeIndex++;
        const goal = this.definition.route[this.routeIndex] ?? this.definition.destination;
        steering.push({ npcId: npc.id, goal: { ...goal }, speed: LIVING_WORLD_RULES.escortSpeed, activity: 'escorting', until: now + 1200,
          bubble: { id: `escort:${this.attemptId}`, text: 'Stay close. We can bring the apples home together.', until: now + 1200 } });
      } else steering.push({ npcId: npc.id, goal: { x: npc.x, y: npc.y }, speed: 0, activity: 'escorting', until: now + 1200 });
    }
  }

  private mobStep(now: number, dt: number, humans: LivingWorldHuman[], exposed: LivingWorldHuman[], npc: ForestNPC | undefined, context: LivingWorldContext, damage: LivingWorldDamageIntent[]) {
    const needsPath: { mob: MobActor; goal: Point }[] = [];
    for (const mob of this.mobs) {
      const state = mob.state; state.moving = false;
      if (state.health <= 0) continue;
      const illuminated = this.lit(state, humans, now, context);
      if (illuminated) { delete state.windup; mob.path = []; state.phase = 'recovering'; mob.readyAt = now + 200; continue; }
      const candidates: (LivingWorldHuman | ForestNPC)[] = [
        ...exposed.filter(p => distance(p, state) <= LIVING_WORLD_RULES.turnOnHumanRange && distance(p, mob.home) <= LIVING_WORLD_RULES.leashRadius && this.segment(state, p) && !this.lit(p, humans, now, context)),
        ...(this.alive(npc) && distance(npc, mob.home) <= LIVING_WORLD_RULES.leashRadius && this.segment(state, npc) && !this.lit(npc, humans, now, context) ? [npc] : []),
      ];
      if (state.phase === 'windup') {
        if (now >= state.windup!.until) {
          const impact = state.windup!, target = candidates.find(p => p.id === mob.targetId);
          // Only the committed target can be hit, at the fixed telegraphed point, after fresh safety/LOS checks.
          if (target && (target.lifeRevision ?? 0) === mob.targetLifeRevision && distance(target, impact) <= impact.radius && this.segment(state, target)) {
            damage.push({ id: `${this.attemptId}:${state.id}:${state.lifeRevision}:hit:${++mob.hitSerial}`, mobId: state.id, targetId: target.id,
              targetKind: target.id.startsWith('npc:') ? 'npc' : 'human', amount: LIVING_WORLD_RULES.damage, occurredAt: now,
              targetLifeRevision: target.lifeRevision ?? 0 });
          }
          delete state.windup; state.phase = 'recovering'; mob.readyAt = now + LIVING_WORLD_RULES.recoveryMs;
        }
        continue;
      }
      if (now < mob.readyAt) continue;
      const target = candidates.sort((a, b) => distance(a, state) - distance(b, state) || a.id.localeCompare(b.id))[0];
      const goal = target ?? mob.home;
      if (target && distance(target, state) <= LIVING_WORLD_RULES.attackRadius + .2) {
        state.phase = 'windup'; state.windup = { x: target.x, y: target.y, until: now + LIVING_WORLD_RULES.windupMs, radius: LIVING_WORLD_RULES.attackRadius };
        mob.targetId = target.id; mob.targetLifeRevision = target.lifeRevision ?? 0; mob.path = []; continue;
      }
      state.phase = target ? 'pursuing' : 'returning';
      if (distance(state, goal) < .05) { mob.path = []; if (!target) state.phase = 'idle'; continue; }
      if (now >= mob.nextPathAt) needsPath.push({ mob, goal: { x: goal.x, y: goal.y } });
      const next = mob.path[0]; if (!next || !dt) continue;
      const d = distance(state, next); if (d < .02) { mob.path.shift(); continue; }
      const step = Math.min(d, LIVING_WORLD_RULES.speed * dt), point = { x: state.x + (next.x - state.x) / d * step, y: state.y + (next.y - state.y) / d * step };
      if (!this.walkable(point) || !this.segment(state, point) || distance(point, mob.home) > LIVING_WORLD_RULES.leashRadius || this.lit(point, humans, now, context)) { mob.path = []; continue; }
      state.facing = Math.abs(next.x - state.x) > Math.abs(next.y - state.y) ? next.x > state.x ? 'right' : 'left' : next.y > state.y ? 'down' : 'up';
      Object.assign(state, point); state.moving = true;
    }
    const budget = Math.max(0, Math.min(LIVING_WORLD_RULES.maxPathQueries, Math.floor(context.pathSearchBudget ?? 1)));
    if (needsPath.length && budget > 0) {
      const { mob, goal } = needsPath[this.pathCursor++ % needsPath.length]!;
      mob.nextPathAt = now + LIVING_WORLD_RULES.pathRefreshMs; this.lastPathQueries++;
      const path = findHomePath(mob.state, goal, this.world.map);
      mob.path = path && path.length <= LIVING_WORLD_RULES.maxPathPoints && path.every((p, i) => this.walkable(p) && distance(p, mob.home) <= LIVING_WORLD_RULES.leashRadius && (!i || this.segment(path[i - 1]!, p))) ? path.slice(1) : [];
    }
  }
}
