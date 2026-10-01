import { GAME_CONFIG } from "@third-space/config";
import type { NativeMode, PlayerState, RaceState, VoiceMode } from "./index";

export interface VoiceContext {
  worldRevision: number;
  race: Pick<RaceState, "id" | "phase" | "joinedIds">;
  mode: VoiceMode;
}
export type VoicePeer = Pick<PlayerState, "id" | "x" | "y" | "mode" | "zone" | "connected" | "nativeMode" | "manualMute" | "deafened">;
export interface VoiceSettings { nativeMode: NativeMode; manualMute: boolean; deafened: boolean }
/** Sent privately over the admitted game socket; contains no provider credentials. */
export interface VoiceState {
  identity: string;
  policyVersion: number;
  publishTo: string[];
  available: boolean;
  reason?: string;
  settings: VoiceSettings;
  receive: { id: string; identity: string; gain: number }[];
  heardBy: string[];
}
export interface VoiceToken { requestId: string; url: string; token: string; identity: string; expiresAt: number }
export const VOICE_OFF: VoiceSettings = { nativeMode: "off", manualMute: false, deafened: false };

/** Stable shared area key. Personal zoneRevision must never partition a conversation. */
export function voiceGroup(peer: VoicePeer, context: VoiceContext): string {
  if (context.race.phase === "waiting" && !peer.zone &&
      (peer.mode === "home" || context.race.joinedIds?.includes(peer.id))) return `waiting:${context.race.id}`;
  return peer.mode === "race" ? `race:${context.race.id}` : `home:${context.worldRevision}:${peer.zone ?? "outside"}`;
}
export function voiceGain(distance: number): number {
  if (!Number.isFinite(distance)) return 0;
  const t = Math.max(0, Math.min(1, (distance - GAME_CONFIG.voiceFullGainDistance) /
    (GAME_CONFIG.voiceCutoffDistance - GAME_CONFIG.voiceFullGainDistance)));
  return 1 - t * t * (3 - 2 * t);
}
/** Whole-room is explicitly party-wide, including interiors and active races. */
export function voicePair(source: VoicePeer, listener: VoicePeer, context: VoiceContext, prior = false): number {
  if (source.id === listener.id || !source.connected || !listener.connected ||
      source.nativeMode !== "enabled" || source.manualMute || source.deafened ||
      listener.nativeMode === "off" || listener.deafened) return 0;
  if (context.mode === "room") return 1;
  if (voiceGroup(source, context) !== voiceGroup(listener, context)) return 0;
  if (voiceGroup(source, context).startsWith("waiting:")) return 1;
  const distance = Math.hypot(source.x - listener.x, source.y - listener.y);
  if (!Number.isFinite(distance) || distance >= (prior ? GAME_CONFIG.voiceCutoffDistance : GAME_CONFIG.voiceSubscribeDistance)) return 0;
  return voiceGain(distance);
}
