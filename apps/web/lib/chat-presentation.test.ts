import { describe, expect, it } from "vitest";
import { chatTime, chatTextMetrics } from "./chat-presentation";
describe("accepted chat timestamp presentation", () => {
  const accepted = Date.UTC(2026, 9, 1, 2, 15, 30);
  it("uses authority time with full accessible date and local clock", () => {
    expect(chatTime(accepted, "en-US", "America/New_York")).toEqual({ iso: "2026-10-01T02:15:30.000Z", short: "10:15 PM", full: "Wednesday, September 30, 2026 at 10:15:30 PM EDT" });
  });
  it("does not mutate timestamp across history, reconnect or locale", () => {
    const history = { createdAt: accepted };
    expect(chatTime(history.createdAt, "en-GB", "UTC")?.short).toBe("2:15");
    expect(chatTime(JSON.parse(JSON.stringify(history)).createdAt, "en-US", "America/New_York")?.iso).toBe(chatTime(accepted)?.iso);
    expect(history.createdAt).toBe(accepted);
  });
  it.each([NaN, Infinity, 0, -1, 1e20])("rejects invalid or absent time %s", time => expect(chatTime(time)).toBeNull());
});
describe("chat text independent from sprite filtering", () => {
  it.each([1,2])("holds screen font size at DPR %s through fractional camera zoom", dpr => {
    for (const zoom of [.4,.75,1,1.3,2]) {
      const m=chatTextMetrics(dpr,zoom);
      expect(m.scale*zoom).toBeCloseTo(1);
      expect(m.resolution).toBe(2);
    }
  });
  it("bounds texture memory and handles unavailable DPR/zoom",()=>{
    expect(chatTextMetrics(10,1)).toEqual({resolution:4,scale:1});
    expect(chatTextMetrics(NaN,0)).toEqual({resolution:2,scale:1});
  });
});
