import { z } from "zod";
import {
  ACCESSORY_IDS,
  EMOTE_IDS,
  GAME_CONFIG,
  HAIR_IDS,
  OUTFIT_IDS,
  SOUND_IDS,
} from "@third-space/config";

export { EMOTE_IDS, SOUND_IDS } from "@third-space/config";
export const PROTOCOL_VERSION = GAME_CONFIG.protocolVersion;
const HexColorSchema = z.string().regex(/^#[a-fA-F0-9]{6}$/);
export const AvatarSchema = z
  .object({
    color: HexColorSchema,
    skinColor: HexColorSchema.optional(),
    hairColor: HexColorSchema.default("#635044"),
    clothingColor: HexColorSchema.default("#6c8364"),
    trouserColor: HexColorSchema.default("#52627a"),
    hair: z.enum(HAIR_IDS),
    outfit: z.enum(OUTFIT_IDS),
    accessory: z.enum(ACCESSORY_IDS),
  })
  .strict()
  .transform((avatar) => ({...avatar, skinColor: avatar.skinColor ?? avatar.color}));
export type AvatarConfig = z.infer<typeof AvatarSchema>;
export const DEFAULT_AVATAR: AvatarConfig = {
  color: "#dfb391",
  skinColor: "#dfb391",
  hairColor: "#635044",
  clothingColor: "#6c8364",
  trouserColor: "#52627a",
  hair: "short",
  outfit: "hoodie",
  accessory: "none",
};

export const NativeModeSchema = z.enum(["off", "listen", "enabled"]);
export const VoiceModeSchema = z.enum(["proximity", "room"]);
export type NativeMode = z.infer<typeof NativeModeSchema>;
export type VoiceMode = z.infer<typeof VoiceModeSchema>;
export type Facing = "up" | "down" | "left" | "right";

export interface PlayerState {
  id: string;
  name: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: Facing;
  mode: "home" | "race";
  flashlightOn?: boolean;
  roastingAt?: number;
  respawnCount?: number;
  haloUntil?: number;
  avatar: AvatarConfig;
  nativeMode: NativeMode;
  manualMute: boolean;
  deafened: boolean;
  connected: boolean;
  lastInputSeq: number;
  checkpoint: number;
  finishedAt?: number;
  seatId?: string;
  grounded?: boolean;
  jumpHeld?: boolean;
  coyoteTime?: number;
  jumpBuffer?: number;
  respawnTimer?: number;
}

export const InputSchema = z
  .object({
    seq: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    axisX: z.number().finite().min(-1).max(1),
    axisY: z.number().finite().min(-1).max(1),
    jump: z.boolean(),
  })
  .strict();
export type PlayerInput = z.infer<typeof InputSchema>;
export type Input = PlayerInput;

const IdSchema = z.string().min(1).max(128);
const CommandIdSchema = z.string().min(1).max(128);
const ChatTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(4_096)
  .refine(
    (text) =>
      [
        ...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(
          text,
        ),
      ].length <= GAME_CONFIG.maxChatLength,
    "Chat is limited to 280 characters",
  )
  .refine(
    (text) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(text),
    "Invalid control characters",
  );

export const CommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("input.stop") }).strict(),
  z.object({ type: z.literal("input"), input: InputSchema, worldRevision: z.number().int().min(0).optional(), lifeRevision: z.number().int().min(0).optional() }).strict(),
  z
    .object({
      type: z.literal("chat.send"),
      commandId: CommandIdSchema,
      text: ChatTextSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("emote"),
      assetId: z.enum(EMOTE_IDS),
      targetId: IdSchema.optional(),
    })
    .strict(),
  z.object({ type: z.literal("social.accept"), proposalId: IdSchema }).strict(),
  z.object({ type: z.literal("sound"), assetId: z.enum(SOUND_IDS) }).strict(),
  z.object({ type: z.literal("sound.enabled"), enabled: z.boolean() }).strict(),
  z.object({ type: z.literal("seat"), seatId: IdSchema.nullable() }).strict(),
  z
    .object({
      type: z.literal("voice.status"),
      nativeMode: NativeModeSchema,
      manualMute: z.boolean(),
      deafened: z.boolean(),
    })
    .strict(),
  z.object({ type: z.literal("voice.mode"), mode: VoiceModeSchema }).strict(),
  z.object({ type: z.literal("race.ready"), ready: z.boolean() }).strict(),
  z.object({ type: z.literal("race.start") }).strict(),
  z.object({ type: z.literal("race.return") }).strict(),
  z.object({ type: z.literal("world.propose"), worldId: z.enum(["living-room","forest"]), commandId: CommandIdSchema, revision: z.number().int().min(0) }).strict(),
  z.object({ type: z.literal("world.object"), proposalId: IdSchema }).strict(),
  z.object({ type: z.literal("flashlight"), enabled: z.boolean() }).strict(),
  z.object({ type: z.literal("roast"), enabled: z.boolean() }).strict(),
  z.object({ type: z.literal("media.control"), commandId: CommandIdSchema, revision: z.number().int().min(0), action: z.enum(["play","pause","seek","source"]), position: z.number().finite().min(0).max(86400).optional(), url: z.string().url().max(2048).optional() }).strict(),
  z.object({ type: z.literal("session.replace") }).strict(),
]);
export type ClientCommand = z.infer<typeof CommandSchema>;
export type Command = ClientCommand;

export interface ChatMessage {
  id: string;
  commandId?: string;
  senderId: string;
  senderName: string;
  text: string;
  seq: number;
  createdAt: number;
}
export interface SocialEffect {
  id: string;
  type: "emote" | "sound" | "proposal";
  sourceId: string;
  targetId?: string;
  assetId: string;
  x: number;
  y: number;
  startTime: number;
  expiresAt: number;
}
export interface RaceResult {
  playerId: string;
  name: string;
  rank: number | null;
  finishedAt: number | null;
  elapsedMs: number | null;
  dnf: boolean;
  reason?: "timeout" | "disconnected" | "returned";
}
export interface RaceState {
  id: string;
  phase: "lobby" | "countdown" | "running" | "results";
  startAt: number;
  endAt: number;
  readyIds: string[];
  results: RaceResult[];
}
export interface WorldProposal { id: string; commandId: string; proposerId: string; worldId: "living-room" | "forest"; startAt: number; endsAt: number; }
export interface SharedMedia { revision: number; url: string; playing: boolean; position: number; anchorAt: number; }
export interface ForestStalker {id:string;x:number;y:number;targetId:string;coverId:string;phase:"peek"|"chase"|"retreat";startedAt:number;phaseUntil:number;}
export interface RoomSnapshot {
  stalker?: ForestStalker | null;
  homeId: string;
  worldId: "living-room" | "forest";
  worldRevision: number;
  worldProposal: WorldProposal | null;
  media: SharedMedia;
  instanceId: string;
  epoch: string;
  serverTime: number;
  players: PlayerState[];
  voiceMode: VoiceMode;
  hostId: string | null;
  soundboardEnabled: boolean;
  chat: ChatMessage[];
  race: RaceState | null;
}
export type Snapshot = RoomSnapshot;
export interface ServerNotice {
  code: string;
  message: string;
  commandId?: string;
  retryAfterMs?: number;
}
export interface ServerMessageMap {
  snapshot: RoomSnapshot;
  chat: ChatMessage;
  effect: SocialEffect;
  notice: ServerNotice;
}
export interface BoardNote {
  id: string;
  homeId: string;
  authorId: string;
  authorLabel: string;
  text: string;
  link: string | null;
  x: number;
  y: number;
  revision: number;
  createdAt: number;
  updatedAt: number;
}

export const DisplayNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(1_024)
  .refine(
    (text) =>
      [
        ...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(
          text,
        ),
      ].length <= 24,
    "Name is limited to 24 characters",
  )
  .refine((text) => !/[\u0000-\u001F\u007F]/.test(text), "Invalid name");

export function parseCommand(value: unknown): ClientCommand | null {
  const result = CommandSchema.safeParse(value);
  return result.success ? result.data : null;
}
