import type { Point, WorldDefinition } from '@third-space/config';
import { DEFAULT_AVATAR, type AvatarConfig, type PlayerState } from '@third-space/contracts';
import type { ForestNPC, ForestNPCArt } from '../../../packages/contracts/src/forest-npc';
import { createPlayer, distance, findHomePath, isHomeSegmentWalkable, isHomeWalkable } from '@third-space/simulation';

export const NPC_RULES = Object.freeze({
  count: 3, maxActors: 28, speed: 1.05, interactionRange: 2.5,
  dialogueMs: 6000, interactionCooldownMs: 6500, respawnMs: 30000,
  maxTickMs: 100, wanderDelayMs: 1800, maxPathSearchesPerTick: 1,
  maxPathPoints: 128, maxPatrolPoints: 12, wanderRadius: 10, maxHealth: 100,
});

/** Static authoring data stays separate from per-room snapshot state. */
export interface ForestNPCDefinition {
  id: string;
  name: string;
  role: string;
  art?: ForestNPCArt;
  home?: Point;
  avatar?: Partial<AvatarConfig>;
  lines: readonly string[];
  patrol?: readonly Point[];
  nightPatrol?: readonly Point[];
  duskPatrol?: readonly Point[];
  active?: 'day' | 'night' | 'always';
  activity?: 'wandering' | 'patrolling' | 'working';
  questHook?: string;
  speed?: number;
  maxHealth?: number;
}
export interface ForestNPCRoutineContext { night?: boolean; phase?: 'dawn' | 'day' | 'dusk' | 'night' }
interface Actor {
  state: ForestNPC;
  definition: ForestNPCDefinition;
  home: Point;
  path: Point[];
  patrol: Point[];
  nightPatrol: Point[];
  duskPatrol: Point[];
  patrolIndex: number;
  nextWander: number;
  line: number;
  schedule: 'day' | 'dusk' | 'night';
}

export const DEFAULT_FOREST_NPCS: readonly ForestNPCDefinition[] = [
  { id: 'npc:forest:0', name: 'Moss', role: 'Trail counter', avatar: { hair: 'curly', outfit: 'overalls', clothingColor: '#9b7046', hairColor: '#b79b72', skinColor: '#c89a74' }, lines: ['Ada taught me every trail. Now one keeps bringing me back to the same tree.', 'Wren heard my voice beyond the lanterns. I was with Fern all evening.', 'If you find Ada, tell her I finally counted the orchard trees. Twice.'] },
  { id: 'npc:forest:1', name: 'Wren', role: 'Keeper’s messenger', avatar: { hair: 'long', outfit: 'jacket', clothingColor: '#657f97', hairColor: '#302b3b', skinColor: '#b67955' }, lines: ['Moss says the paths are moving. Orin says paths cannot move. I trust Moss.', 'The goblins took brass wards, but someone else taught them which ones mattered.', 'Fern’s lantern went dark before the crickets stopped. Tell Orin that part.'] },
  { id: 'npc:forest:2', name: 'Fern', role: 'Lantern mender', avatar: { hair: 'short', outfit: 'tee', clothingColor: '#ad728c', hairColor: '#a3593d', skinColor: '#efc8a2' }, lines: ['I mend lanterns. Ada mended arguments. We are rather short of one of those.', 'Wren brings news, Moss brings worries, and I bring spare wicks.', 'A borrowed face cannot remember a kindness it never received. Ada told me that.'] },
];

export function npcSegmentOutsideFire(a: Point, b: Point, world: WorldDefinition) {
  if (!world.fire) return true;
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((world.fire.x - a.x) * dx + (world.fire.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return distance({ x: a.x + dx * t, y: a.y + dy * t }, world.fire) > (world.stalker?.safeRadius ?? 9) + .5;
}
function cloneState(state: ForestNPC): ForestNPC {
  return { ...state, avatar: { ...state.avatar }, ...(state.dialogue ? { dialogue: { ...state.dialogue } } : {}) };
}

/** No sockets, timers, room slots or independent loops. Tick every actor, even when no client renders it. */
export class ForestNPCController {
  private actors: Actor[] = [];
  private lastAt: number | null = null;
  private serial = 0;
  private pathCursor = 0;
  private cooldowns = new Map<string, number>();
  private fallback: Point[] = [];
  private lastPathSearches = 0;

  constructor(private world: WorldDefinition, private random: () => number = Math.random, definitions: readonly ForestNPCDefinition[] = DEFAULT_FOREST_NPCS) {
    // Constructor-only, bounded fallback for the original three wanderers and misplaced authored anchors.
    let checks = 0;
    for (let y = 8; y < world.map.height - 3 && checks < 2048; y += 4) {
      for (let x = 8; x < world.map.width - 3 && checks++ < 2048; x += 4) {
        const point = { x, y };
        if (this.walkable(point)) this.fallback.push(point);
      }
    }
    const ids = new Set<string>();
    for (const definition of definitions.slice(0, NPC_RULES.maxActors)) {
      if (!definition.id.startsWith('npc:') || ids.has(definition.id) || !definition.lines.length) continue;
      const fallback = this.fallback[Math.floor((this.actors.length + 1) * this.fallback.length / (Math.min(definitions.length, NPC_RULES.maxActors) + 1))];
      const home = this.spawnPoint(definition.home ?? fallback);
      if (!home) continue;
      ids.add(definition.id);
      const avatar = { ...DEFAULT_AVATAR, ...definition.avatar };
      avatar.color = avatar.skinColor;
      const maxHealth = Math.max(1, Math.min(500, Math.round(definition.maxHealth ?? NPC_RULES.maxHealth)));
      const patrol = this.validPatrol(definition.patrol ?? []);
      const nightPatrol = this.validPatrol(definition.nightPatrol ?? []);
      const duskPatrol = this.validPatrol(definition.duskPatrol ?? definition.patrol ?? []);
      this.actors.push({ definition, home, path: [], patrol, nightPatrol, duskPatrol, patrolIndex: 0, nextWander: this.actors.length * 100, line: 0, schedule: 'day',
        state: { id: definition.id, name: definition.name, role: definition.role, art: definition.art ?? 'villager', avatar, ...home, facing: 'down', phase: 'wander', activity: definition.activity ?? 'wandering', moving: false, health: maxHealth, maxHealth, ...(definition.questHook ? { questHook: definition.questHook } : {}) },
      });
    }
  }

  private walkable(point: Point) { return Number.isFinite(point.x) && Number.isFinite(point.y) && isHomeWalkable(point, this.world.map) && npcSegmentOutsideFire(point, point, this.world); }
  private validPatrol(points: readonly Point[]) { return points.slice(0, NPC_RULES.maxPatrolPoints).filter(p => this.walkable(p)).map(p => ({ ...p })); }
  private spawnPoint(preferred: Point | undefined): Point | undefined {
    if (!preferred) return undefined;
    if (this.walkable(preferred)) return { ...preferred };
    for (let radius = 1; radius <= 4; radius++) {
      for (const offset of [{ x: radius, y: 0 }, { x: 0, y: radius }, { x: -radius, y: 0 }, { x: 0, y: -radius }]) {
        const point = { x: preferred.x + offset.x, y: preferred.y + offset.y };
        if (this.walkable(point)) return point;
      }
    }
    return undefined;
  }
  snapshot(): ForestNPC[] { return this.actors.map(a => cloneState(a.state)); }
  get(id: string): ForestNPC | undefined { const state = this.actors.find(a => a.state.id === id)?.state; return state ? cloneState(state) : undefined; }
  diagnostics() { return { actors: this.actors.length, lastPathSearches: this.lastPathSearches, pathPoints: this.actors.reduce((sum, a) => sum + a.path.length, 0), cooldowns: this.cooldowns.size }; }

  update(now: number, context: ForestNPCRoutineContext = {}) {
    if (!Number.isFinite(now) || (this.lastAt !== null && now < this.lastAt)) return;
    const dt = this.lastAt === null ? 0 : Math.min(NPC_RULES.maxTickMs, now - this.lastAt) / 1000;
    this.lastAt = now;
    this.lastPathSearches = 0;
    for (const [key, until] of this.cooldowns) if (until <= now) this.cooldowns.delete(key);
    for (const actor of this.actors) {
      const state = actor.state;
      state.moving = false;
      if (state.phase === 'respawning') {
        if (now < (state.respawnAt ?? Infinity)) continue;
        Object.assign(state, actor.home, { phase: 'wander', health: state.maxHealth });
        delete state.respawnAt;
        actor.nextWander = now + NPC_RULES.wanderDelayMs;
      }
      if (state.dialogue && now >= state.dialogue.until) { delete state.dialogue; state.phase = 'wander'; }
      if (state.phase === 'talking') continue;
      const schedule = context.phase === 'night' || context.night ? 'night' : context.phase === 'dusk' ? 'dusk' : 'day';
      if (actor.schedule !== schedule) { actor.schedule = schedule; actor.path = []; actor.patrolIndex = 0; actor.nextWander = now; }
      const inactive = this.inactive(actor);
      state.activity = inactive ? 'resting' : actor.definition.activity ?? (actor.patrol.length ? 'patrolling' : 'wandering');
      const goal = actor.path[0];
      if (!goal || !dt) continue;
      const d = distance(state, goal);
      if (d < .02) { actor.path.shift(); if (!actor.path.length) actor.nextWander = now + NPC_RULES.wanderDelayMs; continue; }
      const speed = Math.max(.3, Math.min(2, actor.definition.speed ?? NPC_RULES.speed));
      const step = Math.min(d, speed * dt);
      const next = { x: state.x + (goal.x - state.x) / d * step, y: state.y + (goal.y - state.y) / d * step };
      if (!isHomeSegmentWalkable(state, next, this.world.map) || !npcSegmentOutsideFire(state, next, this.world)) { actor.path = []; continue; }
      state.facing = Math.abs(goal.x - state.x) > Math.abs(goal.y - state.y) ? (goal.x > state.x ? 'right' : 'left') : (goal.y > state.y ? 'down' : 'up');
      Object.assign(state, next);
      state.moving = true;
    }
    // Round-robin budget: twenty-eight far-apart actors cannot all ask A* for a path on one tick.
    for (let visited = 0; visited < this.actors.length && this.lastPathSearches < NPC_RULES.maxPathSearchesPerTick; visited++) {
      const actor = this.actors[this.pathCursor++ % this.actors.length]!;
      if (actor.state.phase !== 'wander' || actor.path.length || now < actor.nextWander) continue;
      actor.nextWander = now + NPC_RULES.wanderDelayMs;
      const route = actor.schedule === 'night' ? actor.nightPatrol : actor.schedule === 'dusk' ? actor.duskPatrol : actor.patrol;
      let goal: Point | undefined;
      if (this.inactive(actor)) goal = actor.home;
      else if (route.length) goal = route[actor.patrolIndex++ % route.length];
      else {
        const nearby = this.fallback.filter(p => distance(p, actor.home) <= NPC_RULES.wanderRadius && distance(p, actor.state) > .5);
        goal = nearby[Math.min(nearby.length - 1, Math.floor(Math.max(0, Math.min(.999999, this.random())) * nearby.length))];
      }
      if (!goal || distance(actor.state, goal) < .02) continue;
      this.lastPathSearches++;
      const path = findHomePath(actor.state, goal, this.world.map);
      if (path && path.length <= NPC_RULES.maxPathPoints && path.every((p, i) => i === 0 || npcSegmentOutsideFire(path[i - 1]!, p, this.world))) actor.path = path.slice(1);
    }
  }

  private inactive(actor: Actor) {
    return (actor.definition.active === 'night' && actor.schedule !== 'night') || (actor.definition.active === 'day' && actor.schedule === 'night') || (actor.schedule === 'night' && !actor.nightPatrol.length);
  }

  interact(id: string, player: PlayerState, now: number): boolean {
    const actor = this.actors.find(a => a.state.id === id);
    if (!actor || !Number.isFinite(now) || player.id.startsWith('npc:') || !player.connected || player.zone || player.mode !== 'home' || player.respawnAt || actor.state.phase === 'respawning' || distance(player, actor.state) > NPC_RULES.interactionRange || !isHomeSegmentWalkable(player, actor.state, this.world.map) || (this.cooldowns.get(id) ?? 0) > now) return false;
    this.cooldowns.set(id, now + NPC_RULES.interactionCooldownMs);
    const lines = actor.definition.lines;
    actor.state.dialogue = { id: `${id}:line:${++this.serial}`, text: lines[actor.line++ % lines.length]!.slice(0, 200), until: now + NPC_RULES.dialogueMs };
    actor.state.phase = 'talking';
    actor.state.activity = 'talking';
    actor.state.moving = false;
    return true;
  }

  damage(id: string, amount: number, now: number): 'ignored' | 'hurt' | 'caught' {
    const actor = this.actors.find(a => a.state.id === id);
    if (!actor || !Number.isFinite(amount) || amount <= 0 || !Number.isFinite(now) || actor.state.phase === 'respawning') return 'ignored';
    actor.state.health = Math.max(0, actor.state.health - Math.min(500, amount));
    if (actor.state.health > 0) return 'hurt';
    actor.state.phase = 'respawning';
    actor.state.activity = 'recovering';
    actor.state.moving = false;
    actor.state.respawnAt = now + NPC_RULES.respawnMs;
    delete actor.state.dialogue;
    actor.path = [];
    return 'caught';
  }
  catch(id: string, now: number): boolean { return this.damage(id, 500, now) === 'caught'; }

  /** Visual prey adapters never enter room membership, idle tracking, inventory or voice presence. */
  prey(): (PlayerState & { npcArt: ForestNPCArt })[] { return this.actors.filter(a => a.state.phase !== 'respawning').map(({ state }) => ({ ...createPlayer(state.id, state.name, state.avatar), x: state.x, y: state.y, facing: state.facing, npcArt: state.art, flashlightOn: false, connected: true })); }
}
