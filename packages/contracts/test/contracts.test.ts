import { describe, expect, it } from "vitest";
import {
  AvatarSchema,
  CommandSchema,
  DEFAULT_AVATAR,
  DisplayNameSchema,
  InputSchema,
  parseCommand,
} from "../src/index";

describe("untrusted protocol validation", () => {
  it("accepts movement intent and rejects position injection, nonfinite numbers and unbounded input", () => {
    expect(
      InputSchema.safeParse({ seq: 5, axisX: 1, axisY: -1, jump: false })
        .success,
    ).toBe(true);
    for (const bad of [
      { seq: 5, axisX: Infinity, axisY: 0, jump: false },
      { seq: 5, axisX: 1.01, axisY: 0, jump: false },
      { seq: -1, axisX: 0, axisY: 0, jump: false },
      { seq: 5, axisX: 0, axisY: 0, jump: false, x: 77 },
    ])
      expect(InputSchema.safeParse(bad).success).toBe(false);
  });
  it("requires server-assigned chat identity and a retry command ID", () => {
    expect(
      parseCommand({ type: "chat.send", commandId: "retry-1", text: " hi " }),
    ).toEqual({ type: "chat.send", commandId: "retry-1", text: "hi" });
    expect(parseCommand({ type: "chat.send", text: "hi" })).toBeNull();
    expect(
      parseCommand({
        type: "chat.send",
        commandId: "retry-1",
        text: "hi",
        senderId: "host",
      }),
    ).toBeNull();
  });
  it("limits graphemes rather than splitting emoji and rejects empty/control-only messages", () => {
    const message = (text: string) =>
      CommandSchema.safeParse({ type: "chat.send", commandId: "1", text });
    expect(message("👨‍👩‍👧‍👦".repeat(280)).success).toBe(true);
    expect(message("a".repeat(281)).success).toBe(false);
    expect(message("  ").success).toBe(false);
    expect(message("hello\u0000").success).toBe(false);
  });
  it("rejects client-provided finish times and unknown social assets", () => {
    expect(parseCommand({ type: "race.finish", elapsedMs: 2 })).toBeNull();
    expect(
      parseCommand({ type: "sound", assetId: "arbitrary-url" }),
    ).toBeNull();
    expect(
      parseCommand({ type: "emote", assetId: "dance", targetId: "friend" }),
    ).toEqual({ type: "emote", assetId: "dance", targetId: "friend" });
  });
  it("requires explicit independent audio state", () => {
    expect(
      parseCommand({
        type: "voice.status",
        nativeMode: "listen",
        manualMute: true,
        deafened: false,
      }),
    ).not.toBeNull();
    expect(
      parseCommand({ type: "voice.status", nativeMode: "enabled" }),
    ).toBeNull();
  });
});

describe("profile validation", () => {
  it("accepts only approved cosmetic IDs and a six digit color", () => {
    expect(AvatarSchema.safeParse(DEFAULT_AVATAR).success).toBe(true);
    expect(
      AvatarSchema.safeParse({
        ...DEFAULT_AVATAR,
        accessory: "https://bad.test/image",
      }).success,
    ).toBe(false);
    expect(
      AvatarSchema.safeParse({ ...DEFAULT_AVATAR, color: "red" }).success,
    ).toBe(false);
  });
  it("normalizes legacy avatars while retaining independent color selections", () => {
    const legacy = {color: "#a1744c", hair: "curly", outfit: "tee", accessory: "glasses"};
    expect(AvatarSchema.parse(legacy)).toEqual({...legacy, skinColor: legacy.color, hairColor: "#635044", clothingColor: "#6c8364", trouserColor: "#52627a"});
    const customized = {...DEFAULT_AVATAR, skinColor: "#513429", hairColor: "#d5b96e", clothingColor: "#b16e67", trouserColor: "#73816b"};
    expect(AvatarSchema.parse(customized)).toEqual(customized);
    for (const field of ["skinColor", "hairColor", "clothingColor", "trouserColor"]) {
      expect(AvatarSchema.safeParse({...customized, [field]: "red"}).success).toBe(false);
    }
  });
  it("validates trimmed grapheme names without control characters", () => {
    expect(DisplayNameSchema.parse("  Nova  ")).toBe("Nova");
    expect(DisplayNameSchema.safeParse("🌿".repeat(24)).success).toBe(true);
    expect(DisplayNameSchema.safeParse("👨‍👩‍👧‍👦".repeat(24)).success).toBe(true);
    expect(DisplayNameSchema.safeParse("🌿".repeat(25)).success).toBe(false);
    expect(DisplayNameSchema.safeParse("Nova\nHost").success).toBe(false);
  });
});
