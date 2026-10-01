import { describe, expect, it } from "vitest";
import { voiceGroup, voicePair, voiceGain, type VoicePeer, type VoiceContext } from "./voice-policy";
const peer = (id: string, overrides: Partial<VoicePeer> = {}): VoicePeer => ({ id, x: 0, y: 0, mode: "home", connected: true, nativeMode: "enabled", manualMute: false, deafened: false, ...overrides });
const context: VoiceContext = { worldRevision: 3, mode: "proximity", race: { id: "race", phase: "lobby", joinedIds: [] } };
describe("authoritative voice policy", () => {
  it("fades near to distant voices with cutoff hysteresis", () => {
    expect(voicePair(peer("a"), peer("b", { x: 2 }), context)).toBe(1);
    expect(voicePair(peer("a"), peer("b", { x: 7 }), context)).toBeCloseTo(.5);
    expect(voicePair(peer("a"), peer("b", { x: 11.7 }), context)).toBe(0);
    expect(voicePair(peer("a"), peer("b", { x: 11.7 }), context, true)).toBeGreaterThan(0);
    expect(voicePair(peer("a"), peer("b", { x: 12 }), context, true)).toBe(0);
  });
  it("isolates arbitrary interiors and active races, independent of safe areas", () => {
    expect(voicePair(peer("a"), peer("b", { zone: "asylum" }), context)).toBe(0);
    expect(voicePair(peer("a", { zone: "wizard-hut" as any }), peer("b", { zone: "wizard-hut" as any }), context)).toBe(1);
    expect(voicePair(peer("a"), peer("b", { mode: "race" }), context)).toBe(0);
    expect(voiceGroup(peer("a"), context)).toBe("home:3:outside");
  });
  it("whole-room includes independently distant players and interiors/races", () => {
    expect(voicePair(peer("a"), peer("b", { zone: "asylum", mode: "race", x: 1000 }), { ...context, mode: "room" })).toBe(1);
  });
  it("waiting lobby bridges outdoor campers but excludes interiors", () => {
    const waiting = { ...context, race: { ...context.race, phase: "waiting" as const, joinedIds: ["b"] } };
    expect(voicePair(peer("a"), peer("b", { mode: "race", x: 100 }), waiting)).toBe(1);
    expect(voicePair(peer("a", { zone: "asylum" }), peer("b", { mode: "race" }), waiting)).toBe(0);
  });
  it.each([{ connected: false }, { manualMute: true }, { deafened: true }, { nativeMode: "off" as const }, { nativeMode: "listen" as const }])("does not forward an inactive/muted source %j", flags => {
    expect(voicePair(peer("a", flags), peer("b"), { ...context, mode: "room" })).toBe(0);
  });
  it("listen receives but deafen/off/self do not", () => {
    expect(voicePair(peer("a"), peer("b", { nativeMode: "listen" }), context)).toBe(1);
    expect(voicePair(peer("a"), peer("b", { deafened: true }), context)).toBe(0);
    expect(voicePair(peer("a"), peer("a"), context)).toBe(0);
    expect(voiceGain(NaN)).toBe(0);
  });
});
