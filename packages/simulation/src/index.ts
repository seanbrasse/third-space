import {
  GAME_CONFIG,
  HOME_MAP,
  RACE_MAP,
  type Point,
  type Rect,
  type Furniture,
} from "@third-space/config";
import {
  DEFAULT_AVATAR,
  type AvatarConfig,
  type PlayerInput,
  type PlayerState,
  type VoiceMode,
} from "@third-space/contracts";
import { clearRaceBoosts, stepRaceBoosts, raceSpeedMultiplier, raceJumpMultiplier } from './race-boosts';
export { clearRaceBoosts, stepRaceBoosts, raceSpeedMultiplier, raceJumpMultiplier } from './race-boosts';
import { stepSprint } from "./sprint";
import { potionMultipliers } from './living-world-rules';
export { SPRINT, requestSprint, cancelSprint, sprintStatus, sprintMultiplier, stepSprint, canSprint } from "./sprint";

export { GAME_CONFIG, HOME_MAP, RACE_MAP } from "@third-space/config";
export type { Point, Rect } from "@third-space/config";

const RADIUS = GAME_CONFIG.playerRadius;
const EPSILON = 1e-9;
const MAX_STEP = 1 / 120;

export function createPlayer(
  id: string,
  name: string,
  avatar: AvatarConfig = DEFAULT_AVATAR,
): PlayerState {
  return {
    id,
    name,
    avatar: { ...avatar },
    ...HOME_MAP.spawn,
    vx: 0,
    vy: 0,
    facing: "down",
    mode: "home",
    nativeMode: "off",
    manualMute: false,
    deafened: false,
    connected: true,
    lastInputSeq: -1,
    checkpoint: 0,
    flashlightBattery: 1,
    flashlightOn: false,
  };
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
export function intersects(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width - EPSILON &&
    a.x + a.width > b.x + EPSILON &&
    a.y < b.y + b.height - EPSILON &&
    a.y + a.height > b.y + EPSILON
  );
}
export function playerRect(player: Point): Rect {
  return {
    x: player.x - RADIUS,
    y: player.y - RADIUS,
    width: 2 * RADIUS,
    height: 2 * RADIUS,
  };
}
export function overlapsPlayer(player: Point, rect: Rect): boolean {
  return intersects(playerRect(player), rect);
}
export function distanceToRect(point: Point, rect: Rect): number {
  return Math.hypot(
    Math.max(rect.x - point.x, 0, point.x - rect.x - rect.width),
    Math.max(rect.y - point.y, 0, point.y - rect.y - rect.height),
  );
}
export function canInteract(player: Point, rect: Rect): boolean {
  return distanceToRect(player, rect) <= GAME_CONFIG.interactionDistance;
}
export function canUseFurniture(player: Point, furniture: Furniture): boolean {
  return furniture.usePoints.some((point) => distance(player, point) <= GAME_CONFIG.interactionDistance);
}

export interface NavigationMap {
  width: number;
  height: number;
  solids: readonly Rect[];
}
/** Bounded caches/work per immutable world; mutable fixture maps remain uncached. */
export const NAVIGATION_LIMITS = Object.freeze({
  cellSize: 4,
  maxIndexedSolids: 16_384,
  maxIndexEntries: 65_536,
  maxCachedNodes: 32_768,
  maxSearchNodes: 65_536,
  maxExpandedNodes: 65_536,
  maxSmoothChecks: 2_048,
});
type SolidIndex = {
  buckets: Map<string, number[]>;
  overflow: number[];
  solids: readonly Rect[];
  seen: Uint32Array;
  stamp: number;
};
type NavigationCache = {
  solids: readonly Rect[];
  width: number;
  height: number;
  index: SolidIndex | null;
  nodes: Map<number, Point | null>;
};
const navigationCaches = new WeakMap<NavigationMap, NavigationCache>();
const cellKey = (x: number, y: number) => `${x}:${y}`;
function buildSolidIndex(solids: readonly Rect[]): SolidIndex | null {
  if (solids.length > NAVIGATION_LIMITS.maxIndexedSolids) return null;
  const index: SolidIndex = { buckets: new Map(), overflow: [], solids, seen: new Uint32Array(solids.length), stamp: 0 };
  let entries = 0;
  for (let id = 0; id < solids.length; id++) {
    const solid = solids[id]!;
    const minX = Math.floor(solid.x / NAVIGATION_LIMITS.cellSize), maxX = Math.floor((solid.x + solid.width) / NAVIGATION_LIMITS.cellSize);
    const minY = Math.floor(solid.y / NAVIGATION_LIMITS.cellSize), maxY = Math.floor((solid.y + solid.height) / NAVIGATION_LIMITS.cellSize);
    const count = (maxX - minX + 1) * (maxY - minY + 1);
    // Very long walls and malformed rectangles stay in a small always-tested
    // list. Index construction never loops over unbounded rectangle extents.
    if (![minX, maxX, minY, maxY].every(Number.isSafeInteger) || maxX < minX || maxY < minY || !Number.isSafeInteger(count) || count < 1 || count > 256 || entries + count > NAVIGATION_LIMITS.maxIndexEntries) {
      index.overflow.push(id); continue;
    }
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const key = cellKey(x, y), bucket = index.buckets.get(key);
      if (bucket) bucket.push(id); else index.buckets.set(key, [id]);
    }
    entries += count;
  }
  return index;
}
function navigationCache(map: NavigationMap): NavigationCache | null {
  const previous = navigationCaches.get(map);
  if (previous && previous.solids === map.solids && previous.width === map.width && previous.height === map.height) return previous;
  // A readonly TypeScript type is not runtime immutability. In-place same-length
  // edits are legal in fixture/editor maps, so never cache those geometries.
  if (!Object.isFrozen(map.solids) || !map.solids.every(Object.isFrozen)) {
    if (previous) navigationCaches.delete(map);
    return null;
  }
  const cache = { solids: map.solids, width: map.width, height: map.height, index: buildSolidIndex(map.solids), nodes: new Map<number, Point | null>() };
  navigationCaches.set(map, cache); return cache;
}
/** True if any candidate satisfies the exact collision predicate. */
function someSolid(solids: readonly Rect[], index: SolidIndex | null, minX: number, minY: number, maxX: number, maxY: number, test: (solid: Rect) => boolean): boolean {
  if (!index) return solids.some(test);
  const left = Math.floor(minX / NAVIGATION_LIMITS.cellSize), right = Math.floor(maxX / NAVIGATION_LIMITS.cellSize);
  const top = Math.floor(minY / NAVIGATION_LIMITS.cellSize), bottom = Math.floor(maxY / NAVIGATION_LIMITS.cellSize);
  // Wide diagonal LOS queries can cross a mostly-empty enormous bounding box.
  // A full scan then costs less and retains exact semantics.
  const cells = (right - left + 1) * (bottom - top + 1);
  if (![left, right, top, bottom].every(Number.isSafeInteger) || !Number.isSafeInteger(cells) || cells > Math.max(16, index.buckets.size)) return index.solids.some(test);
  index.stamp = (index.stamp + 1) >>> 0;
  if (index.stamp === 0) { index.seen.fill(0); index.stamp = 1; }
  for (const id of index.overflow) { index.seen[id] = index.stamp; if (test(index.solids[id]!)) return true; }
  for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
    const bucket = index.buckets.get(cellKey(x, y));
    if (!bucket) continue;
    for (const id of bucket) {
      if (index.seen[id] === index.stamp) continue;
      index.seen[id] = index.stamp;
      if (test(index.solids[id]!)) return true;
    }
  }
  return false;
}
function walkable(point: Point, map: NavigationMap, index: SolidIndex | null): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y) &&
    point.x >= RADIUS && point.y >= RADIUS &&
    point.x <= map.width - RADIUS && point.y <= map.height - RADIUS &&
    !someSolid(map.solids, index, point.x - RADIUS, point.y - RADIUS, point.x + RADIUS, point.y + RADIUS, solid => overlapsPlayer(point, solid));
}
export function isHomeWalkable(point: Point, map: NavigationMap = HOME_MAP): boolean {
  return walkable(point, map, navigationCache(map)?.index ?? null);
}
function segmentHitsSolid(from: Point, to: Point, solid: Rect): boolean {
  let enter = 0, exit = 1;
  for (const axis of ["x", "y"] as const) {
    const size = axis === "x" ? "width" : "height";
    const low = solid[axis] - RADIUS + EPSILON;
    const high = solid[axis] + solid[size] + RADIUS - EPSILON;
    const delta = to[axis] - from[axis];
    if (Math.abs(delta) < EPSILON) {
      if (from[axis] <= low || from[axis] >= high) return false;
    } else {
      const a = (low - from[axis]) / delta, b = (high - from[axis]) / delta;
      enter = Math.max(enter, Math.min(a, b)); exit = Math.min(exit, Math.max(a, b));
    }
  }
  return enter <= exit && enter <= 1 && exit >= 0;
}
function segmentWalkable(from: Point, to: Point, map: NavigationMap, index: SolidIndex | null): boolean {
  if (!walkable(from, map, index) || !walkable(to, map, index)) return false;
  return !someSolid(map.solids, index, Math.min(from.x, to.x) - RADIUS, Math.min(from.y, to.y) - RADIUS,
    Math.max(from.x, to.x) + RADIUS, Math.max(from.y, to.y) + RADIUS, solid => segmentHitsSolid(from, to, solid));
}
/** Swept avatar footprint against expanded rectangles; no diagonal corner cutting. */
export function isHomeSegmentWalkable(from: Point, to: Point, map: NavigationMap = HOME_MAP): boolean {
  return segmentWalkable(from, to, map, navigationCache(map)?.index ?? null);
}
type SearchNode = { cost: number; parent?: number; closed: boolean; heapIndex: number; score: number; heuristic: number };
/** Indexed binary heap: one entry per discovered node, no stale duplicate queue. */
class NavigationHeap {
  private ids: number[] = [];
  constructor(private records: Map<number, SearchNode>) {}
  get size() { return this.ids.length; }
  private before(a: number, b: number) {
    const x = this.records.get(a)!, y = this.records.get(b)!;
    return x.score < y.score || x.score === y.score && (x.heuristic < y.heuristic || x.heuristic === y.heuristic && a < b);
  }
  update(id: number) {
    const record = this.records.get(id)!;
    let at = record.heapIndex;
    if (at < 0) { at = this.ids.length; this.ids.push(id); }
    while (at > 0) {
      const parent = (at - 1) >>> 1, parentId = this.ids[parent]!;
      if (!this.before(id, parentId)) break;
      this.ids[at] = parentId; this.records.get(parentId)!.heapIndex = at; at = parent;
    }
    this.ids[at] = id; record.heapIndex = at;
  }
  pop(): number | undefined {
    if (!this.ids.length) return undefined;
    const first = this.ids[0]!, last = this.ids.pop()!;
    this.records.get(first)!.heapIndex = -1;
    if (this.ids.length) {
      let at = 0;
      while (at * 2 + 1 < this.ids.length) {
        let child = at * 2 + 1;
        if (child + 1 < this.ids.length && this.before(this.ids[child + 1]!, this.ids[child]!)) child++;
        if (!this.before(this.ids[child]!, last)) break;
        this.ids[at] = this.ids[child]!; this.records.get(this.ids[at]!)!.heapIndex = at; at = child;
      }
      this.ids[at] = last; this.records.get(last)!.heapIndex = at;
    }
    return first;
  }
}

/** Sparse bounded half-tile A*. Includes exact endpoints and only smooths safe
 * swept segments. Map area alone never rejects a route; work/memory are bounded. */
export function findHomePath(start: Point, goal: Point, map: NavigationMap = HOME_MAP): Point[] | null {
  const cache = navigationCache(map);
  // Mutable maps get an index only for this synchronous search; there is no
  // retained walkability after a caller edits/replaces any rectangle.
  const index = cache?.index ?? buildSolidIndex(map.solids);
  if (!walkable(start, map, index) || !walkable(goal, map, index)) return null;
  if (segmentWalkable(start, goal, map, index)) return distance(start, goal) < EPSILON ? [{...start}] : [{...start}, {...goal}];
  const columns = Math.floor(map.width * 2) + 1, rows = Math.floor(map.height * 2) + 1;
  if (!Number.isSafeInteger(columns * rows) || columns < 1 || rows < 1) return null;
  const nodes = cache?.nodes ?? new Map<number, Point | null>();
  const node = (id: number): Point | null => {
    if (nodes.has(id)) return nodes.get(id)!;
    const point = { x: (id % columns) / 2, y: Math.floor(id / columns) / 2 };
    const result = walkable(point, map, index) ? point : null;
    if (nodes.size < NAVIGATION_LIMITS.maxCachedNodes) nodes.set(id, result);
    return result;
  };
  const goals = new Map<number, number>(), records = new Map<number, SearchNode>();
  const open = new NavigationHeap(records);
  for (const endpoint of [start, goal]) for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const col = Math.round(endpoint.x * 2) + dx, row = Math.round(endpoint.y * 2) + dy;
    if (col < 0 || col >= columns || row < 0 || row >= rows) continue;
    const id = row * columns + col, point = node(id);
    if (!point || distance(point, endpoint) > 1.1 || !segmentWalkable(endpoint, point, map, index)) continue;
    if (endpoint === goal) { goals.set(id, distance(point, goal)); continue; }
    const cost = distance(start, point), heuristic = distance(point, goal);
    records.set(id, { cost, heuristic, score: cost + heuristic, closed: false, heapIndex: -1 }); open.update(id);
  }
  if (!goals.size) return null;
  let terminal: number | undefined, terminalCost = Infinity, expanded = 0;
  while (open.size && expanded < NAVIGATION_LIMITS.maxExpandedNodes) {
    const current = open.pop()!, record = records.get(current)!;
    if (record.score >= terminalCost) break;
    record.closed = true; expanded++;
    const currentPoint = node(current)!;
    const remaining = goals.get(current);
    if (remaining !== undefined && record.cost + remaining < terminalCost) { terminal = current; terminalCost = record.cost + remaining; }
    const column = current % columns, row = Math.floor(current / columns);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if ((!dx && !dy) || column + dx < 0 || column + dx >= columns || row + dy < 0 || row + dy >= rows) continue;
      const id = (row + dy) * columns + column + dx;
      let nextRecord = records.get(id);
      if (nextRecord?.closed) continue;
      const next = node(id);
      if (!next || !segmentWalkable(currentPoint, next, map, index)) continue;
      const candidate = record.cost + (dx && dy ? Math.SQRT1_2 : .5);
      if (candidate >= (nextRecord?.cost ?? Infinity)) continue;
      if (!nextRecord) {
        if (records.size >= NAVIGATION_LIMITS.maxSearchNodes) continue;
        const heuristic = distance(next, goal);
        nextRecord = { cost: candidate, parent: current, heuristic, score: candidate + heuristic, closed: false, heapIndex: -1 };
        records.set(id, nextRecord);
      } else { nextRecord.cost = candidate; nextRecord.parent = current; nextRecord.score = candidate + nextRecord.heuristic; }
      open.update(id);
    }
  }
  if (terminal === undefined) return null;
  const reverse: Point[] = [];
  let cursor: number | undefined = terminal;
  while (cursor !== undefined) { reverse.push(node(cursor)!); cursor = records.get(cursor)!.parent; }
  const raw = [{...start}, ...reverse.reverse(), {...goal}], smooth: Point[] = [{...start}];
  let cursorIndex = 0, smoothChecks = 0;
  while (cursorIndex < raw.length - 1) {
    if (smoothChecks >= NAVIGATION_LIMITS.maxSmoothChecks) {
      // Every raw edge was already swept-tested. Keep a valid unsmoothed tail
      // rather than turn a winding route into quadratic LOS work.
      for (const point of raw.slice(cursorIndex + 1)) if (distance(smooth[smooth.length - 1]!, point) > EPSILON) smooth.push({...point});
      break;
    }
    let next = raw.length - 1;
    while (next > cursorIndex + 1) {
      if (smoothChecks >= NAVIGATION_LIMITS.maxSmoothChecks) { next = cursorIndex + 1; break; }
      smoothChecks++;
      if (segmentWalkable(raw[cursorIndex]!, raw[next]!, map, index)) break;
      next--;
    }
    if (distance(smooth[smooth.length - 1]!, raw[next]!) > EPSILON) smooth.push({...raw[next]!});
    cursorIndex = next;
  }
  return smooth;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
function safeAxis(value: number): number {
  return Number.isFinite(value) ? clamp(value, -1, 1) : 0;
}
function safeTime(dt: number): number {
  return Number.isFinite(dt) ? clamp(dt, 0, 0.25) : 0;
}
function moveAxis(
  player: Point,
  delta: number,
  axis: "x" | "y",
  solids: readonly Rect[],
  map?: NavigationMap,
): number {
  if (delta === 0) return player[axis];
  let target = player[axis] + delta;
  const otherAxis = axis === "x" ? "y" : "x";
  const size = axis === "x" ? "width" : "height";
  const otherSize = axis === "x" ? "height" : "width";
  const end = { x: player.x, y: player.y, [axis]: target };
  someSolid(solids, map ? navigationCache(map)?.index ?? null : null, Math.min(player.x, end.x) - RADIUS, Math.min(player.y, end.y) - RADIUS, Math.max(player.x, end.x) + RADIUS, Math.max(player.y, end.y) + RADIUS, solid => {
    if (
      player[otherAxis] + RADIUS <= solid[otherAxis] + EPSILON ||
      player[otherAxis] - RADIUS >=
        solid[otherAxis] + solid[otherSize] - EPSILON
    )
      return false;
    if (
      delta > 0 &&
      player[axis] + RADIUS <= solid[axis] + EPSILON &&
      target + RADIUS > solid[axis]
    )
      target = Math.min(target, solid[axis] - RADIUS);
    if (
      delta < 0 &&
      player[axis] - RADIUS >= solid[axis] + solid[size] - EPSILON &&
      target - RADIUS < solid[axis] + solid[size]
    )
      target = Math.max(target, solid[axis] + solid[size] + RADIUS);
    return false;
  });
  return target;
}

/** Fixed, pure top-down integration. Input packets never supply position or elapsed time. */
export function stepHome(
  player: PlayerState,
  input: PlayerInput,
  dt: number,
  map: NavigationMap = HOME_MAP,
  now = 0,
): PlayerState {
  const next = { ...player };
  let axisX = player.connected ? safeAxis(input.axisX) : 0;
  let axisY = player.connected ? safeAxis(input.axisY) : 0;
  const magnitude = Math.hypot(axisX, axisY);
  if (magnitude > 1) {
    axisX /= magnitude;
    axisY /= magnitude;
  }
  if (magnitude > 0) {
    delete next.seatId;
    delete next.roastingAt;
    next.facing =
      Math.abs(axisX) > Math.abs(axisY)
        ? axisX > 0
          ? "right"
          : "left"
        : axisY > 0
          ? "down"
          : "up";
  }
  if (player.connected && input.look) next.facing = input.look;
  const sprintStep = stepSprint(next, !!input.sprint, magnitude > 0, now, safeTime(dt));
  Object.assign(next, sprintStep.player);
  const speed = GAME_CONFIG.homeSpeed * sprintStep.multiplier * (next.respawnAt ? 1 : potionMultipliers(next.potionEffects ?? [], now).speed);
  next.vx = axisX * speed;
  next.vy = axisY * speed;
  if (next.seatId) {
    next.vx = 0;
    next.vy = 0;
  }
  const total = safeTime(dt);
  const count = Math.max(1, Math.ceil(total / MAX_STEP));
  const step = total / count;
  for (let i = 0; i < count; i++) {
    const oldX = next.x;
    next.x = clamp(
      moveAxis(next, next.vx * step, "x", map.solids, map),
      RADIUS,
      map.width - RADIUS,
    );
    if (Math.abs(next.x - oldX - next.vx * step) > EPSILON) next.vx = 0;
    const oldY = next.y;
    next.y = clamp(
      moveAxis(next, next.vy * step, "y", map.solids, map),
      RADIUS,
      map.height - RADIUS,
    );
    if (Math.abs(next.y - oldY - next.vy * step) > EPSILON) next.vy = 0;
  }
  next.lastInputSeq = Math.max(player.lastInputSeq, input.seq);
  return next;
}

export function getCheckpointSpawn(checkpoint: number): Point {
  const index = Number.isFinite(checkpoint)
    ? clamp(Math.floor(checkpoint), 0, RACE_MAP.checkpoints.length)
    : 0;
  return {
    ...(index > 0 ? RACE_MAP.checkpoints[index - 1]!.spawn : RACE_MAP.spawn),
  };
}
export function resetRacePlayer(player: PlayerState): PlayerState {
  const next: PlayerState = {
    ...player,
    mode: "race",
    ...RACE_MAP.spawn,
    raceSpeedBoostSeconds: 0,
    raceJumpBoostSeconds: 0,
    racePickupIds: [],
    raceJumpCount: 0,
    raceDeathCount: 0,
    racePickupCount: 0,
    vx: 0,
    vy: 0,
    checkpoint: 0,
    grounded: true,
    jumpHeld: false,
    coyoteTime: 0,
    jumpBuffer: 0,
    respawnTimer: 0,
  };
  delete next.finishedAt;
  delete next.seatId;
  return next;
}
export function respawnRacePlayer(player: PlayerState): PlayerState {
  return {
    ...player,
    ...getCheckpointSpawn(player.checkpoint),
    raceSpeedBoostSeconds: 0,
    raceJumpBoostSeconds: 0,
    vx: 0,
    vy: 0,
    grounded: true,
    jumpBuffer: 0,
    coyoteTime: 0,
    respawnTimer: 0,
  };
}

/** Player center uses the same .3-tile body in both client prediction and server rules. */
export function stepRace(
  player: PlayerState,
  input: PlayerInput,
  dt: number,
): PlayerState {
  let next: PlayerState = { ...player, mode: "race" };
  const total = safeTime(dt);
  const count = Math.max(1, Math.ceil(total / MAX_STEP));
  const step = total / count;
  const jump = player.connected && input.jump;
  if (jump && !player.jumpHeld)
    next.jumpBuffer = GAME_CONFIG.raceJumpBufferSeconds;
  next.jumpHeld = jump;
  next.lastInputSeq = Math.max(player.lastInputSeq, input.seq);
  if (player.finishedAt !== undefined) return { ...next, vx: 0, vy: 0 };
  const axis = player.connected ? safeAxis(input.axisX) : 0;
  for (let i = 0; i < count; i++) {
    if ((next.respawnTimer ?? 0) > 0) {
      next.respawnTimer = Math.max(0, (next.respawnTimer ?? 0) - step);
      next.vx = 0;
      next.vy = 0;
      if (next.respawnTimer <= EPSILON) next = respawnRacePlayer(next);
      continue;
    }
    next = stepRaceBoosts(next, step);
    next.coyoteTime = next.grounded
      ? GAME_CONFIG.raceCoyoteSeconds
      : Math.max(0, (next.coyoteTime ?? 0) - step);
    if ((next.jumpBuffer ?? 0) > 0 && (next.coyoteTime ?? 0) > 0) {
      next.vy = GAME_CONFIG.raceJumpVelocity * raceJumpMultiplier(next);
      next.raceJumpCount = (next.raceJumpCount ?? 0) + 1;
      next.grounded = false;
      next.coyoteTime = 0;
      next.jumpBuffer = 0;
    }
    next.jumpBuffer = Math.max(0, (next.jumpBuffer ?? 0) - step);
    next.vx = axis * GAME_CONFIG.raceSpeed * raceSpeedMultiplier(next);
    if (axis !== 0) next.facing = axis > 0 ? "right" : "left";
    next.vy = Math.min(
      GAME_CONFIG.raceTerminalVelocity,
      next.vy + GAME_CONFIG.raceGravity * step,
    );
    const oldX = next.x;
    next.x = clamp(
      moveAxis(next, next.vx * step, "x", RACE_MAP.platforms),
      RADIUS,
      RACE_MAP.width - RADIUS,
    );
    if (Math.abs(next.x - oldX - next.vx * step) > EPSILON) next.vx = 0;
    const oldY = next.y;
    next.y = moveAxis(next, next.vy * step, "y", RACE_MAP.platforms);
    const hitVertical = Math.abs(next.y - oldY - next.vy * step) > EPSILON;
    next.grounded = hitVertical && next.vy >= 0;
    if (hitVertical) next.vy = 0;
    const checkpoint = RACE_MAP.checkpoints[next.checkpoint];
    if (checkpoint && overlapsPlayer(next, checkpoint)) next.checkpoint += 1;
    if (
      RACE_MAP.hazards.some((hazard) => overlapsPlayer(next, hazard)) ||
      next.y > RACE_MAP.height + 1
    ) {
      next = clearRaceBoosts(next);
      next.raceDeathCount = (next.raceDeathCount ?? 0) + 1;
      next.respawnTimer = GAME_CONFIG.hazardRespawnSeconds;
      next.vx = 0;
      next.vy = 0;
      next.jumpBuffer = 0;
      next.coyoteTime = 0;
    }
  }
  return next;
}

/** Caller owns the running phase, tick, finish timestamp and ranking. */
export function hasFinishedRace(player: PlayerState): boolean {
  return (
    player.mode === "race" &&
    player.checkpoint === RACE_MAP.checkpoints.length &&
    !(player.respawnTimer && player.respawnTimer > 0) &&
    overlapsPlayer(player, RACE_MAP.finish)
  );
}

export interface VoiceParticipant extends Point {
  id: string;
  mode: "home" | "race";
  nativeMode: "off" | "listen" | "enabled";
  manualMute: boolean;
  deafened: boolean;
  connected: boolean;
  zoneId?: string;
  instanceId?: string;
  epoch?: string;
}
/** Spatial/settings estimate only. Actual transport authorization also needs verified media/access freshness. */
export function getVoiceEligibility(
  source: VoiceParticipant,
  listener: VoiceParticipant,
  mode: VoiceMode,
  priorEligible = false,
): boolean {
  if (
    source.id === listener.id ||
    !source.connected ||
    !listener.connected ||
    source.mode !== listener.mode ||
    source.nativeMode !== "enabled" ||
    source.manualMute ||
    source.deafened ||
    listener.nativeMode === "off" ||
    listener.deafened
  )
    return false;
  if (
    (source.instanceId !== undefined || listener.instanceId !== undefined) &&
    source.instanceId !== listener.instanceId
  )
    return false;
  if (
    (source.epoch !== undefined || listener.epoch !== undefined) &&
    source.epoch !== listener.epoch
  )
    return false;
  if (
    !Number.isFinite(source.x) ||
    !Number.isFinite(source.y) ||
    !Number.isFinite(listener.x) ||
    !Number.isFinite(listener.y)
  )
    return false;
  if (mode === "room") return true;
  if (source.zoneId !== listener.zoneId) return false;
  const tiles = distance(source, listener);
  return priorEligible
    ? tiles < GAME_CONFIG.voiceCutoffDistance
    : tiles <= GAME_CONFIG.voiceSubscribeDistance;
}

export interface VerifiedVoiceParticipant extends VoiceParticipant {
  accessValid: boolean;
  mediaConnected: boolean;
  positionUpdatedAt: number;
  instanceId: string;
  epoch: string;
  zoneId: string;
  publicationAllowed: boolean;
}
export function getMediaEligibility(
  source: VerifiedVoiceParticipant,
  listener: VerifiedVoiceParticipant,
  mode: VoiceMode,
  now: number,
  priorEligible = false,
): boolean {
  if (
    !source.accessValid ||
    !listener.accessValid ||
    !source.mediaConnected ||
    !listener.mediaConnected ||
    !source.publicationAllowed ||
    !Number.isFinite(now)
  )
    return false;
  for (const peer of [source, listener]) {
    const age = now - peer.positionUpdatedAt;
    if (!Number.isFinite(age) || age < 0 || age >= 1_000) return false;
  }
  return getVoiceEligibility(source, listener, mode, priorEligible);
}

export function getVoiceGain(tiles: number): number {
  if (!Number.isFinite(tiles)) return 0;
  if (tiles <= GAME_CONFIG.voiceFullGainDistance) return 1;
  if (tiles >= GAME_CONFIG.voiceCutoffDistance) return 0;
  const t =
    (tiles - GAME_CONFIG.voiceFullGainDistance) /
    (GAME_CONFIG.voiceCutoffDistance - GAME_CONFIG.voiceFullGainDistance);
  return 1 - (3 * t * t - 2 * t * t * t);
}
