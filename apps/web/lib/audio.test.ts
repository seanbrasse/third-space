import { afterEach, describe, expect, it, vi } from "vitest";
import { SoundboardAudio } from "./audio";
import { listenerGain, readPersonVolumes } from "./person-volume";
import type { Effect, Snapshot } from "./types";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("listener audio preferences", () => {
  it("multiplies master, person and spatial attenuation, preserving mute and cutoff", () => {
    expect(listenerGain(0.8, 0.5, 6, false)).toBeCloseTo(0.026);
    expect(listenerGain(1, 1, 12, false)).toBe(0);
    expect(listenerGain(1, 1, 0, true)).toBe(0);
    expect(listenerGain(1, 0, 0, false)).toBe(0);
    expect(listenerGain(3, 3, 0, false)).toBeCloseTo(0.13);
  });
  it("safely migrates old saves and bounds malformed or unbounded volume preferences", () => {
    expect(readPersonVolumes(undefined)).toEqual({});
    expect(
      readPersonVolumes({
        friend: -2,
        other: 2,
        invalid: "loud",
        "bad key": 0,
      }),
    ).toEqual({ friend: 0, other: 1, invalid: 1 });
    expect(
      Object.keys(
        readPersonVolumes(
          Object.fromEntries(
            Array.from({ length: 250 }, (_, i) => [`friend-${i}`, 0.5]),
          ),
        ),
      ),
    ).toHaveLength(200);
  });
  it("updates an active person's gain without changing another person's sound or the fade envelope", async () => {
    vi.useFakeTimers();
    const gains: {
      gain: {
        value: number;
        setValueAtTime: ReturnType<typeof vi.fn>;
        exponentialRampToValueAtTime: ReturnType<typeof vi.fn>;
      };
      connect: ReturnType<typeof vi.fn>;
      disconnect: ReturnType<typeof vi.fn>;
    }[] = [];
    const node = () => ({ connect: vi.fn(), disconnect: vi.fn() });
    class FakeContext {
      state = "running";
      currentTime = 0;
      destination = {};
      resume = vi.fn(async () => {});
      close = vi.fn(async () => {});
      createGain() {
        const gain = {
          ...node(),
          gain: {
            value: 0,
            setValueAtTime: vi.fn(),
            exponentialRampToValueAtTime: vi.fn(),
          },
        };
        gains.push(gain);
        return gain;
      }
      createStereoPanner() {
        return { ...node(), pan: { value: 0 } };
      }
      createOscillator() {
        return {
          ...node(),
          frequency: { value: 0 },
          start: vi.fn(),
          stop: vi.fn(),
        };
      }
    }
    vi.stubGlobal("AudioContext", FakeContext);
    vi.stubGlobal("window", { setTimeout });
    const audio = new SoundboardAudio();
    await audio.unlock();
    const snapshot = { players: [{ id: "self", x: 0, y: 0 }] } as Snapshot;
    const effect = (sourceId: string) =>
      ({ sourceId, x: 0, y: 0, assetId: "chime" }) as Effect;
    audio.setMix(1, { friend: 0.5 }, new Set());
    audio.play(effect("friend"), snapshot, "self");
    audio.play(effect("other"), snapshot, "self");
    expect(gains[0].gain.value).toBeCloseTo(0.065);
    expect(gains[2].gain.value).toBeCloseTo(0.13);
    audio.setMix(1, { friend: 0.25 }, new Set());
    expect(gains[0].gain.value).toBeCloseTo(0.0325);
    expect(gains[2].gain.value).toBeCloseTo(0.13);
    expect(gains[1].gain.exponentialRampToValueAtTime).toHaveBeenCalledTimes(1);
    audio.setMix(1, { friend: 0.25 }, new Set(), true);
    expect(gains[0].gain.value).toBe(0);
    expect(gains[2].gain.value).toBe(0);
    audio.setMix(1, { friend: 0.25 }, new Set(), false);
    expect(gains[2].gain.value).toBeCloseTo(0.13);
    audio.setMix(1, { friend: 0.25 }, new Set(["friend"]));
    expect(gains[0].gain.value).toBe(0);
    audio.play(effect("friend"), snapshot, "self");
    expect(gains).toHaveLength(4);
    vi.advanceTimersByTime(800);
    expect(gains[0].disconnect).toHaveBeenCalled();
    audio.dispose();
  });
});
