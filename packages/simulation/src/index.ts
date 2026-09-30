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
export function isHomeWalkable(point: Point, map: NavigationMap = HOME_MAP): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y) &&
    point.x >= RADIUS && point.y >= RADIUS &&
    point.x <= map.width - RADIUS && point.y <= map.height - RADIUS &&
    !map.solids.some((solid) => overlapsPlayer(point, solid));
}

/** Swept avatar footprint against expanded rectangles; no diagonal corner cutting. */
export function isHomeSegmentWalkable(from: Point, to: Point, map: NavigationMap = HOME_MAP): boolean {
  if (!isHomeWalkable(from, map) || !isHomeWalkable(to, map)) return false;
  for (const solid of map.solids) {
    let enter = 0;
    let exit = 1;
    for (const axis of ["x", "y"] as const) {
      const size = axis === "x" ? "width" : "height";
      const low = solid[axis] - RADIUS + EPSILON;
      const high = solid[axis] + solid[size] + RADIUS - EPSILON;
      const delta = to[axis] - from[axis];
      if (Math.abs(delta) < EPSILON) {
        if (from[axis] <= low || from[axis] >= high) { enter = 2; break; }
      } else {
        const a = (low - from[axis]) / delta;
        const b = (high - from[axis]) / delta;
        enter = Math.max(enter, Math.min(a, b));
        exit = Math.min(exit, Math.max(a, b));
      }
    }
    if (enter <= exit && enter <= 1 && exit >= 0) return false;
  }
  return true;
}

/** Bounded half-tile A*. Includes exact off-grid endpoints and smooths only safe segments.
 * Waypoints are movement targets; clients still submit bounded direction inputs. */
export function findHomePath(start: Point, goal: Point, map: NavigationMap = HOME_MAP): Point[] | null {
  if (!isHomeWalkable(start, map) || !isHomeWalkable(goal, map)) return null;
  if (isHomeSegmentWalkable(start, goal, map)) return distance(start, goal) < EPSILON ? [{...start}] : [{...start}, {...goal}];
  const columns = Math.floor(map.width * 2) + 1;
  const rows = Math.floor(map.height * 2) + 1;
  if (columns * rows > 16_384) return null;
  const nodes = new Map<number, Point>();
  for (let row = 0; row < rows; row++) for (let col = 0; col < columns; col++) {
    const point = {x: col / 2, y: row / 2};
    if (isHomeWalkable(point, map)) nodes.set(row * columns + col, point);
  }
  const goalCosts = new Map<number, number>();
  const open = new Set<number>();
  const costs = new Map<number, number>();
  const parents = new Map<number, number>();
  for (const [id, point] of nodes) {
    if (distance(point, start) <= 1.1 && isHomeSegmentWalkable(start, point, map)) {
      costs.set(id, distance(start, point)); open.add(id);
    }
    if (distance(point, goal) <= 1.1 && isHomeSegmentWalkable(point, goal, map)) goalCosts.set(id, distance(point, goal));
  }
  let terminal: number | undefined;
  let terminalCost = Infinity;
  const closed = new Set<number>();
  while (open.size && closed.size < 16_384) {
    let current = -1;
    let best = Infinity;
    for (const id of open) {
      const score = costs.get(id)! + distance(nodes.get(id)!, goal);
      if (score < best) { best = score; current = id; }
    }
    if (best >= terminalCost) break;
    open.delete(current); closed.add(current);
    const currentPoint = nodes.get(current)!;
    const remaining = goalCosts.get(current);
    if (remaining !== undefined && costs.get(current)! + remaining < terminalCost) {
      terminal = current; terminalCost = costs.get(current)! + remaining;
    }
    const column = current % columns;
    const row = Math.floor(current / columns);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if ((!dx && !dy) || column + dx < 0 || column + dx >= columns || row + dy < 0 || row + dy >= rows) continue;
      const id = (row + dy) * columns + column + dx;
      const next = nodes.get(id);
      if (!next || closed.has(id) || !isHomeSegmentWalkable(currentPoint, next, map)) continue;
      const candidate = costs.get(current)! + distance(currentPoint, next);
      if (candidate < (costs.get(id) ?? Infinity)) {
        costs.set(id, candidate); parents.set(id, current); open.add(id);
      }
    }
  }
  if (terminal === undefined) return null;
  const reverse: Point[] = [];
  let cursor: number | undefined = terminal;
  while (cursor !== undefined) { reverse.push(nodes.get(cursor)!); cursor = parents.get(cursor); }
  const raw = [{...start}, ...reverse.reverse(), {...goal}];
  const smooth: Point[] = [raw[0]!];
  let index = 0;
  while (index < raw.length - 1) {
    let next = raw.length - 1;
    while (next > index + 1 && !isHomeSegmentWalkable(raw[index]!, raw[next]!, map)) next--;
    if (distance(smooth[smooth.length - 1]!, raw[next]!) > EPSILON) smooth.push({...raw[next]!});
    index = next;
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
): number {
  let target = player[axis] + delta;
  const otherAxis = axis === "x" ? "y" : "x";
  const size = axis === "x" ? "width" : "height";
  const otherSize = axis === "x" ? "height" : "width";
  for (const solid of solids) {
    if (
      player[otherAxis] + RADIUS <= solid[otherAxis] + EPSILON ||
      player[otherAxis] - RADIUS >=
        solid[otherAxis] + solid[otherSize] - EPSILON
    )
      continue;
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
  }
  return target;
}

/** Fixed, pure top-down integration. Input packets never supply position or elapsed time. */
export function stepHome(
  player: PlayerState,
  input: PlayerInput,
  dt: number,
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
    next.facing =
      Math.abs(axisX) > Math.abs(axisY)
        ? axisX > 0
          ? "right"
          : "left"
        : axisY > 0
          ? "down"
          : "up";
  }
  next.vx = axisX * GAME_CONFIG.homeSpeed;
  next.vy = axisY * GAME_CONFIG.homeSpeed;
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
      moveAxis(next, next.vx * step, "x", HOME_MAP.solids),
      RADIUS,
      HOME_MAP.width - RADIUS,
    );
    if (Math.abs(next.x - oldX - next.vx * step) > EPSILON) next.vx = 0;
    const oldY = next.y;
    next.y = clamp(
      moveAxis(next, next.vy * step, "y", HOME_MAP.solids),
      RADIUS,
      HOME_MAP.height - RADIUS,
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
    next.coyoteTime = next.grounded
      ? GAME_CONFIG.raceCoyoteSeconds
      : Math.max(0, (next.coyoteTime ?? 0) - step);
    if ((next.jumpBuffer ?? 0) > 0 && (next.coyoteTime ?? 0) > 0) {
      next.vy = GAME_CONFIG.raceJumpVelocity;
      next.grounded = false;
      next.coyoteTime = 0;
      next.jumpBuffer = 0;
    }
    next.jumpBuffer = Math.max(0, (next.jumpBuffer ?? 0) - step);
    next.vx = axis * GAME_CONFIG.raceSpeed;
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
