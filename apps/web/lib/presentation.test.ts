import { describe, expect, it } from "vitest";
import { cameraFollowX, decayCorrection } from "./presentation";
describe("predicted presentation", () => {
  it("follows every rendered position between snapshots, clamping only the map edges", () => {
    const camera = Array.from({ length: 7 }, (_, i) =>
      cameraFollowX(600 + i * 3.2, 11520, 800),
    );
    for (let i = 1; i < camera.length; i++)
      expect(camera[i] - camera[i - 1]).toBeCloseTo(3.2);
    expect(cameraFollowX(0, 11520, 800)).toBe(400);
    expect(cameraFollowX(11520, 11520, 800)).toBe(11120);
  });
  it("decays a reconciliation correction independently of frame rate", () => {
    let at60 = 20,
      at30 = 20;
    for (let i = 0; i < 60; i++) at60 = decayCorrection(at60, 1000 / 60);
    for (let i = 0; i < 30; i++) at30 = decayCorrection(at30, 1000 / 30);
    expect(at60).toBeCloseTo(at30, 10);
    expect(Math.abs(at60)).toBeLessThan(0.003);
    expect(decayCorrection(20, 16, true)).toBe(0);
  });
});
