import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { RoomVoiceService, type VoiceRoomView } from "../../apps/game-server/src/voice-service";
import { LiveKitVoiceProvider, voiceConfig } from "../../apps/game-server/src/voice-provider";
import type { VoiceProvider } from "../../apps/game-server/src/voice-provider";
import type { VoiceState } from "@third-space/contracts";
const view = (): VoiceRoomView => ({ context: { mode: "proximity", worldRevision: 0, race: { id: "race", phase: "lobby" } }, peers: ["a", "b"].map((id, i) => ({ sessionId: `tab-${id}`, accessValid: true,
  player: { id, x: i, y: 0, mode: "home", nativeMode: "enabled", manualMute: false, deafened: false, connected: true } })) });
function fixture() {
  const state = view(), states = new Map<string, VoiceState>();
  const provider: VoiceProvider = { token: vi.fn(() => "test-token"), create: vi.fn(async () => {}), list: vi.fn(async () => []), permissions: vi.fn(async () => {}), remove: vi.fn(async () => {}), delete: vi.fn(async () => {}) };
  const service = new RoomVoiceService("home:epoch", provider, "wss://media.example", () => state, (id, s) => states.set(id, s));
  return { state, states, provider, service };
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(100000); });
afterEach(() => vi.useRealTimers());
describe("voice admission and ACL watchdog", () => {
  it("rejects nonadmitted, stale tab, revoked and off peers before provider calls", async () => {
    const f = fixture();
    await expect(f.service.join("outsider", "tab", "req")).rejects.toThrow();
    await expect(f.service.join("a", "old-tab", "req")).rejects.toThrow();
    f.state.peers[0]!.accessValid = false; await expect(f.service.join("a", "tab-a", "req")).rejects.toThrow();
    f.state.peers[0]!.accessValid = true; f.state.peers[0]!.player.nativeMode = "off";
    await expect(f.service.join("a", "tab-a", "req")).rejects.toThrow();
    expect(f.provider.create).not.toHaveBeenCalled();
  });
  it("rechecks admission after an in-flight create", async () => {
    const f = fixture(); let finish!: () => void;
    vi.mocked(f.provider.create).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const pending = f.service.join("a", "tab-a", "req"); f.state.peers[0]!.sessionId = "replacement"; finish();
    await expect(pending).rejects.toThrow("Room admission ended"); expect(f.provider.token).not.toHaveBeenCalled();
  });
  it("issues initial no-publish tokens; only current policy ack grants publishing", async () => {
    const f = fixture(), a = await f.service.join("a", "tab-a", "a"), b = await f.service.join("b", "tab-b", "b");
    expect(f.provider.token).toHaveBeenCalledWith("home:epoch", a.identity, false);
    vi.mocked(f.provider.list).mockResolvedValue([{ identity: a.identity }, { identity: b.identity }]);
    await f.service.sync();
    const policy = f.states.get("a")!; expect(policy.publishTo).toEqual([b.identity]);
    f.service.acknowledge("a", "wrong-tab", a.identity, policy.policyVersion);
    await f.service.sync(); expect(f.provider.permissions).not.toHaveBeenCalled();
    f.service.acknowledge("a", "tab-a", a.identity, policy.policyVersion); await f.service.sync();
    expect(f.provider.permissions).toHaveBeenCalledWith("home:epoch", a.identity, true);
  });
  it("versions near/far changes and removes an unresponsive publisher", async () => {
    const f = fixture(), a = await f.service.join("a", "tab-a", "a"), b = await f.service.join("b", "tab-b", "b");
    vi.mocked(f.provider.list).mockResolvedValue([{ identity: a.identity }, { identity: b.identity }]);
    await f.service.sync(); const first = f.states.get("a")!;
    f.service.acknowledge("a", "tab-a", a.identity, first.policyVersion);
    f.state.peers[1]!.player.x = 50; f.service.publishStates(); const far = f.states.get("a")!;
    expect(far.policyVersion).toBeGreaterThan(first.policyVersion); expect(far.publishTo).toEqual([]);
    f.service.acknowledge("a", "tab-a", a.identity, first.policyVersion); // stale ack cannot extend lease
    vi.setSystemTime(103001); await f.service.sync(); expect(f.provider.remove).toHaveBeenCalledWith("home:epoch", a.identity);
  });
  it.each(["revoke", "disconnect", "replace", "off"])("removes %s immediately at next controller tick", async action => {
    const f = fixture(), a = await f.service.join("a", "tab-a", "a");
    vi.mocked(f.provider.list).mockResolvedValue([{ identity: a.identity }]);
    if (action === "revoke") f.state.peers[0]!.accessValid = false;
    if (action === "disconnect") f.state.peers[0]!.player.connected = false;
    if (action === "replace") f.state.peers[0]!.sessionId = "replacement";
    if (action === "off") f.state.peers[0]!.player.nativeMode = "off";
    await f.service.sync(); expect(f.provider.remove).toHaveBeenCalledWith("home:epoch", a.identity);
  });
  it("removes rogue provider identities and excessive/nonmicrophone tracks", async () => {
    const f = fixture(), a = await f.service.join("a", "tab-a", "a");
    vi.mocked(f.provider.list).mockResolvedValue([{ identity: "rogue" }, { identity: a.identity, tracks: [{ sid: "video", type: "VIDEO", source: "CAMERA" }] }]);
    await f.service.sync(); expect(f.provider.remove).toHaveBeenCalledWith("home:epoch", "rogue"); expect(f.provider.remove).toHaveBeenCalledWith("home:epoch", a.identity);
  });
  it("bounds an eight-user room to seven recipients and removes expired leases concurrently", async () => {
    const f = fixture();
    f.state.peers = Array.from({ length: 9 }, (_, i) => ({ sessionId: `tab-${i}`, accessValid: true,
      player: { id: String(i), x: 0, y: 0, mode: "home" as const, nativeMode: "enabled" as "enabled" | "off",
        connected: true, manualMute: false, deafened: false } }));
    const tokens = await Promise.all(f.state.peers.slice(0, 8).map(p => f.service.join(p.player.id, p.sessionId, "req")));
    await expect(f.service.join("8", "tab-8", "req")).rejects.toThrow();
    vi.mocked(f.provider.list).mockResolvedValue(tokens.map(t => ({ identity: t.identity })));
    f.service.publishStates(); expect(f.states.get("0")!.publishTo).toHaveLength(7);
    for (const peer of f.state.peers) peer.player.nativeMode = "off";
    const finished: (() => void)[] = [];
    vi.mocked(f.provider.remove).mockImplementation(() => new Promise(resolve => finished.push(resolve)));
    const pending = f.service.sync();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(finished).toHaveLength(8); // All removals start before any slow call completes.
    for (const finish of finished) finish(); await pending;
  });
  it("never regrants a replaced identity from stale acknowledgement", async () => {
    const f = fixture(), old = await f.service.join("a", "tab-a", "old");
    vi.mocked(f.provider.list).mockResolvedValue([{ identity: old.identity }]); await f.service.sync();
    const oldPolicy = f.states.get("a")!;
    vi.setSystemTime(101100); f.state.peers[0]!.sessionId = "new-tab";
    const current = await f.service.join("a", "new-tab", "new");
    f.service.publishStates();
    f.service.acknowledge("a", "tab-a", old.identity, oldPolicy.policyVersion);
    f.service.acknowledge("a", "new-tab", old.identity, f.states.get("a")!.policyVersion);
    vi.mocked(f.provider.list).mockResolvedValue([{ identity: old.identity }, { identity: current.identity }]);
    vi.setSystemTime(103200); await f.service.sync();
    expect(f.provider.permissions).not.toHaveBeenCalled();
    expect(f.states.get("a")!.identity).toBe(current.identity);
    expect(f.provider.remove).toHaveBeenCalledWith("home:epoch", old.identity);
  });
  it("does not overlap provider requests and fails closed on service outage", async () => {
    const f = fixture(); await f.service.join("a", "tab-a", "a"); let reject!: (error: Error) => void;
    vi.mocked(f.provider.list).mockImplementation(() => new Promise((_resolve, r) => { reject = r; }));
    const pending = f.service.sync(); await f.service.sync(); expect(f.provider.list).toHaveBeenCalledTimes(1);
    reject(new Error("private provider body")); await pending;
    expect(f.service.available).toBe(false); expect(f.provider.delete).toHaveBeenCalled(); expect(f.states.get("a")!.receive).toEqual([]);
  });
});
describe("provider configuration and token grants", () => {
  it("defaults off and allows ws only on nonproduction loopback", () => {
    expect(voiceConfig({})).toBeNull();
    const env = { VOICE_ENABLED: "true", VOICE_PRIVACY_VERIFIED: "true", LIVEKIT_URL: "ws://127.0.0.1:7880", LIVEKIT_API_KEY: "test", LIVEKIT_API_SECRET: "fixture" };
    expect(voiceConfig(env)).not.toBeNull(); expect(voiceConfig({ ...env, NODE_ENV: "production" })).toBeNull();
    expect(voiceConfig({ ...env, LIVEKIT_URL: "ws://media.example" })).toBeNull();
  });
  it("requires explicit verified token revocation for production", () => {
    const env = { NODE_ENV: "production", VOICE_ENABLED: "true", VOICE_PRIVACY_VERIFIED: "true",
      LIVEKIT_URL: "wss://media.example", LIVEKIT_API_KEY: "test", LIVEKIT_API_SECRET: "fixture" };
    expect(voiceConfig(env)).toBeNull();
    expect(voiceConfig({ ...env, LIVEKIT_STRICT_REVOCATION_VERIFIED: "true" })?.strictRevocation).toBe(true);
  });
  it("uses an explicit future second cutoff to reject even same-second refreshed Cloud tokens", async () => {
    const request = vi.fn(async () => ({ ok: true, json: async () => ({}) })) as unknown as typeof fetch;
    const provider = new LiveKitVoiceProvider({ url: "wss://media.example", key: "fixture", secret: "fixture", strictRevocation: true }, request);
    await provider.remove("home:epoch", "user:old-lease");
    const call = vi.mocked(request).mock.calls[0]!;
    expect(JSON.parse(call[1]!.body as string)).toEqual({ room: "home:epoch", identity: "user:old-lease", revoke_token_ts: 101 });
  });
  it("has a 30s room-bound microphone-only token without admin/data grants", () => {
    const provider = new LiveKitVoiceProvider({ url: "wss://media.example", key: "fixture", secret: "fixture" });
    const token = provider.token("home:epoch", "user:lease", false), claims = JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString());
    expect(claims.sub).toBe("user:lease"); expect(claims.exp - claims.iat).toBe(30);
    expect(claims.video).toMatchObject({ room: "home:epoch", roomJoin: true, canPublish: false, canPublishSources: ["microphone"], canPublishData: false });
    expect(claims.video.roomAdmin).toBeUndefined();
  });
});
