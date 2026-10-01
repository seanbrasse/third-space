import type { Point, WorldDefinition } from '@third-space/config';
import { distance, findHomePath, isHomeSegmentWalkable, isHomeWalkable } from '@third-space/simulation';
import type { ForestCombatEncounter, ForestMob, ForestMobKind, ForestMobSnapshot } from '../../../packages/contracts/src/forest-mobs';
import { SURVIVAL, type SurvivalActor, type SurvivalResult } from './survival-inventory';

export interface ForestCombatant extends SurvivalActor { health: number; armed: boolean }
export interface ForestEncounterDefinition {
  id: string; title: string;
  members: readonly { name: string; kind: ForestMobKind; home: Point }[];
}
export interface ForestDefeatReceipt {
  kind: 'encounter-defeated'; eventId: string; actorId: string; encounterId: string;
  defeatId: string; participantIds: string[]; occurredAt: number;
}
export interface ForestMobHit { id: string; mobId: string; targetId: string; amount: number; occurredAt: number }
export type ForestMobStrikeResult = { ok: true; defeated: boolean } | { ok: false; reason: string };
export type SpendKnifeSwing = (actor: SurvivalActor, target: Point, now: number) => SurvivalResult;

export const FOREST_COMBAT_RULES = Object.freeze({
  maxEncounters: 3, maxMobs: 5, maxParticipants: 8, scalePerExtraPlayer: .35,
  engageRadius: 7, leashRadius: 6, departureGraceMs: 5000, resetMs: 8000,
  initialTellMs: 1500, maxTickMs: 100, pathRefreshMs: 700, maxPathPoints: 64,
  raider: { health: 60, damage: 10, speed: 1.2, windupMs: 800, recoverMs: 1600, radius: 1.05 },
  guardian: { health: 150, damage: 18, speed: .8, windupMs: 1150, recoverMs: 1850, radius: 1.4 },
});

/** Hostile echo-bound raiders are distinct from Pip, Tulla, Nib and Brindle. */
export const KEEPER_COMBAT_ENCOUNTERS: readonly ForestEncounterDefinition[] = [
  { id: 'keeper-copperbutton-raiders', title: 'Copperbutton: the borrowed orders', members: [
    { name: 'Thornmask raider', kind: 'bramble-raider', home: { x: 76, y: 94 } },
    { name: 'Briarhook raider', kind: 'bramble-raider', home: { x: 76, y: 96 } },
  ] },
  { id: 'keeper-mossbutton-raiders', title: 'Mossbutton: the whispering seal', members: [
    { name: 'Mossmask raider', kind: 'bramble-raider', home: { x: 87, y: 84 } },
    { name: 'Cinderhook raider', kind: 'bramble-raider', home: { x: 87, y: 86 } },
  ] },
  { id: 'keeper-rootbound-guardian', title: 'Hollow Bough: unbind the keeper', members: [
    { name: 'Rootbound guardian', kind: 'rootbound-guardian', home: { x: 124, y: 96 } },
  ] },
];

interface MobActor { state: ForestMob; home: Point; path: Point[]; nextPathAt: number; readyAt: number; hitSerial: number }
interface Encounter {
  definition: ForestEncounterDefinition;
  state: ForestCombatEncounter;
  mobs: MobActor[];
  enabled: boolean;
  cleared: boolean;
  contributors: Set<string>;
  emptyAt: number | null;
}
const tuning = (mob: ForestMob) => mob.kind === 'rootbound-guardian' ? FOREST_COMBAT_RULES.guardian : FOREST_COMBAT_RULES.raider;
const copyMob = (state: ForestMob): ForestMob => ({ ...state, ...(state.windup ? { windup: { ...state.windup } } : {}) });

/** Room-owned opt-in encounters. Combat authority never depends on recipient rendering or NPC membership. */
export class ForestCombatEncounters {
  private encounters: Encounter[] = [];
  private pending = new Map<string, ForestDefeatReceipt>();
  private lastAt: number | null = null;
  private pathCursor = 0;
  private lastPathQueries = 0;

  constructor(private world: WorldDefinition, definitions: readonly ForestEncounterDefinition[] = KEEPER_COMBAT_ENCOUNTERS) {
    let total = 0;
    for (const definition of definitions.slice(0, FOREST_COMBAT_RULES.maxEncounters)) {
      if (this.encounters.some(e => e.definition.id === definition.id)) continue;
      const mobs: MobActor[] = [];
      for (const member of definition.members) {
        if (total >= FOREST_COMBAT_RULES.maxMobs) break;
        if (!this.walkable(member.home)) continue;
        const base = member.kind === 'rootbound-guardian' ? FOREST_COMBAT_RULES.guardian : FOREST_COMBAT_RULES.raider;
        mobs.push({ home: { ...member.home }, path: [], nextPathAt: 0, readyAt: 0, hitSerial: 0, state: {
          id: `mob:${definition.id}:${mobs.length}`, encounterId: definition.id, name: member.name, kind: member.kind,
          ...member.home, facing: 'down', health: base.health, maxHealth: base.health, lifeRevision: 0, phase: 'idle', moving: false,
        } });
        total++;
      }
      // A malformed encounter must not silently become easier or award credit for missing members.
      if (mobs.length !== definition.members.length || !mobs.length) continue;
      this.encounters.push({ definition, mobs, enabled: false, cleared: false, contributors: new Set(), emptyAt: null, state: { id: definition.id, title: definition.title, phase: 'idle', participantScale: 1 } });
    }
  }
  private safe(point: Point) { return !!this.world.fire && distance(point, this.world.fire) <= (this.world.stalker?.safeRadius ?? 9) + .5; }
  private walkable(point: Point) { return Number.isFinite(point.x) && Number.isFinite(point.y) && !this.safe(point) && isHomeWalkable(point, this.world.map); }
  private active(player: ForestCombatant, now: number) {
    return !player.id.startsWith('npc:') && !player.id.startsWith('mob:') && player.connected && player.mode === 'home' && !player.zone && !player.respawnAt && !player.seatId && (player.haloUntil ?? 0) <= now && player.health > 0 && this.walkable(player);
  }
  private nearEncounter(player: Point, encounter: Encounter) { return encounter.mobs.some(m => distance(player, m.home) <= FOREST_COMBAT_RULES.engageRadius); }

  /** Derive only from durable shared story state. Locked encounters expose no public actors. */
  syncStory(enabledIds: readonly string[], clearedIds: readonly string[]) {
    const enabled = new Set(enabledIds), cleared = new Set(clearedIds);
    for (const encounter of this.encounters) {
      encounter.enabled = enabled.has(encounter.state.id);
      if (cleared.has(encounter.state.id)) {
        encounter.cleared = true;
        this.pending.delete(`forest-encounter:${encounter.state.id}:clear:v1`);
      }
    }
  }
  snapshot(): ForestMobSnapshot {
    const visible = this.encounters.filter(e => e.enabled && !e.cleared);
    return { mobs: visible.flatMap(e => e.mobs.map(m => copyMob(m.state))), encounters: visible.map(e => ({ ...e.state })) };
  }
  diagnostics() { return { encounterCount: this.encounters.length, mobCount: this.encounters.reduce((n, e) => n + e.mobs.length, 0), lastPathQueries: this.lastPathQueries, pendingDefeats: this.pending.size }; }
  pendingDefeats(): ForestDefeatReceipt[] { return [...this.pending.values()].map(e => ({ ...e, participantIds: [...e.participantIds] })); }
  /** Call only after the story transaction confirms an accepted/already-applied durable receipt. */
  acknowledgeDefeat(eventId: string): boolean {
    const receipt = this.pending.get(eventId); if (!receipt) return false;
    const encounter = this.encounters.find(e => e.state.id === receipt.encounterId)!;
    encounter.cleared = true; this.pending.delete(eventId); return true;
  }

  /** Only for an uncommitted receipt whose contributors have all lost home access. No reward is granted. */
  discardDefeatAndReset(eventId: string): boolean {
    const receipt = this.pending.get(eventId); if (!receipt) return false;
    const encounter = this.encounters.find(e => e.state.id === receipt.encounterId);
    if (!encounter || encounter.cleared) return false;
    this.pending.delete(eventId); this.resetEncounter(encounter, this.lastAt ?? 0); return true;
  }
  private resetEncounter(encounter: Encounter, now: number) {
    encounter.state.phase = 'idle'; encounter.state.participantScale = 1; delete encounter.state.resetAt;
    encounter.contributors.clear(); encounter.emptyAt = null;
    for (const mob of encounter.mobs) {
      Object.assign(mob.state, mob.home, { phase: 'idle', health: tuning(mob.state).health, maxHealth: tuning(mob.state).health, lifeRevision: mob.state.lifeRevision + 1, moving: false });
      delete mob.state.windup; delete mob.state.hurtAt; delete mob.state.defeatedAt;
      mob.path = []; mob.nextPathAt = now; mob.readyAt = now;
    }
  }

  strike(actor: ForestCombatant, mobId: string, targetLifeRevision: number, now: number, humans: readonly ForestCombatant[], spendSwing: SpendKnifeSwing, damage:number=SURVIVAL.attackDamage): ForestMobStrikeResult {
    const encounter = this.encounters.find(e => e.mobs.some(m => m.state.id === mobId));
    const mob = encounter?.mobs.find(m => m.state.id === mobId);
    if (!Number.isFinite(now) || !Number.isFinite(damage) || damage<=0 || damage>100 || !encounter || !mob || !encounter.enabled || encounter.cleared || encounter.state.phase === 'resetting' || encounter.state.phase === 'defeated' || mob.state.health <= 0 || targetLifeRevision !== mob.state.lifeRevision)
      return { ok: false, reason: 'That threat is no longer available' };
    if (!actor.armed || !this.active(actor, now)) return { ok: false, reason: 'Equip your knife outside the safe areas' };
    if (distance(actor, mob.state) > SURVIVAL.attackRange || !isHomeSegmentWalkable(actor, mob.state, this.world.map)) return { ok: false, reason: 'Out of reach' };
    const swing = spendSwing(actor, mob.state, now); if (!swing.ok) return swing;
    if (encounter.state.phase === 'idle') {
      const peers = new Set(humans.filter(p => p.armed && this.active(p, now) && this.nearEncounter(p, encounter)).map(p => p.id));
      peers.add(actor.id);
      const scale = Math.max(1, Math.min(FOREST_COMBAT_RULES.maxParticipants, peers.size));
      encounter.state.phase = 'active'; encounter.state.participantScale = scale;
      for (const member of encounter.mobs) {
        const base = tuning(member.state);
        member.state.health = member.state.maxHealth = Math.ceil(base.health * (1 + (scale - 1) * FOREST_COMBAT_RULES.scalePerExtraPlayer));
        member.state.phase = 'recovering'; member.readyAt = now + FOREST_COMBAT_RULES.initialTellMs;
      }
    }
    encounter.contributors.add(actor.id); encounter.emptyAt = null;
    mob.state.health = Math.max(0, mob.state.health - damage); mob.state.hurtAt = now;
    if (mob.state.health === 0) {
      mob.state.phase = 'defeated'; mob.state.moving = false; mob.state.defeatedAt = now; delete mob.state.windup; mob.path = [];
      if (encounter.mobs.every(m => m.state.health === 0)) {
        encounter.state.phase = 'defeated';
        const eventId = `forest-encounter:${encounter.state.id}:clear:v1`;
        if (!this.pending.has(eventId)) this.pending.set(eventId, { kind: 'encounter-defeated', eventId, actorId: actor.id, encounterId: encounter.state.id, defeatId: 'clear-v1', participantIds: [actor.id, ...[...encounter.contributors].filter(id => id !== actor.id).sort()].slice(0, 8).sort(), occurredAt: now });
      }
    }
    return { ok: true, defeated: encounter.state.phase === 'defeated' };
  }

  update(now: number, humans: readonly ForestCombatant[]): ForestMobHit[] {
    if (!Number.isFinite(now) || (this.lastAt !== null && now < this.lastAt)) return [];
    const dt = this.lastAt === null ? 0 : Math.min(FOREST_COMBAT_RULES.maxTickMs, now - this.lastAt) / 1000;
    this.lastAt = now; this.lastPathQueries = 0;
    const hits: ForestMobHit[] = [];
    const needsPath: { mob: MobActor; goal: Point }[] = [];
    for (const encounter of this.encounters) {
      if (!encounter.enabled || encounter.cleared || encounter.state.phase === 'idle' || encounter.state.phase === 'defeated') continue;
      const eligible = humans.filter(p => encounter.contributors.has(p.id) && this.active(p, now) && this.nearEncounter(p, encounter));
      if (encounter.state.phase === 'active') {
        if (!eligible.length) {
          encounter.emptyAt ??= now;
          if (now - encounter.emptyAt >= FOREST_COMBAT_RULES.departureGraceMs) {
            encounter.state.phase = 'resetting'; encounter.state.resetAt = now + FOREST_COMBAT_RULES.resetMs;
            for (const mob of encounter.mobs) { delete mob.state.windup; mob.path = []; if (mob.state.health > 0) mob.state.phase = 'returning'; }
          }
        } else encounter.emptyAt = null;
      }
      if (encounter.state.phase === 'resetting' && now >= encounter.state.resetAt!) {
        this.resetEncounter(encounter, now);
        continue;
      }
      for (const mob of encounter.mobs) {
        const state = mob.state, rules = tuning(state); state.moving = false;
        if (state.health <= 0) continue;
        if (state.phase === 'windup') {
          if (now >= state.windup!.until) {
            const impact = state.windup!;
            // The strike lands at its original telegraphed point. It cannot track a dodging player.
            for (const player of eligible) if (distance(player, impact) <= impact.radius && isHomeSegmentWalkable(state, player, this.world.map)) {
              hits.push({ id: `${state.id}:${state.lifeRevision}:hit:${++mob.hitSerial}:${player.id}`, mobId: state.id, targetId: player.id, amount: rules.damage, occurredAt: now });
            }
            delete state.windup; state.phase = 'recovering'; mob.readyAt = now + rules.recoverMs;
          }
          continue;
        }
        if (now < mob.readyAt) continue;
        const target = eligible.filter(p => distance(p, mob.home) <= FOREST_COMBAT_RULES.leashRadius).sort((a, b) => distance(a, state) - distance(b, state) || a.id.localeCompare(b.id))[0];
        const returning = encounter.state.phase === 'resetting' || !target;
        const goal = returning ? mob.home : target;
        if (!returning && distance(state, target!) <= rules.radius + .2 && isHomeSegmentWalkable(state, target!, this.world.map)) {
          state.phase = 'windup'; state.windup = { x: target!.x, y: target!.y, until: now + rules.windupMs, radius: rules.radius }; mob.path = []; continue;
        }
        state.phase = returning ? 'returning' : 'pursuing';
        if (distance(state, goal) < .05) { mob.path = []; continue; }
        if (now >= mob.nextPathAt) needsPath.push({ mob, goal: { x: goal.x, y: goal.y } });
        const next = mob.path[0]; if (!next || !dt) continue;
        const d = distance(state, next); if (d < .02) { mob.path.shift(); continue; }
        const step = Math.min(d, rules.speed * dt), point = { x: state.x + (next.x - state.x) / d * step, y: state.y + (next.y - state.y) / d * step };
        if (!this.walkable(point) || distance(point, mob.home) > FOREST_COMBAT_RULES.leashRadius || !isHomeSegmentWalkable(state, point, this.world.map)) { mob.path = []; continue; }
        state.facing = Math.abs(next.x - state.x) > Math.abs(next.y - state.y) ? (next.x > state.x ? 'right' : 'left') : (next.y > state.y ? 'down' : 'up');
        Object.assign(state, point); state.moving = true;
      }
    }
    // One route refresh for all five enemies per tick. The room's NPC budget remains independent.
    if (needsPath.length) {
      const { mob, goal } = needsPath[this.pathCursor++ % needsPath.length]!;
      mob.nextPathAt = now + FOREST_COMBAT_RULES.pathRefreshMs; this.lastPathQueries++;
      const path = findHomePath(mob.state, goal, this.world.map);
      mob.path = path && path.length <= FOREST_COMBAT_RULES.maxPathPoints && path.every(p => this.walkable(p) && distance(p, mob.home) <= FOREST_COMBAT_RULES.leashRadius) ? path.slice(1) : [];
    }
    return hits;
  }
}
