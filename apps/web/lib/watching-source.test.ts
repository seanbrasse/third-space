import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import SharedWatching from "../components/SharedWatching";
import type { Snapshot } from "./types";

function render(url: string, expanded = true, queue: string[] = []) {
  const snapshot = {
    worldId: "asylum", serverTime: 1,
    players: [{ id: "self", mode: "home", x: 10, y: 10 }],
    media: { url, playbackId: url, playing: true, revision: 4, queue: queue.map((url, i) => ({ id: String(i), url })) },
  } as unknown as Snapshot;
  const sent: unknown[] = [];
  const html = renderToStaticMarkup(createElement(SharedWatching, {
    snapshot, getSnapshot: () => snapshot, selfId: "self", expanded,
    onExpand: () => {}, send: (v) => sent.push(v),
  }));
  return { html, sent };
}
describe("authoritative watching source presentation", () => {
  it("hydrates the current source and queue without populating or submitting the draft", () => {
    const url = "https://youtu.be/M7lc1UVf-VE", queued = "https://example.com/next.mp4";
    const { html, sent } = render(url, true, [queued]);
    expect(html).toContain(`href="${url}"`);
    expect(html).toContain('class="active-video-link"');
    expect(html).toContain('aria-label="Video link"');
    expect(html).toMatch(/aria-label="Video link"[^>]*value=""/);
    expect(html).toContain("Replace current video");
    expect(html).toContain("Add to queue");
    expect(html).toContain(queued);
    expect(sent).toEqual([]);
  });
  it("opening or rendering a newer authoritative source never sends a replacement", () => {
    for (const url of ["https://youtu.be/M7lc1UVf-VE", "https://example.com/current.mp4"]) {
      expect(render(url, false).sent).toEqual([]);
      const { html, sent } = render(url);
      expect(html).toContain(`href="${url}"`);
      expect(sent).toEqual([]);
    }
  });
  it("an empty screen offers initial loading rather than replacing a nonexistent source", () => {
    const { html, sent } = render("");
    expect(html).toContain("Load for everyone");
    expect(html).not.toContain("Now watching:");
    expect(sent).toEqual([]);
  });
});
