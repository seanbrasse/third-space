import { randomUUID } from "node:crypto";
import { voicePair, VOICE_OFF, type VoiceContext, type VoicePeer, type VoiceSettings, type VoiceState, type VoiceToken } from "@third-space/contracts";
import type { VoiceProvider, ProviderParticipant } from "./voice-provider";

export interface AdmittedVoicePeer { player: VoicePeer; sessionId: string; accessValid: boolean }
export interface VoiceRoomView { peers: AdmittedVoicePeer[]; context: VoiceContext }
type Lease = { userId: string; sessionId: string; identity: string; grantedPublish: boolean; version: number; signature: string; changedAt: number; ackVersion: number; ackAt: number; joinedAt: number };
const publishing = (peer: VoicePeer) => peer.nativeMode === "enabled";
const microphone = (track: NonNullable<ProviderParticipant["tracks"]>[number]) =>
  (track.type === "AUDIO" || track.type === 0) && (track.source === "MICROPHONE" || track.source === 2);

async function completeBatch(operations: Promise<void>[]) {
  const results = await Promise.allSettled(operations);
  if (results.some(result => result.status === "rejected")) throw new Error("Voice service request failed.");
}

/** Admission and policy are backend-owned. The SFU enforces each publisher's ACL. */
export class RoomVoiceService {
  private leases = new Map<string, Lease>();
  private participants: ProviderParticipant[] = [];
  private priorPairs = new Set<string>();
  private lastList = -Infinity;
  private running = false;
  private stopped = false;
  private fault = false;
  private created = false;
  private joining = new Set<string>();
  private lastJoin = new Map<string, number>();
  constructor(readonly mediaRoom: string, private provider: VoiceProvider | null, private url: string,
    private view: () => VoiceRoomView, private emit: (userId: string, state: VoiceState) => void) {}
  get available() { return !!this.provider && !this.fault && !this.stopped; }
  private active(id: string, sessionId: string) {
    return this.view().peers.slice(0, 8).find(p => p.player.id === id && p.sessionId === sessionId && p.accessValid && p.player.connected);
  }
  async join(userId: string, sessionId: string, requestId: string): Promise<VoiceToken> {
    if (!this.available || !this.provider) throw new Error("Native voice needs an approved and verified media service.");
    const admitted = this.active(userId, sessionId);
    if (!admitted || admitted.player.nativeMode === "off") throw new Error("Enter this room and choose a voice mode first.");
    if (this.joining.has(userId) || Date.now() - (this.lastJoin.get(userId) ?? 0) < 1000) throw new Error("Please wait before retrying voice.");
    this.joining.add(userId); this.lastJoin.set(userId, Date.now());
    try {
      if (!this.created) { await this.provider.create(this.mediaRoom); this.created = true; }
      const old = this.leases.get(userId);
      if (old) { await this.provider.remove(this.mediaRoom, old.identity); this.leases.delete(userId); }
      const current = this.active(userId, sessionId);
      if (!this.available || !current || current.player.nativeMode === "off") throw new Error("Room admission ended.");
      const identity = `${userId}:${randomUUID()}`, now = Date.now();
      this.leases.set(userId, { userId, sessionId, identity, grantedPublish: false, version: 0, signature: "", changedAt: now, ackVersion: -1, ackAt: 0, joinedAt: now });
      this.lastList = -Infinity;
      // Initial publishing is denied until the connected publisher installs its ACL.
      return { requestId, url: this.url, token: this.provider.token(this.mediaRoom, identity, false), identity, expiresAt: now + 30000 };
    } finally { this.joining.delete(userId); }
  }
  acknowledge(userId: string, sessionId: string, identity: string, version: number, now = Date.now()) {
    const lease = this.leases.get(userId);
    if (lease && lease.sessionId === sessionId && lease.identity === identity && lease.version === version && this.active(userId, sessionId)) {
      lease.ackVersion = version; lease.ackAt = now;
    }
  }
  /** 500ms policy updates, 2s provider roster; no overlapping or queued frame work. */
  async sync(now = Date.now()) {
    if (this.running || !this.available || !this.provider || !this.created) return;
    this.running = true;
    try {
      this.publishStates(now);
      for (const userId of this.lastJoin.keys()) if (!this.view().peers.some(p => p.player.id === userId)) this.lastJoin.delete(userId);
      if (now - this.lastList >= 2000) { this.participants = (await this.provider.list(this.mediaRoom)).slice(0, 9); this.lastList = now; }
      // Independent participant calls run together: eight slow requests must not
      // turn one 2s provider deadline into a 16s privacy-watchdog delay.
      const invalid = this.participants.filter(participant =>
        ![...this.leases.values()].some(l => l.identity === participant.identity) ||
        (participant.tracks ?? []).some(t => !microphone(t)) || (participant.tracks?.length ?? 0) > 1);
      await completeBatch(invalid.map(async participant => {
        await this.provider!.remove(this.mediaRoom, participant.identity);
        const lease = [...this.leases.values()].find(l => l.identity === participant.identity);
        if (lease) this.leases.delete(lease.userId);
      }));
      await completeBatch([...this.leases.values()].map(async lease => {
        const peer = this.active(lease.userId, lease.sessionId);
        const initialExpired = !lease.ackAt && now - lease.joinedAt > 8000;
        const heartbeatExpired = !!lease.ackAt && now - lease.ackAt > 2500;
        const changeExpired = lease.ackVersion !== lease.version && now - lease.changedAt > 2500 && !!lease.ackAt;
        if (!peer || peer.player.nativeMode === "off" || initialExpired || heartbeatExpired || changeExpired) {
          await this.provider!.remove(this.mediaRoom, lease.identity);
          if (this.leases.get(lease.userId) === lease) this.leases.delete(lease.userId);
          return;
        }
        const present = this.participants.some(p => p.identity === lease.identity);
        const publish = publishing(peer.player) && (lease.grantedPublish || (lease.ackVersion === lease.version && !!lease.ackAt));
        if (present && publish !== lease.grantedPublish) {
          await this.provider!.permissions(this.mediaRoom, lease.identity, publish); lease.grantedPublish = publish;
        }
      }));
      this.participants = this.participants.filter(p => [...this.leases.values()].some(l => l.identity === p.identity));
      this.publishStates(now);
      // The provider expires empty rooms after 30s. Avoid deleting a room while
      // another admitted peer is finishing an asynchronous join.
      if (!this.leases.size && !this.joining.size) { this.created = false; this.participants = []; this.priorPairs.clear(); }
    } catch {
      // Never fall back to allow-all ACL or client volume as the privacy boundary.
      this.fault = true; await this.provider.delete(this.mediaRoom).catch(() => {}); this.publishStates(now);
    } finally { this.running = false; }
  }
  publishStates(now = Date.now()) {
    const view = this.view(), pairs = new Set<string>();
    for (const peer of view.peers.slice(0, 8)) {
      const lease = this.leases.get(peer.player.id);
      const receive: VoiceState["receive"] = [], heardBy: string[] = [], publishTo: string[] = [];
      if (this.available && lease && this.active(lease.userId, lease.sessionId)) {
        for (const other of view.peers.slice(0, 8)) {
          const remote = this.leases.get(other.player.id);
          if (!remote || !this.active(remote.userId, remote.sessionId)) continue;
          const incomingKey = `${remote.identity}>${lease.identity}`, outgoingKey = `${lease.identity}>${remote.identity}`;
          const incoming = voicePair(other.player, peer.player, view.context, this.priorPairs.has(incomingKey));
          if (incoming > 0) { pairs.add(incomingKey); receive.push({ id: other.player.id, identity: remote.identity, gain: incoming }); }
          if (voicePair(peer.player, other.player, view.context, this.priorPairs.has(outgoingKey)) > 0) {
            pairs.add(outgoingKey); publishTo.push(remote.identity); heardBy.push(other.player.id);
          }
        }
        const signature = [...publishTo].sort().join("|");
        if (signature !== lease.signature || !lease.version) { lease.signature = signature; lease.version++; lease.changedAt = now; }
      }
      const settings: VoiceSettings = this.available ? { nativeMode: peer.player.nativeMode, manualMute: peer.player.manualMute, deafened: peer.player.deafened } : { ...VOICE_OFF };
      this.emit(peer.player.id, { available: this.available, reason: this.available ? undefined : "Native voice is unavailable. Text and game sounds remain available.",
        settings, receive, heardBy, identity: lease?.identity ?? "", policyVersion: lease?.version ?? 0, publishTo });
    }
    this.priorPairs = pairs;
  }
  async dispose() { this.stopped = true; this.leases.clear(); this.lastJoin.clear(); this.priorPairs.clear(); if (this.created) await this.provider?.delete(this.mediaRoom).catch(() => {}); }
}
