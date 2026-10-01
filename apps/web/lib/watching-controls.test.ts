import { describe, expect, it } from "vitest";
import { playFromUserGesture } from "./watching-controls";

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
