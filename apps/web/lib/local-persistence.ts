import { DEFAULT_AVATAR, type AvatarConfig } from "@third-space/contracts";
import { ACCESSORY_IDS, HAIR_IDS, OUTFIT_IDS } from "@third-space/config";

export type LocalStorageAccess = Pick<Storage, "getItem" | "setItem">;
export type HomeVisit = {
  homeId: string;
  count: number;
  firstVisitedAt: number;
  lastVisitedAt: number;
  lastVisitId?: string;
  visitIds?: string[];
};
const VERSION = 1;
const hex = /^#[a-fA-F0-9]{6}$/;
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const identifier = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 256;
const timestamp = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

// Accessing the localStorage property itself can throw in restricted browsers.
export function browserStorage(): LocalStorageAccess | undefined {
  try { return typeof window === "undefined" ? undefined : window.localStorage; }
  catch { return undefined; }
}
export function customizationKey(userId: string | null) {
  return `third-space.customization.${userId === null ? "guest" : `user:${encodeURIComponent(userId)}`}`;
}
export function visitsKey(userId: string) {
  return `third-space.visits.user:${encodeURIComponent(userId)}`;
}
function read(storage: LocalStorageAccess | undefined, key: string): unknown {
  try { const raw = storage?.getItem(key); return raw ? JSON.parse(raw) : null; }
  catch { return null; }
}
function supported(value: unknown) {
  return !object(value) || value.version === undefined || value.version === 0 || value.version === VERSION;
}
function write(storage: LocalStorageAccess | undefined, key: string, value: unknown): boolean {
  if (!storage) return false;
  try {
    const previous = storage.getItem(key);
    if (previous !== null) {
      let parsed: unknown;
      try { parsed = JSON.parse(previous); } catch { parsed = null; }
      // An older client must not destroy data saved by a newer schema.
      if (!supported(parsed)) return false;
      // Preserve the original on first migration/update, including corrupt bytes.
      if (storage.getItem(`${key}.backup`) === null) storage.setItem(`${key}.backup`, previous);
    }
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch { return false; }
}

/** Validate each option separately so partial/older drafts retain valid choices. */
export function normalizeAvatar(value: unknown, fallback: AvatarConfig = DEFAULT_AVATAR): AvatarConfig {
  const source = object(value) ? value : {};
  const base = { ...DEFAULT_AVATAR, ...fallback };
  const color = (key: string, defaultValue: string) =>
    typeof source[key] === "string" && hex.test(source[key]) ? source[key] : defaultValue;
  const skinColor = color("skinColor", color("color", base.skinColor));
  return {
    color: skinColor,
    skinColor,
    hairColor: color("hairColor", base.hairColor),
    clothingColor: color("clothingColor", base.clothingColor),
    trouserColor: color("trouserColor", base.trouserColor),
    hair: HAIR_IDS.includes(source.hair as AvatarConfig["hair"]) ? source.hair as AvatarConfig["hair"] : base.hair,
    outfit: OUTFIT_IDS.includes(source.outfit as AvatarConfig["outfit"]) ? source.outfit as AvatarConfig["outfit"] : base.outfit,
    accessory: ACCESSORY_IDS.includes(source.accessory as AvatarConfig["accessory"]) ? source.accessory as AvatarConfig["accessory"] : base.accessory,
  };
}
export function readCustomization(storage: LocalStorageAccess | undefined, userId: string | null, fallback = DEFAULT_AVATAR) {
  const saved = read(storage, customizationKey(userId));
  if (!supported(saved)) return normalizeAvatar(fallback);
  return normalizeAvatar(object(saved) && object(saved.avatar) ? saved.avatar : saved, fallback);
}
export function saveCustomization(storage: LocalStorageAccess | undefined, userId: string | null, avatar: AvatarConfig) {
  return write(storage, customizationKey(userId), { version: VERSION, avatar: normalizeAvatar(avatar) });
}

export const CAMPSITE_NAMES = [
  "Ember Hollow", "Pinecrest Camp", "Firefly Clearing", "Moonlit Meadow",
  "Cedar Haven", "Fernwood Camp", "Starlight Grove", "Willow Rest",
  "Mossy Pines", "Copperleaf Camp", "Lakeside Ember", "Wildflower Hollow",
] as const;
export const CAMPSITE_NAME_KEY = "third-space.campsite-name-suggestion";
/** A suggestion only; never rename a saved room or replace a typed name. */
export function suggestCampsiteName(storage: LocalStorageAccess | undefined, random = Math.random) {
  const saved = read(storage, CAMPSITE_NAME_KEY);
  const lastName = object(saved) && supported(saved) ? saved.lastName : undefined;
  const choices = CAMPSITE_NAMES.filter(name => name !== lastName);
  const sample = random();
  const index = Number.isFinite(sample) ? Math.max(0, Math.min(choices.length - 1, Math.floor(sample * choices.length))) : 0;
  const name = choices[index];
  write(storage, CAMPSITE_NAME_KEY, { version: VERSION, lastName: name });
  return name;
}

/** Merge by private home ID, never by display name or shared map type. */
export function uniqueHomes<T extends { id: string }>(homes: readonly T[]): T[] {
  const result = new Map<string, T>();
  for (const home of homes) if (identifier(home?.id) && !result.has(home.id)) result.set(home.id, home);
  return [...result.values()];
}
export function normalizeVisits(value: unknown): HomeVisit[] {
  if (!supported(value)) return [];
  const rows = Array.isArray(value) ? value : object(value) && Array.isArray(value.visits) ? value.visits : [];
  const merged = new Map<string, HomeVisit>();
  const events = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!object(row) || !identifier(row.homeId)) continue;
    const event = identifier(row.visitId) && timestamp(row.visitedAt);
    const count = typeof row.count === "number" && Number.isSafeInteger(row.count) && row.count >= 0 ? row.count : event ? 1 : 0;
    const first = timestamp(row.firstVisitedAt) ? row.firstVisitedAt : event ? row.visitedAt as number : 0;
    const last = timestamp(row.lastVisitedAt) ? row.lastVisitedAt : event ? row.visitedAt as number : first;
    const visit: HomeVisit = { homeId: row.homeId, count, firstVisitedAt: Math.min(first, last), lastVisitedAt: Math.max(first, last) };
    const visitId = identifier(row.lastVisitId) ? row.lastVisitId : event ? row.visitId as string : undefined;
    if (visitId) visit.lastVisitId = visitId;
    const ids = events.get(row.homeId) ?? new Set<string>();
    if (Array.isArray(row.visitIds)) for (const id of row.visitIds) if (identifier(id)) ids.add(id);
    if (visitId) ids.add(visitId);
    events.set(row.homeId, ids);
    const previous = merged.get(row.homeId);
    if (!previous) merged.set(row.homeId, visit);
    else merged.set(row.homeId, {
      homeId: row.homeId,
      // Duplicate aggregate records describe the same history. Summing inflates it.
      count: Math.max(previous.count, visit.count),
      firstVisitedAt: Math.min(previous.firstVisitedAt, visit.firstVisitedAt),
      lastVisitedAt: Math.max(previous.lastVisitedAt, visit.lastVisitedAt),
      lastVisitId: visit.lastVisitedAt > previous.lastVisitedAt ? visit.lastVisitId : previous.lastVisitId,
    });
  }
  for (const [homeId, ids] of events) {
    const visit = merged.get(homeId)!;
    visit.count = Math.max(visit.count, ids.size);
    if (ids.size) visit.visitIds = [...ids];
  }
  return [...merged.values()];
}
export function readVisits(storage: LocalStorageAccess | undefined, userId: string): HomeVisit[] {
  const key = visitsKey(userId);
  const saved = read(storage, key);
  const visits = normalizeVisits(saved);
  const canonical = { version: VERSION, visits };
  if (saved !== null && supported(saved) && JSON.stringify(saved) !== JSON.stringify(canonical)) write(storage, key, canonical);
  return visits;
}
export function recordVisit(storage: LocalStorageAccess | undefined, userId: string, homeId: string, visitId: string, now = Date.now(), current?: readonly HomeVisit[]): HomeVisit[] {
  const visits = normalizeVisits([...(current ?? []), ...readVisits(storage, userId)]);
  if (!identifier(homeId) || !identifier(visitId) || !timestamp(now)) return visits;
  const previous = visits.find(visit => visit.homeId === homeId);
  if (previous?.lastVisitId === visitId || previous?.visitIds?.includes(visitId)) return visits;
  if (previous) {
    previous.count = Math.min(Number.MAX_SAFE_INTEGER, previous.count + 1);
    previous.lastVisitedAt = Math.max(previous.lastVisitedAt, now);
    previous.lastVisitId = visitId;
    previous.visitIds = [...(previous.visitIds ?? []), visitId];
  } else visits.push({ homeId, count: 1, firstVisitedAt: now, lastVisitedAt: now, lastVisitId: visitId, visitIds: [visitId] });
  write(storage, visitsKey(userId), { version: VERSION, visits });
  return visits;
}
