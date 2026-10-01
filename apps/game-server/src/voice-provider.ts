import { createHmac } from "node:crypto";

export interface VoiceConfig { url: string; key: string; secret: string }
export function voiceConfig(env: NodeJS.ProcessEnv = process.env): VoiceConfig | null {
  // Verification is an operator attestation AFTER the adversarial provider probe.
  if (env.VOICE_ENABLED !== "true" || env.VOICE_PRIVACY_VERIFIED !== "true" ||
      !env.LIVEKIT_URL || !env.LIVEKIT_API_KEY || !env.LIVEKIT_API_SECRET) return null;
  try {
    const url = new URL(env.LIVEKIT_URL);
    const local = env.NODE_ENV !== "production" && url.protocol === "ws:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
    if ((!local && url.protocol !== "wss:") || url.username || url.password || url.search || url.hash || url.pathname !== "/") return null;
    return { url: url.origin, key: env.LIVEKIT_API_KEY, secret: env.LIVEKIT_API_SECRET };
  } catch { return null; }
}
export function voiceJwt(config: VoiceConfig, identity: string | undefined, video: Record<string, unknown>, now = Date.now()) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const at = Math.floor(now / 1000);
  const body = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ iss: config.key, sub: identity, iat: at, nbf: at - 5, exp: at + 30, video })}`;
  return `${body}.${createHmac("sha256", config.secret).update(body).digest("base64url")}`;
}
export interface ProviderParticipant { identity: string; tracks?: { sid: string; type?: string | number; source?: string | number; muted?: boolean }[] }
export interface VoiceProvider {
  token(room: string, identity: string, publish: boolean): string;
  create(room: string): Promise<void>;
  list(room: string): Promise<ProviderParticipant[]>;
  permissions(room: string, identity: string, publish: boolean): Promise<void>;
  remove(room: string, identity: string): Promise<void>;
  delete(room: string): Promise<void>;
}
export class LiveKitVoiceProvider implements VoiceProvider {
  constructor(private config: VoiceConfig, private request: typeof fetch = fetch) {}
  token(room: string, identity: string, publish: boolean) {
    return voiceJwt(this.config, identity, { roomJoin: true, room, canSubscribe: true,
      canPublish: publish, canPublishSources: ["microphone"], canPublishData: false, canUpdateOwnMetadata: false });
  }
  private async call(method: string, room: string, body: Record<string, unknown>) {
    const response = await this.request(`${this.config.url.replace(/^wss:/, "https:").replace(/^ws:/, "http:")}/twirp/livekit.RoomService/${method}`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${voiceJwt(this.config, undefined, { room, roomAdmin: true, roomCreate: true, roomList: true })}` },
      body: JSON.stringify(body), signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      if (error.code === "not_found" && ["RemoveParticipant", "DeleteRoom"].includes(method)) return {};
      throw new Error("Voice service request failed."); // Never echo provider response/token/config.
    }
    return response.json();
  }
  async create(room: string) { await this.call("CreateRoom", room, { name: room, max_participants: 8, empty_timeout: 30, departure_timeout: 10 }); }
  async list(room: string): Promise<ProviderParticipant[]> { return (await this.call("ListParticipants", room, { room })).participants ?? []; }
  async permissions(room: string, identity: string, publish: boolean) {
    await this.call("UpdateParticipant", room, { room, identity, permission: { can_subscribe: true, can_publish: publish, can_publish_data: false, can_publish_sources: [2], can_update_metadata: false } });
  }
  async remove(room: string, identity: string) { await this.call("RemoveParticipant", room, { room, identity }); }
  async delete(room: string) { await this.call("DeleteRoom", room, { room }); }
}
