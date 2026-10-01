import { describe, it, expect } from "vitest";
import { buildRoomInvite, parseRoomInvite } from "./room-invite";
const uuid = "12345678-1234-1234-1234-123456789abc";
describe("PIN invite fragments", () => {
  it("keeps PIN out of HTTP query/path and parses short aliases case-insensitively", () => {
    const value = buildRoomInvite("https://camp.example/some?secret=bad", "Pine", "123456");
    const url = new URL(value);
    expect(url.pathname).toBe("/"); expect(url.search).toBe("");
    expect(parseRoomInvite(url.hash)).toEqual({ home: "pine", pin: "123456" });
  });
  it("preserves legacy UUID and token invites without preferring supplied PIN", () => {
    expect(parseRoomInvite(`#home=${uuid}&invite=Token_AbC&pin=123456`)).toEqual({ home: uuid, inviteToken: "Token_AbC" });
    expect(parseRoomInvite(new URL(buildRoomInvite("https://camp.example", uuid, "654321")).hash)).toEqual({ home: uuid, pin: "654321" });
  });
  it("rejects malformed home IDs, long aliases, credentials and incomplete invitations", () => {
    for (const fragment of ["#home=eightchr&pin=123456", "#home=pine&pin=123", "#home=pine", "#pin=123456", "#home=../pine&pin=123456"]) expect(parseRoomInvite(fragment)).toBeNull();
    expect(() => buildRoomInvite("https://camp.example", "pine", "abc")).toThrow();
  });
});
