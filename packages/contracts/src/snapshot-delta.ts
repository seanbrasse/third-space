/** Lossless field deltas for the existing complete snapshot DTO.
 * Pure TypeScript, no transport dependency. The current Colyseus MessagePack
 * transport preserves undefined; JSON alone does not (see integration notes).
 */
export type SnapshotValue = null | undefined | boolean | number | string | SnapshotValue[] | { [key: string]: SnapshotValue };
export interface SnapshotIdentity { epoch: string }
export interface SnapshotFields { set?: Record<string, SnapshotValue>; remove?: string[] }
/** Tuples avoid repeating `id` and `changes` keys for every moving entity. */
export type SnapshotEntityUpdate = [id: string, set: Record<string, SnapshotValue>, remove?: string[]];
export interface SnapshotEntities {
  add?: Record<string, SnapshotValue>[];
  update?: SnapshotEntityUpdate[];
  remove?: string[];
  /** Present only when membership/order changes; exact final ID order. */
  order?: string[];
}
export interface SnapshotFull<T extends SnapshotIdentity = SnapshotIdentity> {
  v: 1; kind: 'full'; epoch: string; seq: number; snapshot: T;
}
export interface SnapshotDelta {
  v: 1; kind: 'delta'; epoch: string; baseSeq: number; seq: number;
  changes?: SnapshotFields;
  entities?: { players?: SnapshotEntities; members?: SnapshotEntities; npcs?: SnapshotEntities };
  survival?: { changes?: SnapshotFields; players?: SnapshotEntities };
}
export type SnapshotFrame<T extends SnapshotIdentity = SnapshotIdentity> = SnapshotFull<T> | SnapshotDelta;
export interface SnapshotState<T extends SnapshotIdentity> { readonly epoch: string; readonly seq: number; readonly snapshot: T }
export type SnapshotApplyResult<T extends SnapshotIdentity> =
  | { ok: true; applied: boolean; state: SnapshotState<T> }
  | { ok: false; resync: true; reason: 'invalid-frame' | 'epoch-mismatch' | 'missing-base' };
export const SNAPSHOT_DELTA_VERSION = 1;
export const SNAPSHOT_FULL_INTERVAL_MS = 2_000;
/** Bounds are per packet. Typical eight-person snapshots are well below these. */
export const SNAPSHOT_DELTA_LIMITS = Object.freeze({ depth: 24, nodes: 50_000, array: 4_096, fields: 256, entities: 512, string: 65_536, stringTotal: 1_048_576 });

const own = (value: object, key: PropertyKey) => Object.prototype.hasOwnProperty.call(value, key);
const forbidden = (key: string) => key === '__proto__' || key === 'constructor' || key === 'prototype';
const entityKeys = ['players', 'members', 'npcs'] as const;
type Dictionary = Record<string, SnapshotValue>;
function invalid(): never { throw new Error('Invalid snapshot delta data.'); }
function object(value: unknown): value is Dictionary {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value); return prototype === Object.prototype || prototype === null;
}
function sequence(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1; }
function id(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 256; }
function keysOnly(value: Dictionary, allowed: readonly string[]) { if (Object.keys(value).some(key => !allowed.includes(key))) invalid(); }

/** Validate and detach without calling getters, accepting only bounded wire DTOs.
 * Repeated references are copied; cycles, accessors, exotic objects and unsafe
 * property names are rejected. Never spreads or merges untrusted dictionaries.
 */
function copy<T>(input: T): T {
  let nodes = 0, strings = 0;
  const ancestors = new Set<object>();
  const walk = (value: unknown, depth: number): SnapshotValue => {
    if (++nodes > SNAPSHOT_DELTA_LIMITS.nodes || depth > SNAPSHOT_DELTA_LIMITS.depth) invalid();
    if (value === null || value === undefined || typeof value === 'boolean') return value;
    if (typeof value === 'number') { if (!Number.isFinite(value)) invalid(); return value; }
    if (typeof value === 'string') { strings += value.length; if (value.length > SNAPSHOT_DELTA_LIMITS.string || strings > SNAPSHOT_DELTA_LIMITS.stringTotal) invalid(); return value; }
    if (typeof value !== 'object' || ancestors.has(value) || Object.getOwnPropertySymbols(value).length) invalid();
    ancestors.add(value);
    let result: SnapshotValue;
    if (Array.isArray(value)) {
      if (value.length > SNAPSHOT_DELTA_LIMITS.array || Object.keys(value).length !== value.length) invalid();
      const array: SnapshotValue[] = [];
      for (let at = 0; at < value.length; at++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(at));
        if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) invalid();
        array.push(walk(descriptor.value, depth + 1));
      }
      result = array;
    } else {
      if (!object(value)) invalid();
      const keys = Object.keys(value);
      if (keys.length > SNAPSHOT_DELTA_LIMITS.fields || Object.getOwnPropertyNames(value).length !== keys.length) invalid();
      const record: Dictionary = {};
      for (const key of keys) {
        strings += key.length;
        if (forbidden(key) || key.length > 256 || strings > SNAPSHOT_DELTA_LIMITS.stringTotal) invalid();
        const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
        if (!('value' in descriptor)) invalid();
        record[key] = walk(descriptor.value, depth + 1);
      }
      result = record;
    }
    ancestors.delete(value);
    return Object.freeze(result) as SnapshotValue;
  };
  return walk(input, 0) as T;
}
interface Footprint { nodes: number; strings: number; depth: number }
const footprints = new WeakMap<object, Footprint>();
/** Bound the reconstructed state too: a sequence of individually small patches
 * must not accumulate an unbounded object. Frozen unchanged branches are cached.
 */
function footprint(value: SnapshotValue): Footprint {
  if (value === null || typeof value !== 'object') return { nodes: 1, strings: typeof value === 'string' ? value.length : 0, depth: 0 };
  const cached = footprints.get(value); if (cached) return cached;
  const array = Array.isArray(value), keys = Object.keys(value);
  if (!array && keys.length > SNAPSHOT_DELTA_LIMITS.fields) invalid();
  const result: Footprint = { nodes: 1, strings: 0, depth: 0 };
  for (const key of keys) {
    const child = footprint((value as Dictionary)[key]);
    result.nodes += child.nodes; result.strings += child.strings + (array ? 0 : key.length); result.depth = Math.max(result.depth, child.depth + 1);
    if (result.nodes > SNAPSHOT_DELTA_LIMITS.nodes || result.strings > SNAPSHOT_DELTA_LIMITS.stringTotal || result.depth > SNAPSHOT_DELTA_LIMITS.depth) invalid();
  }
  if (Object.isFrozen(value)) footprints.set(value, result);
  return result;
}
function equal(a: SnapshotValue, b: SnapshotValue): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((value, at) => equal(value, b[at]));
  if (object(a) && object(b)) {
    const keys = Object.keys(a); return keys.length === Object.keys(b).length && keys.every(key => own(b, key) && equal(a[key], b[key]));
  }
  return false;
}
function fields(previous: Dictionary, next: Dictionary, skip: ReadonlySet<string> = new Set()): SnapshotFields | undefined {
  const set: Dictionary = {}, remove: string[] = [];
  for (const key of Object.keys(next)) if (!skip.has(key) && (!own(previous, key) || !equal(previous[key], next[key]))) set[key] = next[key];
  for (const key of Object.keys(previous)) if (!skip.has(key) && !own(next, key)) remove.push(key);
  return Object.keys(set).length || remove.length ? { ...(Object.keys(set).length ? { set } : {}), ...(remove.length ? { remove } : {}) } : undefined;
}
function entityMap(value: SnapshotValue): Map<string, Dictionary> {
  if (!Array.isArray(value) || value.length > SNAPSHOT_DELTA_LIMITS.entities) invalid();
  const result = new Map<string, Dictionary>();
  for (const entity of value) {
    if (!object(entity) || !own(entity, 'id') || !id(entity.id) || result.has(entity.id)) invalid();
    result.set(entity.id, entity);
  }
  return result;
}
function entities(previous: SnapshotValue, next: SnapshotValue): SnapshotEntities | undefined {
  const before = entityMap(previous), after = entityMap(next);
  const add: Dictionary[] = [], update: SnapshotEntityUpdate[] = [], remove: string[] = [];
  for (const [key, entity] of after) {
    const old = before.get(key);
    if (!old) add.push(entity);
    else {
      const patch = fields(old, entity, new Set(['id']));
      if (patch) update.push(patch.remove ? [key, patch.set ?? {}, patch.remove] : [key, patch.set ?? {}]);
    }
  }
  for (const key of before.keys()) if (!after.has(key)) remove.push(key);
  const priorOrder = [...before.keys()], order = [...after.keys()];
  const changedOrder = priorOrder.length !== order.length || priorOrder.some((key, at) => key !== order[at]);
  return add.length || update.length || remove.length || changedOrder ? {
    ...(add.length ? { add } : {}), ...(update.length ? { update } : {}), ...(remove.length ? { remove } : {}), ...(changedOrder ? { order } : {}),
  } : undefined;
}
function validateSnapshot(value: unknown): asserts value is Dictionary & SnapshotIdentity {
  if (!object(value) || !id(value.epoch)) invalid();
  for (const key of entityKeys) if (value[key] !== undefined) entityMap(value[key]);
  if (object(value.survival) && value.survival.players !== undefined) entityMap(value.survival.players);
}
function makeDelta(previous: Dictionary & SnapshotIdentity, next: Dictionary & SnapshotIdentity, baseSeq: number, seq: number): SnapshotDelta {
  if (!sequence(baseSeq) || !sequence(seq) || seq !== baseSeq + 1 || previous.epoch !== next.epoch) invalid();
  const skip = new Set<string>(['epoch']), keyed: NonNullable<SnapshotDelta['entities']> = {};
  for (const key of entityKeys) if (Array.isArray(previous[key]) && Array.isArray(next[key])) {
    skip.add(key); const patch = entities(previous[key], next[key]); if (patch) keyed[key] = patch;
  }
  let survival: SnapshotDelta['survival'];
  if (object(previous.survival) && object(next.survival)) {
    skip.add('survival'); const nestedSkip = new Set<string>();
    let players: SnapshotEntities | undefined;
    if (Array.isArray(previous.survival.players) && Array.isArray(next.survival.players)) {
      nestedSkip.add('players'); players = entities(previous.survival.players, next.survival.players);
    }
    const changes = fields(previous.survival, next.survival, nestedSkip);
    if (players || changes) survival = { ...(changes ? { changes } : {}), ...(players ? { players } : {}) };
  }
  const changes = fields(previous, next, skip);
  return { v: 1, kind: 'delta', epoch: next.epoch, baseSeq, seq,
    ...(changes ? { changes } : {}), ...(Object.keys(keyed).length ? { entities: keyed } : {}), ...(survival ? { survival } : {}) };
}
/** Stateless encoder; clones both inputs so frames cannot alias mutable room state. */
export function createSnapshotDelta<T extends SnapshotIdentity>(previous: T, next: T, baseSeq: number, seq = baseSeq + 1): SnapshotDelta {
  const before = copy(previous), after = copy(next); validateSnapshot(before); validateSnapshot(after);
  return copy(makeDelta(before, after, baseSeq, seq));
}
export function createSnapshotFull<T extends SnapshotIdentity>(snapshot: T, seq: number): SnapshotFull<T> {
  const detached = copy(snapshot); validateSnapshot(detached); if (!sequence(seq)) invalid();
  return Object.freeze({ v: 1, kind: 'full', epoch: detached.epoch, seq, snapshot: detached });
}

function names(value: SnapshotValue | undefined): string[] {
  if (!Array.isArray(value) || value.some(key => typeof key !== 'string' || forbidden(key) || key.length > 256) || new Set(value).size !== value.length) invalid();
  return value as string[];
}
function ids(value: SnapshotValue | undefined): string[] {
  if (!Array.isArray(value) || value.some(key => !id(key)) || new Set(value).size !== value.length) invalid();
  return value as string[];
}
function changedFields(previous: Dictionary, patch: unknown, protectedKeys: ReadonlySet<string> = new Set()): Dictionary {
  if (!object(patch)) invalid(); keysOnly(patch, ['set', 'remove']);
  const set = own(patch, 'set') ? patch.set : {}, remove = own(patch, 'remove') ? names(patch.remove) : [];
  if (!object(set)) invalid();
  for (const key of Object.keys(set)) if (protectedKeys.has(key)) invalid();
  for (const key of remove) if (protectedKeys.has(key) || own(set, key) || !own(previous, key)) invalid();
  const next: Dictionary = {};
  for (const key of Object.keys(previous)) if (!remove.includes(key)) next[key] = previous[key];
  for (const key of Object.keys(set)) next[key] = set[key];
  return Object.freeze(next);
}
function changedEntities(previous: SnapshotValue, patch: unknown): SnapshotValue[] {
  const before = entityMap(previous);
  if (!object(patch)) invalid(); keysOnly(patch, ['add', 'update', 'remove', 'order']);
  const after = new Map(before), touched = new Set<string>();
  const touch = (key: string) => { if (touched.has(key)) invalid(); touched.add(key); };
  if (own(patch, 'remove')) for (const key of ids(patch.remove)) { touch(key); if (!after.delete(key)) invalid(); }
  if (own(patch, 'add')) {
    const added = entityMap(patch.add);
    for (const [key, entity] of added) { touch(key); if (before.has(key)) invalid(); after.set(key, entity); }
  }
  if (own(patch, 'update')) {
    if (!Array.isArray(patch.update) || patch.update.length > SNAPSHOT_DELTA_LIMITS.entities) invalid();
    for (const update of patch.update) {
      if (!Array.isArray(update) || (update.length !== 2 && update.length !== 3) || !id(update[0]) || !object(update[1])) invalid();
      const key = update[0], old = before.get(key); touch(key); if (!old) invalid();
      after.set(key, changedFields(old, { set: update[1], ...(update.length === 3 ? { remove: update[2] } : {}) }, new Set(['id'])));
    }
  }
  if (after.size > SNAPSHOT_DELTA_LIMITS.entities) invalid();
  if (!own(patch, 'order')) {
    if (own(patch, 'add') || own(patch, 'remove')) invalid();
    return Object.freeze([...after.values()]) as SnapshotValue[];
  }
  const order = ids(patch.order);
  if (order.length !== after.size || order.some(key => !after.has(key))) invalid();
  return Object.freeze(order.map(key => after.get(key)!)) as SnapshotValue[];
}

/** Apply only against the exact immutable base. Epoch is pinned to the existing
 * state unless the caller supplies a freshly admitted connection's epoch. Clear
 * state on reconnect, or supply that new epoch; never accept a delta as a base.
 * Stale/replayed packets are harmless no-ops. Missing/invalid bases request resync.
 */
export function applySnapshotFrame<T extends SnapshotIdentity>(state: SnapshotState<T> | undefined, raw: unknown, expectedEpoch = state?.epoch): SnapshotApplyResult<T> {
  try {
    const frame = copy(raw);
    if (!object(frame) || frame.v !== 1 || !id(frame.epoch) || !sequence(frame.seq)) invalid();
    if (expectedEpoch !== undefined && frame.epoch !== expectedEpoch) return { ok: false, resync: true, reason: 'epoch-mismatch' };
    if (frame.kind === 'full') {
      keysOnly(frame, ['v', 'kind', 'epoch', 'seq', 'snapshot']); validateSnapshot(frame.snapshot);
      if (frame.snapshot.epoch !== frame.epoch) invalid();
      if (state && state.epoch === frame.epoch && frame.seq <= state.seq) return { ok: true, applied: false, state };
      return { ok: true, applied: true, state: Object.freeze({ epoch: frame.epoch, seq: frame.seq, snapshot: frame.snapshot as unknown as T }) };
    }
    if (frame.kind !== 'delta') invalid();
    keysOnly(frame, ['v', 'kind', 'epoch', 'seq', 'baseSeq', 'changes', 'entities', 'survival']);
    if (!sequence(frame.baseSeq) || frame.seq !== frame.baseSeq + 1) invalid();
    if (state && frame.epoch === state.epoch && frame.seq <= state.seq) return { ok: true, applied: false, state };
    if (!state || frame.epoch !== state.epoch || frame.baseSeq !== state.seq) return { ok: false, resync: true, reason: 'missing-base' };
    const before = state.snapshot as unknown as Dictionary;
    const protectedKeys = new Set(['epoch']);
    if (own(frame, 'entities')) {
      if (!object(frame.entities)) invalid(); keysOnly(frame.entities, entityKeys);
      for (const key of Object.keys(frame.entities)) protectedKeys.add(key);
    }
    if (own(frame, 'survival')) protectedKeys.add('survival');
    const next: Dictionary = { ...(own(frame, 'changes') ? changedFields(before, frame.changes, protectedKeys) : before) };
    if (object(frame.entities)) for (const key of entityKeys) if (own(frame.entities, key)) next[key] = changedEntities(before[key], frame.entities[key]);
    if (own(frame, 'survival')) {
      if (!object(frame.survival) || !object(before.survival)) invalid(); keysOnly(frame.survival, ['changes', 'players']);
      const nestedProtected = own(frame.survival, 'players') ? new Set(['players']) : new Set<string>();
      const survival: Dictionary = { ...(own(frame.survival, 'changes') ? changedFields(before.survival, frame.survival.changes, nestedProtected) : before.survival) };
      if (own(frame.survival, 'players')) survival.players = changedEntities(before.survival.players, frame.survival.players);
      next.survival = Object.freeze(survival);
    }
    validateSnapshot(next); footprint(next);
    return { ok: true, applied: true, state: Object.freeze({ epoch: frame.epoch, seq: frame.seq, snapshot: Object.freeze(next) as unknown as T }) };
  } catch { return { ok: false, resync: true, reason: 'invalid-frame' }; }
}

/** One encoder per admitted recipient/socket, never shared between players.
 * Retains a detached immutable base even if PartyRoom mutates its next tick.
 * Caller owns opt-in, rate-limited resync requests, and connection lifecycle.
 */
export class SnapshotDeltaEncoder<T extends SnapshotIdentity> {
  private previous?: Dictionary & SnapshotIdentity;
  private seq = 0;
  private fullAt = -Infinity;
  private lastAt = -Infinity;
  constructor(private readonly fullIntervalMs = SNAPSHOT_FULL_INTERVAL_MS) {
    if (!Number.isFinite(fullIntervalMs) || fullIntervalMs < 1 || fullIntervalMs > 60_000) invalid();
  }
  reset() { this.previous = undefined; this.seq = 0; this.fullAt = this.lastAt = -Infinity; }
  encode(snapshot: T, now: number, forceFull = false): SnapshotFrame<T> {
    if (!Number.isFinite(now)) invalid();
    const next = copy(snapshot); validateSnapshot(next);
    const seq = this.seq + 1; if (!sequence(seq)) invalid();
    const prior = this.previous;
    const full = forceFull || !prior || prior.epoch !== next.epoch || prior.worldRevision !== next.worldRevision || prior.instanceId !== next.instanceId || now < this.lastAt || now - this.fullAt >= this.fullIntervalMs;
    const frame: SnapshotFrame<T> = full
      ? Object.freeze({ v: 1, kind: 'full', epoch: next.epoch, seq, snapshot: next as unknown as T })
      : copy(makeDelta(prior, next, this.seq, seq));
    this.previous = next; this.seq = seq; this.lastAt = now; if (full) this.fullAt = now;
    return frame;
  }
}
