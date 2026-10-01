export type ReleaseEntry = {
  id: string;
  status: "published" | "draft";
  date: string | null;
  dateKind: "release" | "merge" | "source";
  title: string;
  changes: string[];
};
export type PublishedRelease = Omit<ReleaseEntry, "status" | "date"> & { date: string };
export type ReleaseHistory = { schemaVersion: 1; entries: ReleaseEntry[] };

// A day-only release appears before timed records on that day; its time is unknown.
export function releaseSortKey(date: string): string {
  return date.length === 10 ? `${date}T23:59:59Z` : date;
}
function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}Z)?$/.test(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && (value.length === 10
    ? parsed.toISOString().slice(0, 10) === value
    : parsed.toISOString() === value.replace("Z", ".000Z"));
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const plainText = (value: unknown, max: number): value is string => typeof value === "string" && value.trim() === value && value.length > 0 && value.length <= max;

/** Used at build time and by release checks. Unknown keys fail, avoiding accidental metadata exposure. */
export function validateReleaseHistory(value: unknown, now = new Date()): asserts value is ReleaseHistory {
  if (!object(value) || value.schemaVersion !== 1 || !Array.isArray(value.entries) || Object.keys(value).some(key => !["schemaVersion", "entries"].includes(key)))
    throw new Error("Release history must use schemaVersion 1 and an entries array");
  const ids = new Set<string>();
  let previous = "9999";
  for (const entry of value.entries) {
    if (!object(entry) || Object.keys(entry).sort().join(",") !== "changes,date,dateKind,id,status,title" ||
      !plainText(entry.id, 64) || !/^[a-z0-9-]+$/.test(entry.id) || ids.has(entry.id) ||
      !["published", "draft"].includes(String(entry.status)) || !["release", "merge", "source"].includes(String(entry.dateKind)) ||
      !plainText(entry.title, 100) || !Array.isArray(entry.changes) || entry.changes.length === 0 || entry.changes.length > 8 || !entry.changes.every(change => plainText(change, 400)))
      throw new Error(`Invalid release entry: ${String(entry?.id ?? "unknown")}`);
    ids.add(entry.id);
    if (entry.status === "draft") {
      if (entry.date !== null || entry.dateKind !== "release") throw new Error(`Draft ${entry.id} must have date null and dateKind release`);
      continue;
    }
    if (!validDate(entry.date) || (entry.date.length === 10
      ? entry.date > now.toISOString().slice(0, 10)
      : Date.parse(entry.date) > now.valueOf())) throw new Error(`Invalid or future published date: ${entry.id}`);
    const key = releaseSortKey(entry.date);
    if (key > previous) throw new Error(`Published history must be newest first: ${entry.id}`);
    previous = key;
  }
}

/** Strip draft copy and publication metadata before crossing the server/client boundary. */
export function publishedReleases(value: unknown): PublishedRelease[] {
  validateReleaseHistory(value);
  return value.entries.flatMap(entry => entry.status === "published" && entry.date
    ? [{ id: entry.id, date: entry.date, dateKind: entry.dateKind, title: entry.title, changes: entry.changes }]
    : []);
}
export function formatReleaseDate(entry: Pick<PublishedRelease, "date" | "dateKind">): string {
  const date = new Date(entry.date);
  const day = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(date);
  const label = { release: "Released", merge: "Merged", source: "Source recorded" }[entry.dateKind];
  return entry.date.length === 10 ? `${label} ${day} · day only` : `${label} ${day} at ${entry.date.slice(11, 19)} UTC`;
}
