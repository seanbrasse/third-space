import { describe, expect, it } from "vitest";
import history from "../../../releases/history.json";
import { formatReleaseDate, publishedReleases, validateReleaseHistory } from "./release-history";
import { GameKeyboard, gameHotkey, inventoryHotkey, shouldOpenChat } from "./game-keyboard";
const entry = { id: "test", status: "published", date: "2026-09-30T21:29:55Z", dateKind: "merge", title: "A change", changes: ["A useful change."] };
const catalog = (changes = {}): unknown => ({ schemaVersion: 1, entries: [{ ...entry, ...changes }] });

describe("public release history", () => {
  it("validates the complete backfill, newest first, without exposing drafts", () => {
    validateReleaseHistory(history);
    const publicEntries = publishedReleases(history);
    expect(publicEntries.length).toBeGreaterThanOrEqual(33);
    expect(publicEntries.map(entry => entry.id)).toContain("living-world");
    expect(publicEntries.map(entry => entry.id)).toContain("history-032");
    expect(publicEntries.at(-1)?.date).toBe("2026-09-30T21:29:55Z");
    expect(JSON.stringify(publicEntries)).not.toMatch(/"status"|"draft"/);
    for (const draft of history.entries.filter(entry => entry.status === "draft")) {
      expect(publicEntries.map(entry => entry.id)).not.toContain(draft.id);
      expect(JSON.stringify(publicEntries)).not.toContain(draft.title);
    }
  });
  it("handles an empty or entirely unpublished history", () => {
    expect(publishedReleases({ schemaVersion: 1, entries: [] })).toEqual([]);
    expect(publishedReleases(catalog({ status: "draft", date: null, dateKind: "release" }))).toEqual([]);
  });
  it.each(["2026-02-30", "2026-13-01", "2026-09-30T25:00:00Z", "2026-09-30T12:00:00-04:00", "yesterday", null])("rejects ambiguous or impossible dates %s", date => {
    expect(() => validateReleaseHistory(catalog({ date }))).toThrow();
  });
  it("rejects future published dates, dated drafts, duplicates, unknown fields and unsupported schema", () => {
    expect(() => validateReleaseHistory(catalog({ date: "2027-01-01" }), new Date("2026-10-01T12:00:00Z"))).toThrow(/future/);
    expect(() => validateReleaseHistory(catalog({ date: "2026-10-01T13:00:00Z" }), new Date("2026-10-01T12:00:00Z"))).toThrow(/future/);
    expect(() => validateReleaseHistory(catalog({ status: "draft" }))).toThrow(/Draft/);
    expect(() => validateReleaseHistory({ schemaVersion: 1, entries: [entry, entry] })).toThrow();
    expect(() => validateReleaseHistory(catalog({ internalReport: "private" }))).toThrow();
    expect(() => validateReleaseHistory({ schemaVersion: 2, entries: [] })).toThrow();
    expect(() => validateReleaseHistory(catalog({ changes: [] }))).toThrow();
  });
  it("rejects out-of-order entries and places day-only releases first on their day without inventing a time", () => {
    const later = { ...entry, id: "later", date: "2026-10-01T03:00:00Z" };
    expect(() => validateReleaseHistory({ schemaVersion: 1, entries: [entry, later] })).toThrow(/newest first/);
    const dateOnly = { ...entry, id: "day", date: "2026-10-01", dateKind: "release" };
    expect(() => validateReleaseHistory({ schemaVersion: 1, entries: [dateOnly, later, entry] })).not.toThrow();
  });
  it("distinguishes release, source and merge dates with timezone-stable precise labels", () => {
    expect(formatReleaseDate({ date: "2026-10-01", dateKind: "release" })).toBe("Released 1 October 2026 · day only");
    expect(formatReleaseDate({ date: "2026-09-30T21:29:55Z", dateKind: "source" })).toBe("Source recorded 30 September 2026 at 21:29:55 UTC");
    expect(formatReleaseDate({ date: "2026-10-01T03:00:00Z", dateKind: "merge" })).toContain("Merged 1 October 2026 at 03:00:00 UTC");
  });
  it("footer ownership prevents game movement, inventory, flashlight and chat activation", () => {
    const target = { closest: (selector: string) => selector.includes('[data-game-input="off"]') ? {} : null } as unknown as EventTarget;
    const event = { target, key: " ", code: "Space", repeat: false, altKey: false, ctrlKey: false, metaKey: false, defaultPrevented: false };
    const keyboard = new GameKeyboard();
    expect(keyboard.keydown(event, false)).toBe(false);
    expect(keyboard.keydown({ ...event, key: "w", code: "KeyW" }, false)).toBe(false);
    expect(gameHotkey({ ...event, code: "KeyF" }, false)).toBeNull();
    expect(inventoryHotkey({ ...event, code: "Digit1" }, false)).toBeNull();
    expect(shouldOpenChat({ ...event, key: "Enter" }, false)).toBe(false);
    expect(keyboard.read().axisY).toBe(0);
  });
});

it("renders an accessible collapsed disclosure and useful empty state without records", async () => {
  const { createRequire } = await import("node:module");
  const require = createRequire(new URL("../package.json", import.meta.url));
  const { createElement } = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const { default: ReleaseUpdates } = await import("../components/ReleaseUpdates");
  const html = renderToStaticMarkup(createElement(ReleaseUpdates, { entries: [] }));
  expect(html).toContain('aria-expanded="false"');
  expect(html).toContain('role="region"');
  expect(html).toContain('hidden=""');
  expect(html).toContain("No published updates yet");
  expect(html).not.toContain("<article");
});
