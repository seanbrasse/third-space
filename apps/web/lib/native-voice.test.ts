import { afterEach, describe, expect, it, vi } from "vitest";
import { NativeVoice, micError, type VoiceDependencies, type VoiceUIState } from "./native-voice";
import { RoomEvent } from "livekit-client";
import type { VoiceState } from "@third-space/contracts";
function fixture() {
  const events = new Map<string, (...args: any[]) => void>();
  const track = { stop: vi.fn(), mute: vi.fn(async () => {}), unmute: vi.fn(async () => {}), mediaStreamTrack: { addEventListener: vi.fn() } };
  const room = { state: "connected", remoteParticipants: new Map(), canPlaybackAudio: true,
    localParticipant: { identity: "self:lease", permissions: { canPublish: true }, publishTrack: vi.fn(async () => {}), setTrackSubscriptionPermissions: vi.fn() },
    connect: vi.fn(async () => {}), disconnect: vi.fn(async () => {}), removeAllListeners: vi.fn(), startAudio: vi.fn(async () => {}), on: (event: string, fn: (...args: any[]) => void) => events.set(event, fn) };
  const states: VoiceUIState[] = [], token = vi.fn(async () => ({ requestId: "test", url: "wss://example", token: "fixture", identity: "self:lease", expiresAt: Date.now() + 30000 }));
  const deps = { createRoom: vi.fn(() => room), capture: vi.fn(async () => track), devices: vi.fn(async () => []) } as unknown as VoiceDependencies;
  const ack = vi.fn(); const voice = new NativeVoice(token, state => states.push(state), deps, ack);
  const policy: VoiceState = { available: true, settings: { nativeMode: "enabled", manualMute: false, deafened: false }, identity: "self:lease", policyVersion: 1, publishTo: ["friend:lease"], receive: [], heardBy: [] };
  return { voice, room, track, deps, events, states, token, ack, policy };
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("native voice lifecycle", () => {
  it("listen-only connects without capturing or publishing a microphone", async () => {
    const f = fixture(); await f.voice.start("listen");
    expect(f.deps.capture).not.toHaveBeenCalled(); expect(f.room.localParticipant.publishTrack).not.toHaveBeenCalled();
    expect(f.states.at(-1)!.microphone).toBe("off"); f.voice.stop();
  });
  it("captures on explicit enable and installs deny-all before publishing", async () => {
    const f = fixture(); await f.voice.start("enabled");
    expect(f.deps.capture).toHaveBeenCalledTimes(1); expect(f.room.localParticipant.setTrackSubscriptionPermissions).toHaveBeenCalledWith(false, []);
    expect(f.room.localParticipant.setTrackSubscriptionPermissions.mock.invocationCallOrder[0]).toBeLessThan(f.room.localParticipant.publishTrack.mock.invocationCallOrder[0]!);
    f.voice.stop(); expect(f.track.stop).toHaveBeenCalledTimes(1);
  });
  it("denied permission never requests a token or joins the provider", async () => {
    const f = fixture(); vi.mocked(f.deps.capture).mockRejectedValue({ name: "NotAllowedError" }); await f.voice.start("enabled");
    expect(f.token).not.toHaveBeenCalled(); expect(f.deps.createRoom).not.toHaveBeenCalled(); expect(f.states.at(-1)!.error).toContain("permission was denied");
  });
  it("cancelled pending permission cannot later publish or leak a track", async () => {
    const f = fixture(); let resolve!: (track: any) => void;
    vi.mocked(f.deps.capture).mockImplementation(() => new Promise(r => { resolve = r; }));
    const pending = f.voice.start("enabled"); f.voice.stop(); resolve(f.track); await pending;
    expect(f.track.stop).toHaveBeenCalledTimes(1); expect(f.token).not.toHaveBeenCalled();
  });
  it("ignores a stale token completion after room leave", async () => {
    const f = fixture(); let resolve!: (token: any) => void;
    f.token.mockImplementation(() => new Promise(r => { resolve = r; }));
    const pending = f.voice.start("listen"); await Promise.resolve(); f.voice.stop(); resolve({ identity: "old" }); await pending;
    expect(f.deps.createRoom).not.toHaveBeenCalled();
  });
  it("versions ACLs, rejects old updates and defaults deny on stale state", async () => {
    vi.useFakeTimers(); const f = fixture(); await f.voice.start("listen"); f.voice.updateState({ ...f.policy, policyVersion: 2 });
    expect(f.ack).toHaveBeenCalledWith("self:lease", 2);
    f.voice.updateState({ ...f.policy, policyVersion: 1, publishTo: ["rogue"] });
    expect(f.room.localParticipant.setTrackSubscriptionPermissions).not.toHaveBeenCalledWith(false, [{ participantIdentity: "rogue", allowAll: true }]);
    f.voice.checkFreshness(Date.now() + 2001); expect(f.room.localParticipant.setTrackSubscriptionPermissions).toHaveBeenLastCalledWith(false, []); f.voice.stop();
  });
  it("deafen mutes microphone; reconnect defaults deny and reuses one room", async () => {
    const f = fixture(); await f.voice.start("enabled"); f.voice.setSettings({ nativeMode: "enabled", manualMute: false, deafened: true });
    expect(f.states.at(-1)!.microphone).toBe("muted");
    f.events.get(RoomEvent.Reconnecting)!(); expect(f.room.localParticipant.setTrackSubscriptionPermissions).toHaveBeenLastCalledWith(false, []);
    f.events.get(RoomEvent.Reconnected)!(); expect(f.deps.createRoom).toHaveBeenCalledTimes(1); f.voice.stop();
  });
  it("provider disconnect closes capture and requires explicit retry", async () => {
    const f = fixture(); await f.voice.start("enabled"); f.events.get(RoomEvent.Disconnected)!();
    expect(f.track.stop).toHaveBeenCalled(); expect(f.states.at(-1)!.phase).toBe("error"); expect(f.deps.capture).toHaveBeenCalledTimes(1);
  });
  it.each(["NotFoundError", "NotReadableError", "SecurityError"])("reports actionable %s device errors", name => { expect(micError({ name })).not.toBe(micError({ name: "unknown" })); });
});
