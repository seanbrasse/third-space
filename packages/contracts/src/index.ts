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
  zone?: "asylum";
  zoneRevision?: number;
  flashlightBattery?: number;
  flashlightOn?: boolean;
  roastingAt?: number;
  respawnCount?: number;
  caughtAt?: number;
  /** Server-selected creature responsible for this catch, for local presentation. */
  caughtBy?: "clown" | "werewolf" | "mimic";
  respawnAt?: number;
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
  sprintUntil?: number;
  sprintReadyAt?: number;
  lastSprintPress?: number;
  coyoteTime?: number;
  jumpBuffer?: number;
  respawnTimer?: number;
  raceSpeedBoostSeconds?: number;
  raceJumpBoostSeconds?: number;
  racePickupIds?: string[];
  raceJumpCount?: number;
  raceDeathCount?: number;
  racePickupCount?: number;
}

export const InputSchema = z
  .object({
    seq: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    axisX: z.number().finite().min(-1).max(1),
    axisY: z.number().finite().min(-1).max(1),
    jump: z.boolean(),
    sprint: z.boolean().optional(),
    sprintPress: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
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
  z.object({ type: z.literal("presence.activity") }).strict(),
  z.object({ type: z.literal("presence.stay") }).strict(),
  z.object({ type: z.literal("presence.watching"), playbackId: IdSchema }).strict(),
  z.object({ type: z.literal("input.stop") }).strict(),
  z.object({ type: z.literal("input"), input: InputSchema, worldRevision: z.number().int().min(0).optional(), lifeRevision: z.number().int().min(0).optional(), zoneRevision: z.number().int().min(0).optional() }).strict(),
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
  z.object({ type: z.literal("race.enter") }).strict(),
  z.object({ type: z.literal("race.return") }).strict(),
  z.object({ type: z.literal("world.propose"), worldId: z.enum(["living-room","forest"]), commandId: CommandIdSchema, revision: z.number().int().min(0) }).strict(),
  z.object({ type: z.literal("world.object"), proposalId: IdSchema }).strict(),
  z.object({type:z.literal("area.enter"),area:z.enum(["asylum","forest"])}).strict(),
  z.object({ type: z.literal("flashlight"), enabled: z.boolean() }).strict(),
  z.object({ type: z.literal("roast"), enabled: z.boolean() }).strict(),
  z.object({ type: z.literal("media.control"), commandId: CommandIdSchema, revision: z.number().int().min(0), action: z.enum(["play","pause","seek","source","queue.add","queue.remove","next","ended"]), position: z.number().finite().min(0).max(86400).optional(), url: z.string().url().max(2048).optional(), itemId:IdSchema.optional(), playbackId:IdSchema.optional() }).strict(),
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
  phase: "lobby" | "waiting" | "countdown" | "running" | "results";
  startAt: number;
  endAt: number;
  joinedIds?: string[];
  readyIds: string[];
  results: RaceResult[];
}
export interface WorldProposal { id: string; commandId: string; proposerId: string; worldId: "living-room" | "forest"; startAt: number; endsAt: number; }
export interface SharedMedia { playbackId?:string; revision: number; url: string; playing: boolean; position: number; anchorAt: number; queue?: {id:string;url:string;addedBy:string;start?:number}[]; }
export interface WorldSoundEvent {epoch?:string;worldRevision?:number;id:string;kind:"giggle"|"slash"|"howl"|"growl"|"claw"|"mimic-roar"|"mimic-hit";x:number;y:number;createdAt:number;expiresAt:number;victimId?:string;}
export interface ForestMimicState {kind:"mimic";id:string;x:number;y:number;originX:number;originY:number;coverId:string;targetId:string;disguisePlayerId:string;disguise:AvatarConfig;phase:"approach"|"morph"|"chase"|"retreat";startedAt:number;phaseUntil:number;transformed:boolean;}
export interface ForestStalker {greeting?:{id:string;text:string;shownAt:number;until:number};leap?:{phase:"windup"|"air";startedAt:number;until:number;fromX:number;fromY:number;toX:number;toY:number};kind?:"werewolf";intent?:"hunt"|"perimeter";originX?:number;originY?:number;giggleAt?:number;id:string;x:number;y:number;targetId:string;coverId:string;phase:"peek"|"chase"|"retreat";startedAt:number;phaseUntil:number;}
export interface RoomSnapshot {
  /** Recipient-only authoritative idle deadline; never a client-provided timestamp. */
  idle?: { warningAt: number; kickAt: number };
  stalker?: ForestStalker | null;
  werewolf?: ForestStalker | null;
  mimic?: ForestMimicState | null;
  homeId: string;
  rootWorldId?: "living-room" | "forest";
  worldId: "living-room" | "forest" | "asylum";
  worldRevision: number;
  worldProposal: WorldProposal | null;
  media: SharedMedia;
  instanceId: string;
  epoch: string;
  serverTime: number;
  members?: PlayerState[];
  players: PlayerState[];
  voiceMode: VoiceMode;
  voiceScope?: { instanceId: string; participantIds: string[]; mode: VoiceMode };
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
  "world.sound": WorldSoundEvent;
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
