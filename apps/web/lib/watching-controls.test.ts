import { describe, expect, it } from "vitest";
import { playFromUserGesture, sharedPlaybackPosition } from "./watching-controls";

describe("device playback activation", () => {
  it("resumes synchronously inside the gesture before sending a shared play command", () => {
    const calls: string[] = [];
    playFromUserGesture(false, () => calls.push("local play"), () => calls.push("room play"));
    expect(calls).toEqual(["local play", "room play"]);
  });
  it("enables a blocked or late-joining device without restarting or pausing its friends", () => {
    const calls: string[] = [];
    playFromUserGesture(true, () => calls.push("local play"), () => calls.push("room play"));
    expect(calls).toEqual(["local play"]);
  });
});

describe("device recovery position", () => {
  it("a device-only enable never overrides a newer shared pause", () => {
    const calls: string[] = [];
    playFromUserGesture(false, () => calls.push("local play"), () => calls.push("room play"), true);
    expect(calls).toEqual(["local play"]);
  });
  it("catches up to room time after a delayed autoplay unlock", () => {
    expect(sharedPlaybackPosition({ position: 12, playing: true, anchorAt: 1000 }, 61000)).toBe(72);
  });
  it("preserves a shared pause and never subtracts for a future anchor", () => {
    expect(sharedPlaybackPosition({ position: 12, playing: false, anchorAt: 1000 }, 61000)).toBe(12);
    expect(sharedPlaybackPosition({ position: 12, playing: true, anchorAt: 61000 }, 1000)).toBe(12);
  });
});
