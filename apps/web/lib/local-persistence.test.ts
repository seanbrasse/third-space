import { describe, expect, it } from "vitest";
import { DEFAULT_AVATAR } from "@third-space/contracts";
import {
  browserStorage, customizationKey, normalizeAvatar, normalizeVisits,
  readCustomization, readVisits, recordVisit, saveCustomization, uniqueHomes, visitsKey,
  type LocalStorageAccess,
  CAMPSITE_NAMES, CAMPSITE_NAME_KEY, suggestCampsiteName,
} from "./local-persistence";

class MemoryStorage implements LocalStorageAccess {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}
const look = { ...DEFAULT_AVATAR, hair: "long" as const, outfit: "jacket" as const, skinColor: "#123456", color: "#123456", clothingColor: "#abcdef" };

describe("device-local customization", () => {
  it("restores every selected option on another visit and isolates identities and guest drafts", () => {
    const storage = new MemoryStorage();
    expect(saveCustomization(storage, "sean", look)).toBe(true);
    expect(readCustomization(storage, "sean")).toEqual(look);
    expect(readCustomization(storage, "friend")).toEqual(DEFAULT_AVATAR);
    expect(readCustomization(storage, null)).toEqual(DEFAULT_AVATAR);
    saveCustomization(storage, null, { ...look, hair: "curly" });
    expect(readCustomization(storage, "sean")).toEqual(look);
    expect(readCustomization(storage, null).hair).toBe("curly");
  });
  it("fills partial drafts field by field and retains the legacy body color", () => {
    expect(normalizeAvatar({ color: "#456789", hair: "long", outfit: "bad", hairColor: "javascript:alert(1)" })).toEqual({ ...DEFAULT_AVATAR, color: "#456789", skinColor: "#456789", hair: "long" });
    expect(normalizeAvatar({ accessory: "glasses" }, look)).toEqual({ ...look, accessory: "glasses" });
  });
  it("reads unversioned drafts and preserves original bytes when saving the versioned payload", () => {
    const storage = new MemoryStorage();
    const raw = JSON.stringify({ avatar: { hair: "long" } });
    storage.setItem(customizationKey("sean"), raw);
    const restored = readCustomization(storage, "sean");
    saveCustomization(storage, "sean", restored);
    expect(restored.hair).toBe("long");
    expect(storage.getItem(`${customizationKey("sean")}.backup`)).toBe(raw);
    expect(JSON.parse(storage.getItem(customizationKey("sean"))!).version).toBe(1);
  });
  it("survives corrupt JSON and retains it before replacing with a valid draft", () => {
    const storage = new MemoryStorage();
    storage.setItem(customizationKey("sean"), "{broken");
    expect(readCustomization(storage, "sean", look)).toEqual(look);
    expect(saveCustomization(storage, "sean", look)).toBe(true);
    expect(storage.getItem(`${customizationKey("sean")}.backup`)).toBe("{broken");
  });
  it("does not overwrite a future version or its identity", () => {
    const storage = new MemoryStorage();
    const raw = JSON.stringify({ version: 2, avatar: look });
    storage.setItem(customizationKey("sean"), raw);
    expect(readCustomization(storage, "sean")).toEqual(DEFAULT_AVATAR);
    expect(saveCustomization(storage, "sean", DEFAULT_AVATAR)).toBe(false);
    expect(storage.getItem(customizationKey("sean"))).toBe(raw);
  });
  it("writes only appearance fields even if the input contains unrelated credentials", () => {
    const storage = new MemoryStorage();
    saveCustomization(storage, "sean", { ...look, pin: "123456", token: "private" } as typeof look);
    const payload = storage.getItem(customizationKey("sean"))!;
    expect(JSON.parse(payload).avatar).not.toHaveProperty("pin");
    expect(payload).not.toContain("private");
    expect(payload).not.toContain("token");
  });
  it("works with SSR, denied access, and quota failures without crashing", () => {
    expect(browserStorage()).toBeUndefined();
    expect(readCustomization(undefined, "sean")).toEqual(DEFAULT_AVATAR);
    expect(saveCustomization(undefined, "sean", look)).toBe(false);
    const denied = { getItem: () => { throw Error("Denied"); }, setItem: () => { throw Error("Denied"); } };
    expect(readCustomization(denied, "sean")).toEqual(DEFAULT_AVATAR);
    expect(saveCustomization(denied, "sean", look)).toBe(false);
    const quota = new MemoryStorage();
    quota.setItem = () => { throw Error("Quota"); };
    expect(saveCustomization(quota, "sean", look)).toBe(false);
  });
});

describe("new campsite name suggestions", () => {
  it("varies new suggestions across reloads even if random returns the same sample", () => {
    const storage = new MemoryStorage();
    const first = suggestCampsiteName(storage, () => 0);
    const second = suggestCampsiteName(storage, () => 0);
    expect(CAMPSITE_NAMES).toContain(first);
    expect(CAMPSITE_NAMES).toContain(second);
    expect(second).not.toBe(first);
    expect(JSON.parse(storage.getItem(CAMPSITE_NAME_KEY)!).lastName).toBe(second);
  });
  it("handles corrupt/unavailable storage and an invalid random source", () => {
    const storage = new MemoryStorage();
    storage.setItem(CAMPSITE_NAME_KEY, "{broken");
    expect(suggestCampsiteName(storage, () => NaN)).toBe("Ember Hollow");
    expect(suggestCampsiteName(undefined, () => 1)).toBe("Wildflower Hollow");
  });
});

describe("private home visit history", () => {
  it("renders one row per home ID in stable order and preserves equal-name/map rooms", () => {
    const first = { id: "a", name: "Our little place", map: "campsite" };
    const second = { ...first, id: "b" };
    expect(uniqueHomes([first, second, { ...first }, { ...second }])).toEqual([first, second]);
  });
  it("records successful distinct entries and makes a repeated admission idempotent", () => {
    const storage = new MemoryStorage();
    recordVisit(storage, "sean", "a", "entry-1", 100);
    recordVisit(storage, "sean", "a", "entry-1", 200);
    const visits = recordVisit(storage, "sean", "a", "entry-2", 300);
    expect(visits).toEqual([{ homeId: "a", count: 2, firstVisitedAt: 100, lastVisitedAt: 300, lastVisitId: "entry-2", visitIds: ["entry-1", "entry-2"] }]);
    expect(recordVisit(storage, "sean", "a", "entry-1", 400)).toEqual(visits);
    expect(readVisits(storage, "sean")).toEqual(visits);
    expect(readVisits(storage, "friend")).toEqual([]);
  });
  it("merges duplicate aggregate history without summing copies or dropping other homes", () => {
    const rows = [
      { homeId: "a", count: 2, firstVisitedAt: 100, lastVisitedAt: 200, lastVisitId: "first" },
      { homeId: "b", count: 1, firstVisitedAt: 50, lastVisitedAt: 50 },
      { homeId: "a", count: 3, firstVisitedAt: 120, lastVisitedAt: 300, lastVisitId: "last" },
    ];
    expect(normalizeVisits({ version: 1, visits: rows })).toEqual([
      { homeId: "a", count: 3, firstVisitedAt: 100, lastVisitedAt: 300, lastVisitId: "last", visitIds: ["first", "last"] }, rows[1],
    ]);
  });
  it("migrates legacy visit events by their event IDs and keeps their original payload", () => {
    const storage = new MemoryStorage();
    const raw = JSON.stringify([
      { homeId: "a", visitId: "first", visitedAt: 100 },
      { homeId: "a", visitId: "first", visitedAt: 100 },
      { homeId: "a", visitId: "second", visitedAt: 200 },
    ]);
    storage.setItem(visitsKey("sean"), raw);
    expect(readVisits(storage, "sean")[0].count).toBe(2);
    expect(recordVisit(storage, "sean", "a", "third", 300)[0].count).toBe(3);
    expect(storage.getItem(`${visitsKey("sean")}.backup`)).toBe(raw);
    expect(JSON.parse(storage.getItem(visitsKey("sean"))!).version).toBe(1);
  });
  it("validates malformed history without accepting unsafe counts or extra fields", () => {
    expect(normalizeVisits({ version: 1, visits: [null, {}, { homeId: "" }, { homeId: "a", count: -1, lastVisitedAt: Infinity, pin: "123456" }, { homeId: "b", count: 1.5 }] })).toEqual([
      { homeId: "a", count: 0, firstVisitedAt: 0, lastVisitedAt: 0 },
      { homeId: "b", count: 0, firstVisitedAt: 0, lastVisitedAt: 0 },
    ]);
    expect(normalizeVisits({ version: 99, visits: [{ homeId: "a", count: 2 }] })).toEqual([]);
  });
  it("does not count invalid admissions and keeps in-memory history when storage is unavailable", () => {
    const first = recordVisit(undefined, "sean", "a", "first", 100);
    const second = recordVisit(undefined, "sean", "a", "second", 200, first);
    expect(second[0].count).toBe(2);
    expect(recordVisit(undefined, "sean", "", "bad", 300, second)).toEqual(second);
    expect(recordVisit(undefined, "sean", "a", "", 300, second)).toEqual(second);
  });
  it("preserves history when backup or update cannot be stored", () => {
    const storage = new MemoryStorage();
    const raw = JSON.stringify([{ homeId: "a", count: 2 }]);
    storage.setItem(visitsKey("sean"), raw);
    storage.setItem = () => { throw Error("Quota"); };
    expect(recordVisit(storage, "sean", "a", "third", 300)[0].count).toBe(3);
    expect(storage.getItem(visitsKey("sean"))).toBe(raw);
  });
});
