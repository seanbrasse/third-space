import { randomUUID } from 'node:crypto';
import type { Point, WorldDefinition } from '@third-space/config';
import type { ForestNPC } from '../../../packages/contracts/src/forest-npc';
import type { ForestCombatEncounter, ForestMob } from '../../../packages/contracts/src/forest-mobs';
import { distance, findHomePath, isHomeSegmentWalkable, isHomeWalkable } from '@third-space/simulation';
import type { LivingWorldHuman } from './LivingWorldController';
import type { SpendKnifeSwing } from './ForestCombatEncounters';
import { npcSegmentOutsideFire } from './ForestNPCController';
import { SURVIVAL } from './survival-inventory';

export const GOBLIN_PATROL_RULES = Object.freeze({
  maxHostiles: 2, maxHumans: 8, maxNpcs: 36, maxTickMs: 100, maxPatrolPoints: 8,
  maxPathQueries: 1, pathBudgetWindowMs: 100, pathRefreshMs: 700, maxPathPoints: 64,
  areaRadius: 12, noticeRadius: 6, leashRadius: 10, health: 60, damage: 10,
  patrolSpeed: .8, chaseSpeed: 1.65, firstTellMs: 1000, windupMs: 900,
  attackRadius: 1.1, recoveryMs: 1500, postCasualtyMs: 6000, retargetTellMs: 900,
  retreatRestMs: 4000, respawnMs: 45000, wardRadius: 4, lightRadius: 5,
  spiritRadius: 3, pulseRadius: 1.2, pulseWindupMs: 1200, pulseCooldownMs: 20000, snareMs: 5000,
  impactGraceMs: 250,
});
export interface GoblinPatrolHuman extends LivingWorldHuman { zoneRevision?: number; wardUntil?: number }
export interface GoblinPatrolContext {
  pathSearchBudget?: number;
  protectedNpcIds?: ReadonlySet<string> | readonly string[];
  isProtectedNpc?: (npc: ForestNPC) => boolean;
  night?: boolean;
  isLit?: (point: Point) => boolean;
}
export interface GoblinDamageIntent {
  id: string; mobId: string; targetId: string; targetKind: 'human' | 'npc';
  targetLifeRevision: number; targetZoneRevision: number; amount: number; occurredAt: number;
}
export interface GoblinSnareIntent {
  id: string; sourceNpcId: string; targetId: string; targetLifeRevision: number;
  targetZoneRevision: number; until: number; occurredAt: number;
}
export interface GoblinSpiritPulse { id: string; x: number; y: number; radius: number; until: number }
export interface GoblinPatrolDefinition { id: string; name: string; home: Point; patrol: readonly Point[] }
export const STOLEN_LANTERN_GOBLINS: readonly GoblinPatrolDefinition[] = [
  { id: 'mob:stolen-lantern:cave', name: 'Grib Wickfinger', home: { x: 64, y: 82 }, patrol: [{ x: 64, y: 82 }, { x: 62, y: 82 }, { x: 62, y: 84 }, { x: 65, y: 84 }] },
  { id: 'mob:stolen-lantern:pond', name: 'Skrit Reedknife', home: { x: 99, y: 72 }, patrol: [{ x: 99, y: 72 }, { x: 97, y: 72 }, { x: 98, y: 70 }, { x: 101, y: 72 }] },
];
interface Target { id: string; kind: 'human' | 'npc'; lifeRevision: number; zoneRevision: number }
interface MobActor {
  definition: GoblinPatrolDefinition; state: ForestMob; path: Point[]; nextPathAt: number; readyAt: number;
  patrolIndex: number; target?: Target; postCasualtyUntil?: number; retreating: boolean; restUntil: number; hitSerial: number;
}
interface Pulse { tell: GoblinSpiritPulse; target: Target; sourceLifeRevision: number }
type Candidate = { target: Target; point: Point };
type StrikeResult = { ok: true } | { ok: false; reason: string };
const copyMob = (mob: ForestMob): ForestMob => ({ ...mob, ...(mob.windup ? { windup: { ...mob.windup } } : {}) });
const npcTarget = (npc: ForestNPC): Target => ({ id: npc.id, kind: 'npc', lifeRevision: npc.lifeRevision ?? 0, zoneRevision: 0 });
const humanTarget = (human: GoblinPatrolHuman): Target => ({ id: human.id, kind: 'human', lifeRevision: human.lifeRevision ?? 0, zoneRevision: human.zoneRevision ?? 0 });
const validRevision = (revision: number | undefined) => revision === undefined || (Number.isSafeInteger(revision) && revision >= 0);

/** Two visible hostiles, independent of human membership and recipient rendering. */
export class GoblinPatrol {
  private mobs: MobActor[] = [];
  private lastAt: number | null = null;
  private nextPathSearchAt = 0;
  private pathCursor = 0;
  private lastPathQueries = 0;
  private pulse?: Pulse;
  private pulseReadyAt = 0;
  private pulseSerial = 0;
  private readonly sessionId: string;

  constructor(private world: WorldDefinition, options: { sessionId?: string; definitions?: readonly GoblinPatrolDefinition[] } = {}) {
    this.sessionId = options.sessionId ?? randomUUID();
    for (const input of (options.definitions ?? STOLEN_LANTERN_GOBLINS).slice(0, GOBLIN_PATROL_RULES.maxHostiles)) {
      if (!input.id.startsWith('mob:stolen-lantern:') || this.mobs.some(m => m.state.id === input.id) || !this.walkable(input.home) || !input.patrol.length || input.patrol.length > GOBLIN_PATROL_RULES.maxPatrolPoints || input.patrol.some(p => !this.walkable(p) || distance(p, input.home) > GOBLIN_PATROL_RULES.leashRadius)) continue;
      const definition = { ...input, home: { ...input.home }, patrol: input.patrol.map(p => ({ ...p })) };
      this.mobs.push({ definition, path: [], nextPathAt: 0, readyAt: 0, patrolIndex: 0, retreating: false, restUntil: 0, hitSerial: 0,
        state: { id: input.id, encounterId: 'stolen-lantern-patrol', name: input.name, kind: 'bramble-raider', ...input.home,
          facing: 'down', health: GOBLIN_PATROL_RULES.health, maxHealth: GOBLIN_PATROL_RULES.health, lifeRevision: 0, phase: 'idle', moving: false } });
    }
  }
  private validTime(now: number) { return Number.isFinite(now) && now >= 0 && (this.lastAt === null || now >= this.lastAt); }
  private walkable(p: Point) { return Number.isFinite(p.x) && Number.isFinite(p.y) && isHomeWalkable(p, this.world.map) && npcSegmentOutsideFire(p, p, this.world); }
  private clear(a: Point, b: Point) { return isHomeSegmentWalkable(a, b, this.world.map) && npcSegmentOutsideFire(a, b, this.world); }
  private active(p: GoblinPatrolHuman, now: number) {
    return !p.id.startsWith('npc:') && !p.id.startsWith('mob:') && p.connected && p.mode === 'home' && !p.zone &&
      !p.respawnAt && !p.seatId && !p.watching && (p.haloUntil ?? 0) <= now && Number.isFinite(p.health) && p.health > 0 && validRevision(p.lifeRevision) && validRevision(p.zoneRevision) && this.walkable(p);
  }
  private alive(npc: ForestNPC | undefined): npc is ForestNPC { return !!npc && npc.id.startsWith('npc:') && Number.isFinite(npc.health) && npc.health > 0 && validRevision(npc.lifeRevision) && npc.phase !== 'respawning' && !npc.respawnAt && this.walkable(npc); }
  private protectedNpc(npc: ForestNPC, context: GoblinPatrolContext) {
    const ids = context.protectedNpcIds;
    const protectedById = ids && ('has' in ids ? ids.has(npc.id) || ids.has(npc.id.slice(4)) : ids.includes(npc.id) || ids.includes(npc.id.slice(4)));
    return npc.id === 'npc:keeper-ada' || (npc.id === 'npc:orchard-worker-mara' && npc.activity === 'recovering') || protectedById || context.isProtectedNpc?.(npc) === true;
  }
  private civilian(npc: ForestNPC, context: GoblinPatrolContext) {
    return this.alive(npc) && !this.protectedNpc(npc, context) && ['villager', 'wizard', 'witch', 'king', 'queen', 'catfolk', 'goblin'].includes(npc.art);
  }
  private warded(point: Point, humans: readonly GoblinPatrolHuman[], now: number) {
    return humans.some(p => this.active(p, now) && (p.wardUntil ?? 0) > now && distance(p, point) <= GOBLIN_PATROL_RULES.wardRadius && this.clear(p, point));
  }
  private lit(point: Point, humans: readonly GoblinPatrolHuman[], now: number, context: GoblinPatrolContext) {
    if (!context.night) return false;
    if (context.isLit?.(point)) return true;
    return humans.some(p => {
      if (!this.active(p, now) || !p.flashlightOn || (p.flashlightBattery ?? 0) <= 0) return false;
      const d = distance(p, point); if (d > GOBLIN_PATROL_RULES.lightRadius || !this.clear(p, point)) return false;
      const dx = p.facing === 'right' ? 1 : p.facing === 'left' ? -1 : 0;
      const dy = p.facing === 'up' ? -1 : p.facing === 'down' || !p.facing ? 1 : 0;
      return d < .75 || ((point.x - p.x) * dx + (point.y - p.y) * dy) / d >= .35;
    });
  }
  snapshot(): { mobs: ForestMob[]; encounters: ForestCombatEncounter[]; pulses: GoblinSpiritPulse[] } {
    return { mobs: this.mobs.map(m => copyMob(m.state)),
      encounters: this.mobs.length ? [{ id: 'stolen-lantern-patrol', title: 'The stolen-lantern goblins', participantScale: 1,
        phase: this.mobs.some(m => m.target || m.postCasualtyUntil) ? 'active' : this.mobs.every(m => m.state.health <= 0) ? 'defeated' : 'idle' }] : [],
      pulses: this.pulse ? [{ ...this.pulse.tell }] : [] };
  }
  diagnostics() { return { mobs: this.mobs.length, lastPathQueries: this.lastPathQueries, pathPoints: this.mobs.reduce((sum, m) => sum + m.path.length, 0), postCasualtyPursuits: this.mobs.filter(m => m.postCasualtyUntil !== undefined).length, pulses: this.pulse ? 1 : 0 }; }

  strike(actor: GoblinPatrolHuman, mobId: string, lifeRevision: number, now: number, spendSwing: SpendKnifeSwing, damage: number = SURVIVAL.attackDamage): StrikeResult {
    const mob = this.mobs.find(m => m.state.id === mobId);
    if (!this.validTime(now) || !mob || !Number.isFinite(damage) || damage <= 0 || mob.state.health <= 0 || lifeRevision !== mob.state.lifeRevision) return { ok: false, reason: 'That goblin is no longer available' };
    if (!actor.armed || !this.active(actor, now) || distance(actor, mob.state) > SURVIVAL.attackRange || !this.clear(actor, mob.state)) return { ok: false, reason: 'Equip your knife and reach the goblin outside safety' };
    const spent = spendSwing(actor, mob.state, now); if (!spent.ok) return { ok: false, reason: spent.reason };
    this.lastAt = now;
    mob.state.health = Math.max(0, mob.state.health - Math.min(500, damage)); mob.state.hurtAt = now;
    if (!mob.state.health) { mob.state.phase = 'defeated'; mob.state.defeatedAt = now; mob.state.moving = false; mob.path = []; mob.target = undefined; mob.postCasualtyUntil = undefined; delete mob.state.windup; }
    return { ok: true };
  }
  private retreat(mob: MobActor, now: number) {
    if (!mob.retreating) { mob.retreating = true; mob.restUntil = now + GOBLIN_PATROL_RULES.retreatRestMs; mob.path = []; mob.nextPathAt = now; }
    mob.target = undefined; mob.postCasualtyUntil = undefined; delete mob.state.windup; mob.state.phase = 'returning';
  }
  private setTarget(mob: MobActor, target: Target, now: number, tellMs: number = GOBLIN_PATROL_RULES.firstTellMs) {
    mob.target = { ...target }; mob.readyAt = now + tellMs; mob.path = []; mob.nextPathAt = now;
    delete mob.state.windup; mob.state.phase = 'recovering';
  }
  private candidate(mob: MobActor, humans: readonly GoblinPatrolHuman[], npcs: readonly ForestNPC[], now: number, context: GoblinPatrolContext, humanOnly = false): Candidate | undefined {
    const candidates: Candidate[] = [
      ...humans.filter(p => this.active(p, now)).map(p => ({ target: humanTarget(p), point: p })),
      ...(humanOnly ? [] : npcs.filter(p => this.civilian(p, context)).map(p => ({ target: npcTarget(p), point: p }))),
    ];
    return candidates.filter(c => distance(c.point, mob.state) <= GOBLIN_PATROL_RULES.noticeRadius && distance(c.point, mob.definition.home) <= GOBLIN_PATROL_RULES.leashRadius && this.clear(mob.state, c.point) && !this.warded(c.point, humans, now) && !this.lit(c.point, humans, now, context))
      .sort((a, b) => distance(a.point, mob.state) - distance(b.point, mob.state) || a.target.id.localeCompare(b.target.id))[0];
  }
  private current(mob: MobActor, humans: readonly GoblinPatrolHuman[], npcs: readonly ForestNPC[], now: number, context: GoblinPatrolContext): Candidate | undefined {
    const target = mob.target; if (!target) return undefined;
    const human = target.kind === 'human' ? humans.find(p => p.id === target.id) : undefined;
    const npc = target.kind === 'npc' ? npcs.find(p => p.id === target.id) : undefined;
    const point = human && this.active(human, now) ? human : npc && this.civilian(npc, context) ? npc : undefined;
    if (!point || (point.lifeRevision ?? 0) !== target.lifeRevision || (human?.zoneRevision ?? 0) !== target.zoneRevision || distance(point, mob.definition.home) > GOBLIN_PATROL_RULES.leashRadius || distance(point, mob.state) > GOBLIN_PATROL_RULES.noticeRadius + 2 || !this.clear(mob.state, point) || this.warded(point, humans, now) || this.lit(point, humans, now, context)) return undefined;
    return { target, point };
  }
  private awayFromWard(mob: MobActor, humans: readonly GoblinPatrolHuman[], now: number): Point {
    const ward = humans.find(p => this.active(p, now) && (p.wardUntil ?? 0) > now && distance(p, mob.state) <= GOBLIN_PATROL_RULES.wardRadius && this.clear(p, mob.state));
    if (!ward) return mob.definition.home;
    const d = distance(ward, mob.state), dx = d ? (mob.state.x - ward.x) / d : 1, dy = d ? (mob.state.y - ward.y) / d : 0;
    for (const offset of [{ x: dx * 4.5, y: dy * 4.5 }, { x: -dy * 4.5, y: dx * 4.5 }, { x: dy * 4.5, y: -dx * 4.5 }]) {
      const point = { x: ward.x + offset.x, y: ward.y + offset.y };
      if (this.walkable(point) && distance(point, mob.definition.home) <= GOBLIN_PATROL_RULES.leashRadius && this.clear(mob.state, point)) return point;
    }
    return { x: mob.state.x, y: mob.state.y };
  }

  update(now: number, rawHumans: readonly GoblinPatrolHuman[], rawNpcs: readonly ForestNPC[], context: GoblinPatrolContext = {}): { damage: GoblinDamageIntent[]; snares: GoblinSnareIntent[] } {
    const damage: GoblinDamageIntent[] = [], snares: GoblinSnareIntent[] = [];
    this.lastPathQueries = 0;
    if (!this.validTime(now)) return { damage, snares };
    const dt = this.lastAt === null ? 0 : Math.min(GOBLIN_PATROL_RULES.maxTickMs, now - this.lastAt) / 1000;
    this.lastAt = now;
    const humans = [...new Map(rawHumans.slice(0, GOBLIN_PATROL_RULES.maxHumans).map(p => [p.id, p])).values()], npcs = rawNpcs.slice(0, GOBLIN_PATROL_RULES.maxNpcs);
    const needsPath: { mob: MobActor; goal: Point }[] = [];
    for (const mob of this.mobs) {
      const state = mob.state; state.moving = false;
      if (state.health <= 0) {
        if (now < (state.defeatedAt ?? now) + GOBLIN_PATROL_RULES.respawnMs) continue;
        Object.assign(state, mob.definition.home, { phase: 'idle', health: GOBLIN_PATROL_RULES.health, lifeRevision: state.lifeRevision + 1 });
        delete state.defeatedAt; delete state.hurtAt; mob.retreating = false; mob.readyAt = now + GOBLIN_PATROL_RULES.firstTellMs;
      }
      const areaActive = humans.some(p => this.active(p, now) && distance(p, mob.definition.home) <= GOBLIN_PATROL_RULES.areaRadius);
      const repelled = this.warded(state, humans, now) || this.lit(state, humans, now, context);
      // A real casualty is separate from losing LOS or a ward becoming active. Never teleport on retarget.
      if (mob.target?.kind === 'npc') {
        const prior = npcs.find(n => n.id === mob.target!.id);
        if (!this.alive(prior) || (prior.lifeRevision ?? 0) !== mob.target.lifeRevision) {
          mob.postCasualtyUntil = now + GOBLIN_PATROL_RULES.postCasualtyMs;
          mob.target = undefined; mob.path = []; delete state.windup;
          const nearby = areaActive && !repelled ? this.candidate(mob, humans, npcs, now, context, true) : undefined;
          if (nearby) this.setTarget(mob, nearby.target, now, GOBLIN_PATROL_RULES.retargetTellMs); else this.retreat(mob, now);
        }
      }
      if ((mob.postCasualtyUntil !== undefined && now >= mob.postCasualtyUntil) || repelled || (!areaActive && mob.target)) this.retreat(mob, now);
      if (mob.retreating && !repelled && distance(state, mob.definition.home) < .1 && now >= mob.restUntil) { mob.retreating = false; state.phase = 'idle'; mob.patrolIndex = 0; }
      let current = this.current(mob, humans, npcs, now, context);
      if (mob.target && !current) { this.retreat(mob, now); current = undefined; }
      if (!mob.retreating && areaActive && !mob.target && now >= mob.readyAt) {
        const next = this.candidate(mob, humans, npcs, now, context);
        if (next) { this.setTarget(mob, next.target, now); current = next; }
      }
      if (state.phase === 'windup') {
        if (now >= state.windup!.until) {
          const impact = state.windup!;
          if (now <= impact.until + GOBLIN_PATROL_RULES.impactGraceMs && current && distance(current.point, impact) <= impact.radius) damage.push({ id: `${this.sessionId}:${state.id}:${state.lifeRevision}:hit:${++mob.hitSerial}`, mobId: state.id,
            targetId: current.target.id, targetKind: current.target.kind, targetLifeRevision: current.target.lifeRevision, targetZoneRevision: current.target.zoneRevision,
            amount: GOBLIN_PATROL_RULES.damage, occurredAt: now });
          delete state.windup; state.phase = 'recovering'; mob.readyAt = now + GOBLIN_PATROL_RULES.recoveryMs;
        }
        continue;
      }
      if (current && now < mob.readyAt) continue;
      if (current && distance(state, current.point) <= GOBLIN_PATROL_RULES.attackRadius + .15) {
        state.phase = 'windup'; state.windup = { x: current.point.x, y: current.point.y, until: now + GOBLIN_PATROL_RULES.windupMs, radius: GOBLIN_PATROL_RULES.attackRadius }; mob.path = []; continue;
      }
      let goal: Point;
      if (mob.retreating) { state.phase = 'returning'; goal = this.awayFromWard(mob, humans, now); }
      else if (current) { state.phase = 'pursuing'; goal = current.point; }
      else {
        state.phase = 'idle'; goal = mob.definition.patrol[mob.patrolIndex % mob.definition.patrol.length]!;
        if (distance(state, goal) < .15) { mob.patrolIndex++; goal = mob.definition.patrol[mob.patrolIndex % mob.definition.patrol.length]!; }
      }
      if (distance(state, goal) < .05) { mob.path = []; continue; }
      if (now >= mob.nextPathAt) needsPath.push({ mob, goal: { ...goal } });
      const next = mob.path[0]; if (!next || !dt) continue;
      const d = distance(state, next); if (d < .02) { mob.path.shift(); continue; }
      const speed = current || mob.retreating ? GOBLIN_PATROL_RULES.chaseSpeed : GOBLIN_PATROL_RULES.patrolSpeed;
      const step = Math.min(d, speed * dt), point = { x: state.x + (next.x - state.x) / d * step, y: state.y + (next.y - state.y) / d * step };
      const enteringProtection = !repelled && (this.warded(point, humans, now) || this.lit(point, humans, now, context));
      if (!this.walkable(point) || !this.clear(state, point) || distance(point, mob.definition.home) > GOBLIN_PATROL_RULES.leashRadius || enteringProtection) { mob.path = []; continue; }
      state.facing = Math.abs(next.x - state.x) > Math.abs(next.y - state.y) ? next.x > state.x ? 'right' : 'left' : next.y > state.y ? 'down' : 'up';
      Object.assign(state, point); state.moving = true;
    }
    const budget = Number.isFinite(context.pathSearchBudget ?? 1) ? Math.max(0, Math.min(1, Math.floor(context.pathSearchBudget ?? 1))) : 0;
    if (budget && needsPath.length && now >= this.nextPathSearchAt) {
      const { mob, goal } = needsPath[this.pathCursor++ % needsPath.length]!;
      this.lastPathQueries++; this.nextPathSearchAt = now + GOBLIN_PATROL_RULES.pathBudgetWindowMs; mob.nextPathAt = now + GOBLIN_PATROL_RULES.pathRefreshMs;
      const path = findHomePath(mob.state, goal, this.world.map);
      mob.path = path && path.length <= GOBLIN_PATROL_RULES.maxPathPoints && path.every((p, i) => this.walkable(p) && distance(p, mob.definition.home) <= GOBLIN_PATROL_RULES.leashRadius && (!i || this.clear(path[i - 1]!, p))) ? path.slice(1) : [];
    }
    this.spiritStep(now, humans, npcs, context, snares);
    return { damage, snares };
  }

  private spiritStep(now: number, humans: GoblinPatrolHuman[], npcs: readonly ForestNPC[], context: GoblinPatrolContext, snares: GoblinSnareIntent[]) {
    const source = npcs.find(n => n.id === 'npc:spirit-morrow');
    if (!context.night || !this.alive(source) || this.warded(source, humans, now) || this.lit(source, humans, now, context)) { this.pulse = undefined; return; }
    if (this.pulse) {
      const pulse = this.pulse, target = humans.find(p => p.id === pulse.target.id);
      if (!target || !this.active(target, now) || (target.lifeRevision ?? 0) !== pulse.target.lifeRevision || (target.zoneRevision ?? 0) !== pulse.target.zoneRevision || (source.lifeRevision ?? 0) !== pulse.sourceLifeRevision || now > pulse.tell.until + GOBLIN_PATROL_RULES.impactGraceMs || distance(source, target) > GOBLIN_PATROL_RULES.spiritRadius || !this.clear(source, target) || distance(target, pulse.tell) > pulse.tell.radius || this.warded(target, humans, now) || this.lit(target, humans, now, context)) { this.pulse = undefined; return; }
      if (now >= pulse.tell.until) {
        snares.push({ id: `${pulse.tell.id}:snare`, sourceNpcId: source.id, targetId: target.id, targetLifeRevision: pulse.target.lifeRevision,
          targetZoneRevision: pulse.target.zoneRevision, until: now + GOBLIN_PATROL_RULES.snareMs, occurredAt: now }); this.pulse = undefined;
      }
      return;
    }
    if (now < this.pulseReadyAt) return;
    const target = humans.filter(p => this.active(p, now) && distance(p, source) <= GOBLIN_PATROL_RULES.spiritRadius && this.clear(source, p) && !this.warded(p, humans, now) && !this.lit(p, humans, now, context)).sort((a, b) => distance(a, source) - distance(b, source) || a.id.localeCompare(b.id))[0];
    if (!target) return;
    this.pulseReadyAt = now + GOBLIN_PATROL_RULES.pulseCooldownMs;
    this.pulse = { target: humanTarget(target), sourceLifeRevision: source.lifeRevision ?? 0,
      tell: { id: `${this.sessionId}:morrow:${++this.pulseSerial}`, x: target.x, y: target.y, radius: GOBLIN_PATROL_RULES.pulseRadius, until: now + GOBLIN_PATROL_RULES.pulseWindupMs } };
  }
}
