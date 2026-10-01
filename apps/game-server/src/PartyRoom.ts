import {SnapshotDeltaEncoder} from '../../../packages/contracts/src/snapshot-delta';
import { ForestNPCController } from './ForestNPCController';
import {createAuthoredForestNPCs} from './authored-forest-npcs';
import {FOREST_INTERIORS,WARD_CACHE_ANCHORS} from '../../../packages/config/src/authored-forest';
import {SharedForestStoryStore} from '../../../packages/data/src/forest-story-store';
import {STORY_RAIDERS,STORY_GUARDIAN,type ForestStoryEvent} from '../../../packages/simulation/src/forest-story';
import {canUseForestStory,canDiscussForestStory} from '../../../packages/simulation/src/forest-story-access';
import type {ForestStorySnapshot} from '../../../packages/contracts/src/forest-story';
import type {ForestNPC} from '../../../packages/contracts/src/forest-npc';
import {ForestCombatEncounters,type ForestCombatant} from './ForestCombatEncounters';
import {worldClimateAt} from './world-climate';
import {worldDayAt} from '../../../packages/contracts/src/world-climate';
import {AUTHORED_FOREST_NPCS,forestNpcDialogue} from '../../../packages/config/src/forest-cast';
import { RoomVoiceService } from "./voice-service";
import { LiveKitVoiceProvider, voiceConfig } from "./voice-provider";
import { createIdlePresence, recordActivity, recordWatching, idleStatus, type IdlePresence } from "./idle-policy";
import { ForestWerewolf } from "./ForestWerewolf";
import { createForestSurvival } from './survival-world';
import type { SurvivalResult } from './survival-inventory';
import { ForestMimic } from "./ForestMimic";
import { ForestEncounter } from "./ForestStalker";
import { stepFlashlight } from "./flashlight";
import { Room, ServerError, type Client } from "@colyseus/core";
import { randomUUID,createHash } from "node:crypto";
import { resolveMediaLink, CAMP_RACE_DOOR, ASYLUM_DOOR, GAME_CONFIG, HOME_MAP, RACE_MAP, getWorld, WORLD_COUNTDOWN_MS, type WorldId } from "@third-space/config";
import {
  parseCommand,
  voiceGroup,
  type ChatMessage,
  type ClientCommand,
  type PlayerInput,
  type PlayerState,
  type RaceResult,
  type RaceState,
  type RoomSnapshot,
  type SocialEffect,
  type VoiceMode,
  type WorldProposal,
  type SharedMedia,
  type WorldSoundEvent,
  DEFAULT_AVATAR,
} from "@third-space/contracts";
import {
  createPlayer,
  stepHome,
  cancelSprint,
  stepRace,
  resetRacePlayer,
  clearRaceBoosts,
  hasFinishedRace,
  respawnRacePlayer,
  overlapsPlayer,
  canUseFurniture,
  isHomeSegmentWalkable,
  isHomeWalkable,
} from "@third-space/simulation";
import type { LocalStore } from "@third-space/data";

type Admission = {
  userId: string;
  homeId: string;
  name: string;
  avatar: PlayerState["avatar"];
  role: string;
};
type Intent = { value: PlayerInput; receivedAt: number };
type Proposal = { effect: SocialEffect; mode: "home" | "race" };
const neutral = (seq = 0): PlayerInput => ({
  seq,
  axisX: 0,
  axisY: 0,
  jump: false,
});
const distance = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y);

/** One transport shell, with server-filtered independent home/race views. */
export class PartyRoom extends Room {
  static store: LocalStore;
  static activeHomes = new Set<string>();
  static liveRooms = new Map<string, PartyRoom>();
  private voice!: RoomVoiceService;
  homeId = "";
  worldId: "living-room" | "forest" = "forest";
  worldRevision = 0;
  worldProposal: WorldProposal | null = null;
  media: SharedMedia = {revision:0,url:"",playing:false,position:0,anchorAt:0};
  private story!:SharedForestStoryStore;
  private storyAuthority:ReturnType<SharedForestStoryStore['readAuthority']>;
  private inventoryRevisions=new Map<string,number>();
  private combat:ForestCombatEncounters|null=null;
  private nextStoryRetryAt=0;
  private keeperDialogue:ForestNPC['dialogue'];
  private survival = createForestSurvival(Math.random,(id,before,after,cause)=>this.persistApples(id,before,after,cause));
  private idlePresence = new Map<string, IdlePresence>();
  private areaCooldowns=new Map<string,number>();
  private indoorSpawnSeats=new Map<string,string>();
  private spawnSeats = new Map<string, string>();
  private acceptedWorldCommands = new Map<string,string>();
  private acceptedMediaCommands = new Set<string>();
  epoch = randomUUID();
  players = new Map<string, PlayerState>();
  clientsByUser = new Map<string, Client>();
  roles = new Map<string, string>();
  intents = new Map<string, Intent>();
  chats: Record<"home" | "race", ChatMessage[]> = { home: [], race: [] };
  voiceModes: Record<"home" | "race", VoiceMode> = {
    home: "proximity",
    race: "proximity",
  };
  soundboardEnabled = true;
  race: RaceState = {
    id: randomUUID(),
    phase: "lobby",
    startAt: 0,
    endAt: 0,
    readyIds: [],
    results: [],
  };
  private snapshotStreams = new Map<Client,{encoder:SnapshotDeltaEncoder<RoomSnapshot>;forceFull:boolean;resyncAt:number}>();
  private seq = 0;
  private tick = 0;
  private encounter: ForestEncounter | null = null;
  private werewolf: ForestWerewolf | null = null;
  private mimic: ForestMimic | null = null;
  private npcs: ForestNPCController | null = null;
  private lastNPCTick = 0;
  private accumulation = 0;
  private hostId: string | null = null;
  private windows = new Map<string, number[]>();
  private chatAcks = new Map<string, Map<string, ChatMessage>>();
  private cooldowns = new Map<string, number>();
  private proposals = new Map<string, Proposal>();
  private unbindAccess?: () => void;
  private unbindBoard?: () => void;

  onCreate(options: { homeId?: string }) {
    if (!options.homeId)
      throw new ServerError(400, "A private home is required.");
    const home = PartyRoom.store.getHome(options.homeId);
    if (!home) throw new ServerError(403, "Room access denied.");
    if (PartyRoom.activeHomes.has(options.homeId))
      throw new ServerError(
        409,
        "ROOM_FULL: This party is full or is currently admitting a participant.",
      );
    PartyRoom.activeHomes.add(options.homeId);
    this.homeId = options.homeId;
    this.story=new SharedForestStoryStore(PartyRoom.store.db,{canAccess:(homeId,userId)=>PartyRoom.store.canAccess(homeId,userId)});
    this.combat=new ForestCombatEncounters(getWorld('forest'));
    const mediaConfig = voiceConfig();
    this.voice = new RoomVoiceService(`third-space:${this.homeId}:${this.epoch}`,
      mediaConfig ? new LiveKitVoiceProvider(mediaConfig) : null, mediaConfig?.url ?? "",
      () => ({ context: { worldRevision: this.worldRevision, race: this.race, mode: this.voiceModes.home },
        peers: [...this.players.values()].map(player => ({ player, sessionId: this.clientsByUser.get(player.id)?.sessionId ?? "",
          accessValid: PartyRoom.store.canAccess(this.homeId, player.id) })) }),
      (id, state) => { try { this.clientsByUser.get(id)?.send("voice.state", state); } catch { /* A closing socket cannot disrupt other voice peers. */ } });
    this.onMessage("voice.join", (client, raw: unknown) => {
      const id = (client.auth as Admission)?.userId;
      const requestId = (raw as { requestId?: unknown })?.requestId;
      if (typeof requestId !== "string" || !/^[a-zA-Z0-9-]{1,64}$/.test(requestId) ||
          this.clientsByUser.get(id) !== client || !this.players.get(id)?.connected ||
          !PartyRoom.store.canAccess(this.homeId, id) || !this.cooled(id, "voice.join", 1000)) return;
      void this.voice.join(id, client.sessionId, requestId).then(token => {
        if (this.clientsByUser.get(id) === client && this.players.get(id)?.connected && PartyRoom.store.canAccess(this.homeId, id)) {
          try { client.send("voice.token", token); } catch { /* Lease watchdog cleans up an undeliverable token. */ }
        }
      }).catch(() => {
        if (this.clientsByUser.get(id) !== client || !this.players.get(id)?.connected) return;
        try { client.send("voice.token", { requestId, error: "Voice is unavailable. Check room access and media setup, then retry." }); } catch { /* Transport has closed. */ }
      });
    });
    this.onMessage("voice.policy.ack", (client, raw: unknown) => {
      const id = (client.auth as Admission)?.userId;
      const ack = raw as { identity?: unknown; version?: unknown };
      if (this.clientsByUser.get(id) !== client || typeof ack?.identity !== "string" || ack.identity.length > 180 ||
          typeof ack.version !== "number" || !Number.isSafeInteger(ack.version) || !this.cooled(id, "voice.ack", 200)) return;
      this.voice.acknowledge(id, client.sessionId, ack.identity, ack.version);
    });
    this.onMessage("voice.refresh", client => {
      const id = (client.auth as Admission)?.userId;
      if (this.clientsByUser.get(id) === client && this.cooled(id, "voice.refresh", 500)) this.voice.publishStates();
    });
    this.clock.setInterval(() => { void this.voice.sync(); }, 500);
    PartyRoom.liveRooms.set(this.homeId, this);
    this.encounter = getWorld(this.worldId).stalker ? new ForestEncounter(getWorld(this.worldId)) : null;
    this.werewolf = this.worldId === "forest" ? new ForestWerewolf(getWorld(this.worldId)) : null;
    this.mimic = this.worldId === "forest" ? new ForestMimic(getWorld(this.worldId)) : null;
    this.npcs = this.worldId === "forest" ? createAuthoredForestNPCs(getWorld(this.worldId)) : null;
    this.onMessage("connection.ping", (client, raw: unknown) => {
      const id = (client.auth as Admission)?.userId;
      if (typeof raw !== "number" || !Number.isSafeInteger(raw) || raw < 0 || raw > 1e9 || this.clientsByUser.get(id) !== client || !this.cooled(id, "ping", 1000)) return;
      client.send("connection.pong", raw);
    });
    const currentSnapshotClient=(client:Client)=>{const id=(client.auth as Admission|undefined)?.userId;return !!id&&this.clientsByUser.get(id)===client&&!!this.players.get(id)?.connected&&PartyRoom.store.canAccess(this.homeId,id);};
    const snapshotVersion=(raw:unknown)=>!!raw&&typeof raw==='object'&&!Array.isArray(raw)&&Object.keys(raw).length===1&&(raw as {v?:unknown}).v===1;
    this.onMessage('snapshot.delta-ready',(client,raw:unknown)=>{
      if(!snapshotVersion(raw)||this.snapshotStreams.has(client)||!currentSnapshotClient(client))return;
      this.snapshotStreams.set(client,{encoder:new SnapshotDeltaEncoder<RoomSnapshot>(),forceFull:true,resyncAt:0});
    });
    this.onMessage('snapshot.resync',(client,raw:unknown)=>{
      if(!snapshotVersion(raw))return;
      const stream=this.snapshotStreams.get(client),now=Date.now();if(!stream||now-stream.resyncAt<1000||!currentSnapshotClient(client))return;
      stream.resyncAt=now;stream.forceFull=true;
    });
    // Leave one transport reservation for explicit tab replacement; unique identities are separately capped.
    this.maxClients = Math.min(home.capacity, GAME_CONFIG.partyCapacity) + 1;
    this.autoDispose = true;
    this.setMatchmaking({ unlisted: true });
    this.onMessage("command", (client, raw: unknown) => {
      const command = parseCommand(raw);
      if (!command)
        return this.notice(
          client,
          "INVALID_COMMAND",
          "That action was not valid.",
        );
      const userId = (client.auth as Admission).userId;
      if (
        this.clientsByUser.get(userId) !== client ||
        !PartyRoom.store.canAccess(this.homeId, userId)
      ) {
        this.notice(
          client,
          "ACCESS_DENIED",
          "Your access to this room has ended.",
        );
        client.leave(4003);
        return;
      }
      if (!this.allowed(userId + ":all", 120, 1000))
        return this.notice(client, "RATE_LIMITED", "Please slow down.");
      this.command(client, userId, command);
    });
    this.setTimestep((deltaMs) => {
      this.accumulation += Math.min(deltaMs, 100);
      let steps = 0;
      while (this.accumulation >= 1000 / 60 && steps++ < 6) {
        this.simulate(1 / 60);
        this.accumulation -= 1000 / 60;
      }
      if (this.accumulation > 100) this.accumulation = 0;
    }, 1000 / 60);
    this.clock.setInterval(
      () => this.sendSnapshots(),
      1000 / GAME_CONFIG.snapshotHz,
    );
    this.clock.setInterval(() => this.revalidate(), 1000);
    this.unbindAccess = PartyRoom.store.onAccessChanged(() =>
      this.revalidate(),
    );
    this.unbindBoard = PartyRoom.store.onBoardChanged(() => {
      for (const client of this.clients)
        client.send("board.changed", { homeId: this.homeId });
    });
  }

  onAuth(_client: Client, options: { ticket?: string; homeId?: string }) {
    if (!options.ticket)
      throw new ServerError(403, "A fresh room ticket is required.");
    const admission = PartyRoom.store.consumeTicket(options.ticket);
    if (!admission || admission.homeId !== this.homeId)
      throw new ServerError(403, "Room access denied.");
    if (!PartyRoom.store.canAccess(this.homeId, admission.userId))
      throw new ServerError(403, "Room access denied.");
    const home = PartyRoom.store.getHome(this.homeId)!;
    if (
      !this.players.has(admission.userId) &&
      this.players.size >= Math.min(home.capacity, GAME_CONFIG.partyCapacity)
    )
      throw new ServerError(
        409,
        "ROOM_FULL: This party has reached its player limit.",
      );
    return admission;
  }

  onJoin(client: Client, options: { replaceExisting?: boolean }) {
    const auth = client.auth as Admission;
    const home = PartyRoom.store.getHome(this.homeId);
    if (!home || !PartyRoom.store.canAccess(this.homeId, auth.userId))
      throw new ServerError(403, "Room access denied.");
    // Multiple admissions can finish authentication before either avatar is added.
    if (
      !this.players.has(auth.userId) &&
      this.players.size >= Math.min(home.capacity, GAME_CONFIG.partyCapacity)
    )
      throw new ServerError(
        409,
        "ROOM_FULL: This party has reached its player limit.",
      );
    const existing = this.clientsByUser.get(auth.userId);
    if (existing && existing !== client) {
      if (!options.replaceExisting)
        throw new ServerError(
          409,
          "SESSION_ACTIVE: Use your existing tab, or explicitly replace it.",
        );
      existing.send("notice", {
        code: "SESSION_REPLACED",
        message: "You continued in another tab.",
      });
      this.snapshotStreams.delete(existing);
      this.clientsByUser.delete(auth.userId);
      existing.leave(4011);
    }
    let player = this.players.get(auth.userId);
    if (!player) {
      player = createPlayer(auth.userId, auth.name, auth.avatar);
      const spawn = this.findHomeSpawn(auth.userId);
      player.x = spawn.x;
      player.y = spawn.y;
      if(this.worldId==="forest"&&this.mapFor(player).seats.some(seat=>seat.id===this.spawnSeats.get(auth.userId)&&distance(seat,spawn)<.01))player.seatId=this.spawnSeats.get(auth.userId);
    }
    this.idlePresence.set(auth.userId, createIdlePresence(Date.now()));
    player.connected = true;
    player.flashlightOn ??= false; player.flashlightBattery ??= 1; player.zoneRevision ??= 0;
    this.players.set(auth.userId, player);
    this.survival.ensure(auth.userId);
    this.roles.set(auth.userId, auth.role);
    this.clientsByUser.set(auth.userId, client);
    this.pushStory(auth.userId);
    this.chooseHost();
    client.send("welcome", {
      selfId: auth.userId,
      homeId: this.homeId,
      epoch: this.epoch,
    });
    this.sendSnapshots();
  }

  async onDrop(client: Client) {
    this.snapshotStreams.delete(client);
    const id = (client.auth as Admission).userId;
    if (
      this.clientsByUser.get(id) !== client ||
      !PartyRoom.store.canAccess(this.homeId, id)
    )
      return;
    const player = this.players.get(id);
    if (player) { player.connected = false; cancelSprint(player, Date.now()); if(this.race.phase==="waiting")this.race.readyIds=this.race.readyIds.filter(pid=>pid!==id); }
    this.intents.delete(id);
    this.sendSnapshots();
    try {
      await this.allowReconnection(client, GAME_CONFIG.reconnectGraceMs / 1000);
    } catch {
      /* onLeave performs final cleanup after the grace expires. */
    }
  }

  onReconnect(client: Client) {
    const id = (client.auth as Admission).userId;
    if (!PartyRoom.store.canAccess(this.homeId, id)) {
      client.leave(4003);
      return;
    }
    // Colyseus recreates Client on reconnect while retaining its reserved session.
    const previous=this.clientsByUser.get(id);
    if (!previous || previous.sessionId !== client.sessionId) {
      client.leave(4011);
      return;
    }
    if (this.expireIdle(id, client, Date.now())) return;
    const player = this.players.get(id);
    if (player) {
      player.connected = true;
    player.flashlightOn ??= false; player.flashlightBattery ??= 1; player.zoneRevision ??= 0;
      if (player.mode === "race") this.safeRaceRespawn(player);
    }
    if(previous)this.snapshotStreams.delete(previous);
    this.snapshotStreams.delete(client);
    this.clientsByUser.set(id, client);
    this.pushStory(id);
    client.send("welcome", {
      selfId: id,
      homeId: this.homeId,
      epoch: this.epoch,
    });
    this.sendSnapshots();
  }

  onLeave(client: Client) {
    this.snapshotStreams.delete(client);
    const id = (client.auth as Admission | undefined)?.userId;
    if (!id || this.clientsByUser.get(id) !== client) return;
    this.removePresence(id);
  }

  private removePresence(id: string) {
    this.inventoryRevisions.delete(id);
    const connection=this.clientsByUser.get(id);if(connection)this.snapshotStreams.delete(connection);
    const player = this.players.get(id);
    if (player?.mode === "race" && !player.finishedAt && this.race.phase!=="waiting")
      this.recordDnf(player, "disconnected");
    this.clientsByUser.delete(id);
    this.players.delete(id);
    this.survival.remove(id);
    this.roles.delete(id);
    this.idlePresence.delete(id);
    this.intents.delete(id);
    this.spawnSeats.delete(id);this.indoorSpawnSeats.delete(id);this.areaCooldowns.delete(id);
    if(this.worldProposal?.proposerId === id) this.worldProposal = null;
    const prefix = id + ":";
    for (const cache of [this.windows, this.cooldowns, this.chatAcks]) {
      for (const key of cache.keys())
        if (key === id || key.startsWith(prefix)) cache.delete(key);
    }
    for (const [proposalId, proposal] of this.proposals) {
      if (proposal.effect.sourceId === id || proposal.effect.targetId === id)
        this.proposals.delete(proposalId);
    }
    this.race.readyIds = this.race.readyIds.filter((value) => value !== id);
    this.race.joinedIds=this.race.joinedIds?.filter(value=>value!==id);
    this.startReadyLobby();
    if (this.hostId === id) this.hostId = null;
    this.chooseHost();
    this.checkRaceCompletion();
    this.sendSnapshots();
  }

  onDispose() {
    this.snapshotStreams.clear();
    void this.voice?.dispose();
    PartyRoom.activeHomes.delete(this.homeId);
    if (PartyRoom.liveRooms.get(this.homeId) === this) PartyRoom.liveRooms.delete(this.homeId);
    this.unbindAccess?.();
    this.unbindBoard?.();
  }

  private findHomeSpawn(excludeId?: string): { x: number; y: number } {
    const map = getWorld(this.worldId).map;
    if(this.worldId==="forest"&&excludeId&&!this.spawnSeats.has(excludeId)){
      const reserved=new Set(this.spawnSeats.values());
      const seat=map.seats.find(seat=>!reserved.has(seat.id));
      if(seat)this.spawnSeats.set(excludeId,seat.id);
    }
    const occupied = [...this.players.values()].filter(
      (player) => player.mode === "home" && !player.zone && player.id !== excludeId,
    );
    const safe = (point: { x: number; y: number }) =>
      point.x >= GAME_CONFIG.playerRadius &&
      point.x <= map.width - GAME_CONFIG.playerRadius &&
      point.y >= GAME_CONFIG.playerRadius &&
      point.y <= map.height - GAME_CONFIG.playerRadius &&
      !map.solids.some((solid) => overlapsPlayer(point, solid)) &&
      occupied.every(
        (player) => distance(player, point) >= 2 * GAME_CONFIG.playerRadius,
      );
    const ownSeat=map.seats.find(seat=>seat.id===this.spawnSeats.get(excludeId??""));
    const authored = ownSeat&&safe(ownSeat)?ownSeat:map.spawns.find(safe);
    if (authored) return { x: authored.x, y: authored.y };
    // Moving occupants can cover more than one authored point. Find a nearby clear
    // location rather than stacking a new/returning avatar on another participant.
    const candidates: { x: number; y: number }[] = [];
    for (let y = 1.5; y < map.height - 1; y += 0.75)
      for (let x = 1.5; x < map.width - 1; x += 0.75)
        candidates.push({ x, y });
    candidates.sort(
      (a, b) => distance(a, map.spawn) - distance(b, map.spawn),
    );
    const fallback = candidates.find(safe);
    if (!fallback)
      throw new ServerError(
        409,
        "SPAWN_UNAVAILABLE: No safe home position is available.",
      );
    return fallback;
  }

  private chooseHost() {
    if (this.hostId && this.players.has(this.hostId)) return;
    const eligible = [...this.players.values()].filter(
      (p) =>
        p.connected &&
        ["owner", "moderator"].includes(this.roles.get(p.id) || ""),
    );
    eligible.sort(
      (a, b) =>
        (this.roles.get(a.id) === "owner" ? -1 : 0) -
          (this.roles.get(b.id) === "owner" ? -1 : 0) ||
        a.id.localeCompare(b.id),
    );
    this.hostId = eligible[0]?.id ?? null;
  }

  private notice(
    client: Client,
    code: string,
    message: string,
    commandId?: string,
  ) {
    try{client.send("notice", {
      code,
      message,
      ...(commandId ? { commandId } : {}),
    });}catch{/* A closed transport cannot roll back an authoritative action. */}
  }
  private allowed(key: string, limit: number, windowMs: number) {
    const now = Date.now();
    const times = (this.windows.get(key) || []).filter(
      (t) => now - t < windowMs,
    );
    if (times.length >= limit) {
      this.windows.set(key, times);
      return false;
    }
    times.push(now);
    this.windows.set(key, times);
    return true;
  }
  private cooled(id: string, action: string, interval: number) {
    const key = id + ":" + action,
      now = Date.now();
    if (now - (this.cooldowns.get(key) || 0) < interval) return false;
    this.cooldowns.set(key, now);
    return true;
  }
  private mapFor(p:PlayerState){return getWorld(p.zone??this.worldId).map;}
  private emit(mode: "home" | "race", type: string, value: unknown, zone?:PlayerState["zone"]) {
    for (const [id, client] of this.clientsByUser)
      if (this.players.get(id)?.mode === mode && (type!=="effect" || this.players.get(id)?.zone===zone)) client.send(type, value);
  }

  private command(client: Client, id: string, command: ClientCommand) {
    const p = this.players.get(id);
    if (!p || !p.connected) return;
    // A resumed tab or queued heartbeat cannot revive an already expired session.
    if (this.expireIdle(id, client, Date.now())) return;
    if (["presence.activity", "presence.stay"].includes(command.type)) {
      const state = this.idlePresence.get(id);
      if (state && this.cooled(id, "idle-activity", 1000)) recordActivity(state, Date.now());
      return;
    }
    if (command.type === "presence.watching") {
      const state = this.idlePresence.get(id);
      if (state && p.mode === "home" && p.zone === "asylum" && this.media.playing && this.media.playbackId === command.playbackId && this.cooled(id, "idle-watching", 4000)) recordWatching(state, Date.now());
      return;
    }
    if(command.type.startsWith("story.")){this.storyCommand(client,p,command as Extract<ClientCommand,{type:`story.${string}`}>);return;}
    if(p.respawnAt&&!["input.stop","chat.send","world.object","voice.status","voice.mode"].includes(command.type))return;
    if(command.type==="mob.attack"){
      if(!this.freshWorldAction(p,command)||p.zone)return this.notice(client,"MOB_STALE","Return outside to face the threat.",command.commandId);
      if(!this.survival.acceptCommand(p.id,command.commandId,Date.now()))return;
      const humans=this.combatants(),actor=humans.find(a=>a.id===p.id)!;
      const result=this.combat?.strike(actor,command.mobId,command.targetLifeRevision,Date.now(),humans,(a,target,now)=>this.survival.strikeWorldTarget(a,target,now));
      if(result&&!result.ok)this.notice(client,"MOB_UNAVAILABLE",result.reason,command.commandId);
      this.commitDefeats();this.sendSnapshots();return;
    }
    if(command.type==="interior.enter"){
      if(this.worldId!=="forest"||this.worldProposal||p.mode!=="home"||p.respawnAt||command.worldRevision!==this.worldRevision||command.lifeRevision!==(p.respawnCount??0)||command.zoneRevision!==(p.zoneRevision??0))return this.notice(client,"INTERIOR_STALE","The doorway has changed. Try again.",command.commandId);
      if(!this.survival.acceptCommand(p.id,command.commandId,Date.now()))return;
      this.moveInterior(p,command.interiorId,client);return;
    }
    if (command.type === "npc.interact") {
      if (this.worldId !== "forest" || this.worldProposal || p.mode !== "home" || p.zone || p.respawnAt || command.worldRevision !== this.worldRevision || command.lifeRevision !== (p.respawnCount ?? 0) || command.zoneRevision !== (p.zoneRevision ?? 0))
        return this.notice(client,"NPC_STALE","Return outside to talk with them.",command.commandId);
      if (!this.survival.acceptCommand(p.id, command.commandId, Date.now())) return;
      const ada=command.npcId==="npc:keeper-ada"?this.keeperNPC():undefined;
      if(ada&&this.nearAnchor(p,ada)){this.keeperDialogue={id:`ada:${Date.now()}`,text:this.storyAuthority?.state.chapter==="complete"?"You kept a place for me. I will spend the rest of my days keeping places for you.":this.storyAuthority?.state.defeated.includes(STORY_GUARDIAN)?"You found me. Let’s go home. There is a fire I have missed.":"The roots learned my voice. Break their guardian’s hold, and I can follow you home.",until:Date.now()+6000};if(this.storyAuthority?.state.chapter==="complete")this.notice(client,"STORY_UPDATE",this.keeperDialogue.text,command.commandId);else this.applyStory(client,{kind:"rescue",npcId:"keeper-ada",actorId:p.id,eventId:this.storyEventId(p.id,command.commandId),occurredAt:Date.now()});}
      else if (!this.npcs?.interact(command.npcId,p,Date.now())) this.notice(client,"NPC_UNAVAILABLE","Walk closer, or let them finish speaking.",command.commandId);
      else {this.applyStory(client,{kind:"talk",npcId:command.npcId.slice(4),actorId:p.id,eventId:this.storyEventId(p.id,command.commandId),occurredAt:Date.now()});const idle=this.idlePresence.get(p.id);if(idle)recordActivity(idle,Date.now());}
      this.sendSnapshots(); return;
    }
    if (command.type.startsWith("survival.")) {
      this.survivalCommand(client, p, command as Extract<ClientCommand, {type: `survival.${string}`}>);
      return;
    }
    switch (command.type) {
      case "world.propose": {
        if(command.worldId!=="forest")return this.notice(client,"WORLD_UNAVAILABLE","Midnight Pines is the current campsite.");
        const key=id+":"+command.commandId;
        if(this.acceptedWorldCommands.has(key)) break;
        if(command.revision!==this.worldRevision || this.worldProposal)
          return this.notice(client,"WORLD_BUSY","A world change is already pending, or your view changed.");
        if(command.worldId===this.worldId) break;
        const now=Date.now();
        this.worldProposal={id:randomUUID(),commandId:command.commandId,proposerId:id,worldId:command.worldId,startAt:now,endsAt:now+WORLD_COUNTDOWN_MS};
        this.acceptedWorldCommands.set(key,this.worldProposal.id);
        if(this.acceptedWorldCommands.size>128)this.acceptedWorldCommands.delete(this.acceptedWorldCommands.keys().next().value!);
        this.sendSnapshots(); break;
      }
      case "world.object":
        if(this.worldProposal?.id!==command.proposalId || Date.now()>=this.worldProposal.endsAt)
          return this.notice(client,"PROPOSAL_EXPIRED","That world countdown has ended.");
        this.worldProposal=null; this.broadcast("notice",{code:"WORLD_CANCELLED",message:p.name+" asked to stay here. World change cancelled."}); this.sendSnapshots(); break;
      case "area.enter": {
        if(p.mode!=="home"||this.worldId!=="forest"||this.worldProposal)return this.notice(client,"WORLD_BUSY","Finish the world countdown first.");
        const entering=command.area==="asylum";
        if(p.zone&&p.zone!=="asylum")break;
        if(entering===!!p.zone)break;
        const door=entering?ASYLUM_DOOR:{x:10,y:17.5};
        if(distance(p,door)>GAME_CONFIG.interactionDistance)return this.notice(client,"TOO_FAR","Walk to the doorway first.");
        this.moveArea(p,entering,client);break;
      }
      case "flashlight": p.flashlightOn=command.enabled&&(p.flashlightBattery??1)>0; break;
      case "roast": {
        const fire=getWorld(this.worldId).fire;
        if(command.enabled && (p.mode!=="home" || p.zone || !fire || distance(p,fire)>4))
          return this.notice(client,"TOO_FAR","Come close to the campfire to roast a marshmallow.");
        if(command.enabled) p.roastingAt=Date.now(); else delete p.roastingAt;
        break;
      }
      case "media.control": {
        const key=id+":"+command.commandId;
        if(this.acceptedMediaCommands.has(key))break;
        if(p.mode!=="home"||getWorld(p.zone??this.worldId).mediaEnabled===false)return this.notice(client,"TOO_FAR","Use the campsite TV.");
        if(command.action==="ended"&&(command.revision!==this.media.revision||command.playbackId!==this.media.playbackId))break;
        if(command.revision!==this.media.revision)return this.notice(client,"MEDIA_CONFLICT","Playback changed. Try again with the latest controls.");
        const now=Date.now();
        const position=Math.min(86400,this.media.position+(this.media.playing?Math.max(0,now-this.media.anchorAt)/1000:0));
        if(command.action==="queue.add"){
          if(!command.url)break;const queue=this.media.queue??[];
          if(queue.length>=20)return this.notice(client,"QUEUE_FULL","The queue has twenty videos. Remove one first.");
          try{const source=resolveMediaLink(command.url);this.media={...this.media,revision:this.media.revision+1,queue:[...queue,{id:randomUUID(),url:source.url,addedBy:id,start:source.start}]};}catch(error){return this.notice(client,"INVALID_MEDIA",(error as Error).message);}
        }else if(command.action==="queue.remove"){
          const queue=this.media.queue??[];if(!queue.some(v=>v.id===command.itemId))break;this.media={...this.media,revision:this.media.revision+1,queue:queue.filter(v=>v.id!==command.itemId)};
        }else if(command.action==="next"||command.action==="ended"){
          if(command.action==="ended"&&!this.media.playing)break;const [next,...queue]=this.media.queue??[];
          if(next){const source=resolveMediaLink(next.url);this.media={playbackId:randomUUID(),revision:this.media.revision+1,url:source.url,playing:true,position:next.start??source.start,anchorAt:now,queue};}
          else this.media={...this.media,revision:this.media.revision+1,position,playing:false,anchorAt:now};
        }else if(command.action==="source") {
          if(!command.url)return this.notice(client,"INVALID_MEDIA","Paste a YouTube link or an HTTPS video file link.");
          try {
            const source=resolveMediaLink(command.url);
            this.media={playbackId:randomUUID(),revision:this.media.revision+1,url:source.url,playing:false,position:source.start,anchorAt:now,queue:this.media.queue??[]};
          }catch(error){return this.notice(client,"INVALID_MEDIA",(error as Error).message);}
        } else {
          if(!this.media.url)return this.notice(client,"INVALID_MEDIA","Choose a video first.");
          this.media={...this.media,revision:this.media.revision+1,position:command.action==="seek"?command.position??position:position,anchorAt:now,playing:command.action==="play"?true:command.action==="pause"?false:this.media.playing};
        }
        this.acceptedMediaCommands.add(key); if(this.acceptedMediaCommands.size>256)this.acceptedMediaCommands.delete(this.acceptedMediaCommands.values().next().value!);
        this.sendSnapshots(); break;
      }
      case "input.stop": { const seq=this.intents.get(id)?.value.seq??p.lastInputSeq;this.intents.set(id,{value:neutral(seq),receivedAt:Date.now()});p.vx=p.vy=0;cancelSprint(p,Date.now());break;}
      case "input": {
        if(command.zoneRevision!==undefined && command.zoneRevision!==(p.zoneRevision??0))return;
        if(command.worldRevision!==undefined && command.worldRevision!==this.worldRevision)return;
        if(command.lifeRevision!==undefined && command.lifeRevision!==(p.respawnCount??0))return;
        const previous = this.intents.get(id)?.value.seq ?? p.lastInputSeq;
        if (command.input.seq <= previous) return;
        if (command.input.seq > previous + 10000)
          return this.notice(
            client,
            "INVALID_INPUT",
            "Input sequence is out of range.",
          );
        if (!this.allowed(id + ":input", 60, 1000)) return;
        const now = Date.now();
        if (command.input.axisX || command.input.axisY || command.input.jump || command.input.sprint) {
          const state = this.idlePresence.get(id); if (state) recordActivity(state, now);
        }
        if(command.input.axisX||command.input.axisY){delete p.seatId;delete p.roastingAt;}
        // Hold intent is integrated by stepHome; packets cannot refill or extend stamina.
        // Acknowledge accepted input even when seated or race physics is frozen.
        p.lastInputSeq = command.input.seq;
        this.intents.set(id, { value: command.input, receivedAt: now });
        if (command.input.axisX || command.input.axisY) { delete p.seatId; delete p.roastingAt; }
        break;
      }
      case "chat.send": {
        const cacheKey =
          id + ":" + (p.mode === "home" ? this.homeId + ":home" : this.race.id);
        let seen = this.chatAcks.get(cacheKey);
        if (!seen) {
          seen = new Map();
          this.chatAcks.set(cacheKey, seen);
        }
        const prior = seen.get(command.commandId);
        if (prior) {
          if (prior.text !== command.text)
            return this.notice(
              client,
              "INVALID_COMMAND",
              "A retry cannot change the original message.",
              command.commandId,
            );
          client.send("chat", prior);
          return;
        }
        if (seen.size >= 1000)
          return this.notice(
            client,
            "SESSION_LIMIT",
            "Start a fresh room session to send more messages.",
            command.commandId,
          );
        if (!this.allowed(id + ":chat", 5, 10000))
          return this.notice(
            client,
            "RATE_LIMITED",
            "Five messages per ten seconds. Try again shortly.",
            command.commandId,
          );
        const message = {
          id: randomUUID(),
          commandId: command.commandId,
          senderId: id,
          senderName: p.name,
          text: command.text,
          seq: ++this.seq,
          createdAt: Date.now(),
        };
        seen.set(command.commandId, message);
        this.chats[p.mode].push(message);
        this.chats[p.mode] = this.chats[p.mode].slice(-100);
        this.emit(p.mode, "chat", message);
        break;
      }
      case "seat": {
        if (command.seatId === null) {
          delete p.seatId;
          break;
        }
        const seat = this.mapFor(p).seats.find((s) => s.id === command.seatId);
        if (p.mode !== "home" || !seat || distance(p, seat) > GAME_CONFIG.interactionDistance || !isHomeSegmentWalkable(p, seat, this.mapFor(p)))
          return this.notice(client, "TOO_FAR", "Walk closer to that seat.");
        if (
          [...this.players.values()].some(
            (other) => other.seatId === seat.id && other.zone===p.zone && other.id !== id,
          )
        )
          return this.notice(
            client,
            "SEAT_TAKEN",
            "Someone is already sitting there.",
          );
        p.seatId = seat.id;
        if(seat.id==="charger-seat"){p.flashlightBattery=1;this.notice(client,"CHARGED","Flashlight fully charged.");}
        const fire=getWorld(this.worldId).fire;
        if(fire){const dx=fire.x-seat.x,dy=fire.y-seat.y;p.facing=Math.abs(dx)>Math.abs(dy)?dx>0?"right":"left":dy>0?"down":"up";}
        p.x = seat.x;
        p.y = seat.y;
        p.vx = p.vy = 0;
        break;
      }
      case "emote": {
        if (!this.cooled(id, "emote", 1000)) return;
        const target = command.targetId
          ? this.players.get(command.targetId)
          : undefined;
        const targeted = ["poke", "high-five"].includes(command.assetId);
        if (
          targeted &&
          (!target ||
            target.id === id ||
            target.mode !== p.mode || target.zone!==p.zone ||
            !target.connected ||
            distance(p, target) > 2)
        )
          return this.notice(
            client,
            "TOO_FAR",
            "Choose someone within two tiles.",
          );
        if (command.assetId === "poke")
          return this.notice(
            client,
            "CONSENT_REQUIRED",
            "Use a high five to invite someone to interact.",
          );
        const now = Date.now();
        const effect: SocialEffect = {
          id: randomUUID(),
          type: command.assetId === "high-five" ? "proposal" : "emote",
          sourceId: id,
          targetId: target?.id,
          assetId: command.assetId,
          x: p.x,
          y: p.y,
          startTime: now,
          expiresAt: now + (command.assetId === "high-five" ? 5000 : 3000),
        };
        if (effect.type === "proposal") {
          this.proposals.set(effect.id, { effect, mode: p.mode });
          client.send("effect", effect);
          this.clientsByUser.get(target!.id)?.send("effect", effect);
        } else this.emit(p.mode, "effect", effect,p.zone);
        break;
      }
      case "social.accept": {
        const proposal = this.proposals.get(command.proposalId);
        if (
          !proposal ||
          proposal.effect.targetId !== id ||
          proposal.effect.expiresAt < Date.now()
        )
          return this.notice(
            client,
            "PROPOSAL_EXPIRED",
            "That invitation has expired.",
          );
        const source = this.players.get(proposal.effect.sourceId);
        if (
          !source ||
          !source.connected ||
          source.mode !== p.mode || source.zone!==p.zone ||
          distance(p, source) > 2
        )
          return this.notice(
            client,
            "TOO_FAR",
            "Your friend moved out of reach.",
          );
        this.proposals.delete(command.proposalId);
        this.emit(p.mode, "effect", {
          ...proposal.effect,
          id: randomUUID(),
          type: "emote",
          startTime: Date.now(),
          expiresAt: Date.now() + 3000,
        },p.zone);
        break;
      }
      case "sound": {
        if (!this.soundboardEnabled)
          return this.notice(
            client,
            "SOUNDBOARD_OFF",
            "The host turned the soundboard off.",
          );
        if (!this.cooled(id, "sound", 3000))
          return this.notice(
            client,
            "RATE_LIMITED",
            "Wait three seconds between sounds.",
          );
        const now = Date.now();
        this.emit(p.mode, "effect", {
          id: randomUUID(),
          type: "sound",
          sourceId: id,
          assetId: command.assetId,
          x: p.x,
          y: p.y,
          startTime: now,
          expiresAt: now + 2000,
        },p.zone);
        break;
      }
      case "sound.enabled":
        if (id === this.hostId) this.soundboardEnabled = command.enabled;
        else
          this.notice(
            client,
            "ACCESS_DENIED",
            "Only the host changes the soundboard.",
          );
        break;
      case "voice.status":
        p.nativeMode = this.voice.available ? command.nativeMode : "off";
        p.manualMute = command.manualMute;
        p.deafened = command.deafened;
        if (!this.voice.available && command.nativeMode !== "off")
          this.notice(
            client,
            "MEDIA_NOT_CONFIGURED",
            "Native voice needs a configured, verified media service. Gameplay and chat remain available.",
          );
        this.voice.publishStates();
        break;
      case "voice.mode":
        if (id === this.hostId) this.voiceModes.home = this.voiceModes.race = command.mode;
        else
          this.notice(
            client,
            "ACCESS_DENIED",
            "Only the host changes room voice mode.",
          );
        break;
      case "race.ready": {
        if(this.race.phase==="waiting") {
          if(p.mode!=="race"||!this.race.joinedIds?.includes(id))return;
          this.race.readyIds=this.race.readyIds.filter(pid=>pid!==id);
          if(command.ready)this.race.readyIds.push(id);
          this.startReadyLobby();this.sendSnapshots();break;
        }
        if(this.worldId==="forest")return this.notice(client,"TOO_FAR","Join the waiting lobby at the cabin first.");
        if(this.worldProposal) return this.notice(client,"WORLD_BUSY","Return to the campsite before starting Garden Dash.");
        if (p.mode !== "home" || this.race.phase !== "lobby")
          return this.notice(
            client,
            "RACE_ACTIVE",
            "A race is already in progress.",
          );
        const portal = getWorld(this.worldId).map.furniture.find((item) => item.id === (this.worldId==="forest"?"abandoned-cabin":HOME_MAP.portal.id))!;
        if (command.ready && !canUseFurniture(p, portal))
          return this.notice(
            client,
            "TOO_FAR",
            "Walk to the cabin door to join the race.",
          );
        this.race.readyIds = this.race.readyIds.filter((value) => value !== id);
        if (command.ready) this.race.readyIds.push(id);
        break;
      }
      case "race.enter": {
        if(p.mode!=="home"||p.zone||this.worldId!=="forest"||distance(p,CAMP_RACE_DOOR)>GAME_CONFIG.interactionDistance)return this.notice(client,"TOO_FAR","Walk to the cabin door to start racing.");
        if(this.worldProposal)return this.notice(client,"WORLD_BUSY","Finish the world countdown first.");
        if(!["lobby","waiting"].includes(this.race.phase))return this.notice(client,"RACE_ACTIVE","This race has started. Join the next one.");
        if(!this.cooled(id,"race.enter",5000))return;
        if(this.race.phase==="lobby") {
          this.race={id:randomUUID(),phase:"waiting",startAt:0,endAt:0,joinedIds:[],readyIds:[],results:[]};
          this.chats.race=[];
        }
        this.race.joinedIds=[...(this.race.joinedIds??[]),id];
        cancelSprint(p,Date.now());delete p.roastingAt;
        this.players.set(id,resetRacePlayer(p));this.intents.delete(id);
        client.send("transition",{mode:"race",instanceId:this.race.id});
        this.sendSnapshots();break;
      }

      case "race.start": {
        if(this.worldId==="forest"){this.startReadyLobby();break;}
        if(this.worldProposal) return this.notice(client,"WORLD_BUSY","Finish the world change first.");
        if (id !== this.hostId)
          return this.notice(
            client,
            "ACCESS_DENIED",
            "Only the host can start the race.",
          );
        if (this.race.phase !== "lobby")
          return this.notice(
            client,
            "RACE_ACTIVE",
            "Finish or return from the current race first.",
          );
        const ready = this.race.readyIds.filter(
          (pid) =>
            this.players.get(pid)?.connected &&
            PartyRoom.store.canAccess(this.homeId, pid),
        );
        if (!ready.length)
          return this.notice(
            client,
            "NO_RACERS",
            "Ask someone to ready up at the portal.",
          );
        this.startRace(ready);
        break;
      }
      case "race.return": {
        if (p.mode !== "race") break;
        if (!p.finishedAt && this.race.phase !== "results" && this.race.phase!=="waiting")
          this.recordDnf(p, "returned");
        const spawn = this.findHomeSpawn(id);
        p.mode = "home";
        p.flashlightBattery=1;p.flashlightOn=false;
        p.x = spawn.x;
        p.y = spawn.y;
        p.vx = p.vy = 0;
        Object.assign(p, clearRaceBoosts(p));
        delete p.finishedAt;
        this.intents.delete(id);
        client.send("transition", {
          mode: "home",
          instanceId: this.homeId + ":home",
        });
        if(this.race.phase==="waiting"){this.race.joinedIds=this.race.joinedIds?.filter(pid=>pid!==id);this.race.readyIds=this.race.readyIds.filter(pid=>pid!==id);this.startReadyLobby();}
        this.checkRaceCompletion();
        if (![...this.players.values()].some((v) => v.mode === "race"))
          this.race = {
            id: randomUUID(),
            phase: "lobby",
            startAt: 0,
            endAt: 0,
            readyIds: [],
            results: [],
          };
        break;
      }
      case "session.replace":
        break;
    }
  }

  private freshWorldAction(p:PlayerState,c:{worldRevision:number;lifeRevision:number;zoneRevision:number}){
    return canUseForestStory(this.worldId,!!this.worldProposal,p)&&c.worldRevision===this.worldRevision&&c.lifeRevision===(p.respawnCount??0)&&c.zoneRevision===(p.zoneRevision??0);
  }
  private storyEventId(userId:string,commandId:string){return `user:${createHash('sha256').update(JSON.stringify([userId,commandId])).digest('hex')}`;}
  private nearAnchor(p:PlayerState,point:{x:number;y:number},range=2.5){return distance(p,point)<=range&&isHomeSegmentWalkable(p,point,this.mapFor(p));}
  private pushStory(id:string){
    const data=this.story.read(this.homeId,id);this.inventoryRevisions.set(id,data.personal.inventory.revision);this.survival.restoreApples(id,data.personal.inventory.apples);this.sendStoryData(id,data);this.refreshStoryAuthority();return data;
  }
  private sendStoryData(id:string,data:ForestStorySnapshot){try{this.clientsByUser.get(id)?.send("story.snapshot",data);}catch{/* Reconnect/read resends the durable view; transport failure never undoes a commit. */}}
  private refreshStoryAuthority(){
    this.storyAuthority=this.story.readAuthority(this.homeId);
    const state=this.storyAuthority?.state;
    this.combat?.syncStory(state?.chapter==="wards"?[...STORY_RAIDERS]:state?.chapter==="rescue"?[STORY_GUARDIAN]:[],state?.defeated??[]);
    if(state){const flags={wardAccepted:state.chapter!=="undiscovered",wardsRestored:["inquiry","rescue","complete"].includes(state.chapter),keeperFound:state.chapter==="complete"};for(const npc of AUTHORED_FOREST_NPCS)this.npcs?.setLines(`npc:${npc.id}`,[forestNpcDialogue(npc,flags),...npc.ambientLines]);if(flags.keeperFound)for(const id of ["npc:forest:0","npc:forest:1","npc:forest:2"])this.npcs?.setLines(id,["Ada is home. The forest still has its mysteries, but that empty chair is filled."]);}
  }
  private broadcastStory(){this.refreshStoryAuthority();for(const id of this.clientsByUser.keys())if(PartyRoom.store.canAccess(this.homeId,id)){try{this.pushStory(id);}catch{/* This member can refresh/rejoin without blocking everyone else's delivery. */}}}
  private persistApples(id:string,before:number,after:number,cause:'harvest'|'eat'|'death'){
    if(!this.story)return false;
    let result:ReturnType<SharedForestStoryStore['changeApples']>;
    try{
      result=this.story.changeApples(this.homeId,id,{before,after,cause,expectedRevision:this.inventoryRevisions.get(id)??1});
    }catch{return false;}
    this.inventoryRevisions.set(id,result.snapshot.personal.inventory.revision);this.sendStoryData(id,result.snapshot);
    if(result.status==="inventory-conflict"){this.survival.restoreApples(id,result.snapshot.personal.inventory.apples);return false;}
    return true;
  }
  private applyStory(client:Client,event:ForestStoryEvent,replyCommandId?:string){
    let result:ReturnType<SharedForestStoryStore['apply']>;
    try{result=this.story.apply(this.homeId,event);}
    catch{this.notice(client,"STORY_SAVE_FAILED","The discovery could not be saved. Please try again.",replyCommandId??event.eventId);return;}
    // Delivery is separate from the durable commit. Never report a saved discovery as failed.
    try{this.broadcastStory();}catch{this.notice(client,"STORY_REFRESH","Your discovery is saved. Reopen the journal to refresh it.");}
    // A journal action also needs an acknowledgement when it made no change.
    // Durable receipt identity remains server-generated and separate from the UI reply.
    if(replyCommandId||result.status!=="unchanged")this.notice(client,"STORY_UPDATE",result.message,replyCommandId??event.eventId);
  }
  private keeperNPC():ForestNPC|undefined{
    const chapter=this.storyAuthority?.state.chapter;if(chapter!=="rescue"&&chapter!=="complete")return;
    return {id:"npc:keeper-ada",name:"Ada",role:"Forest keeper",art:"villager",avatar:{...DEFAULT_AVATAR,clothingColor:"#66886c",hairColor:"#d2c5ac"},...(chapter==="complete"?{x:31,y:26}:{x:126,y:98}),facing:"down",phase:"talking",activity:"resting",moving:false,health:100,maxHealth:100,...(this.keeperDialogue&&this.keeperDialogue.until>Date.now()?{dialogue:this.keeperDialogue}:{})};
  }
  private combatants():ForestCombatant[]{const inventories=new Map(this.survival.snapshot().players.map(p=>[p.id,p]));return [...this.players.values()].map(p=>({...p,health:inventories.get(p.id)?.health??0,armed:inventories.get(p.id)?.equipped==="knife"&&!!inventories.get(p.id)?.knifeId}));}
  private commitDefeats(){
    if(Date.now()<this.nextStoryRetryAt)return;
    if(this.combat?.pendingDefeats().length)this.nextStoryRetryAt=Date.now()+500;
    for(const receipt of this.combat?.pendingDefeats()??[]){
      try{if(this.story.readAuthority(this.homeId)?.state.defeated.includes(receipt.encounterId)){this.combat?.acknowledgeDefeat(receipt.eventId);this.broadcastStory();continue;}}catch{continue;}
      const participantIds=receipt.participantIds.filter(id=>PartyRoom.store.canAccess(this.homeId,id));
      if(!participantIds.length){this.combat?.discardDefeatAndReset(receipt.eventId);continue;}
      try{const result=this.story.apply(this.homeId,{...receipt,actorId:participantIds.includes(receipt.actorId)?receipt.actorId:participantIds[0]!,participantIds});
        if(this.story.readAuthority(this.homeId)?.state.defeated.includes(receipt.encounterId)){this.combat?.acknowledgeDefeat(receipt.eventId);this.broadcastStory();}
      }catch{/* Keep one bounded receipt for a later retry; never credit from a client report. */}
    }
  }
  private storyCommand(client:Client,p:PlayerState,command:Extract<ClientCommand,{type:`story.${string}`}>) {
    if(!this.freshWorldAction(p,command))return this.notice(client,"STORY_STALE","Your view changed. Try again.",command.commandId);
    if(!this.survival.acceptCommand(p.id,command.commandId,Date.now()))return;
    try{
      if(command.type==="story.read"){this.pushStory(p.id);return;}
      if(command.type==="story.seen"){client.send("story.snapshot",this.story.markSeen(this.homeId,p.id,command.seenRevision));return;}
      if(command.type==="story.reward"){
        const inventory=this.survival.ensure(p.id),result=this.story.claimReward(this.homeId,p.id,command.rewardId,{inventoryRevision:this.inventoryRevisions.get(p.id)??1,appleSlotAvailable:inventory.slots.includes("apple")||inventory.slots.includes(null)});
        this.pushStory(p.id);this.notice(client,"STORY_REWARD",result.message,command.commandId);this.sendSnapshots();return;
      }
      const base={actorId:p.id,eventId:this.storyEventId(p.id,command.commandId),occurredAt:Date.now()};
      if(command.type==="story.recover"){
        const anchor=WARD_CACHE_ANCHORS.find(a=>a.id===command.supplyId);if(p.zone||!anchor||!this.nearAnchor(p,anchor,1.8))return this.notice(client,"TOO_FAR","Walk beside the brass seal first.",command.commandId);
        this.applyStory(client,{...base,kind:"recover",supplyId:command.supplyId});
      }else if(command.type==="story.inspect"){
        const interior=FOREST_INTERIORS.find(i=>i.id===p.zone),expected=interior?.buildingId==="keeper-house"?"ada-journal":interior?.buildingId==="hollow-observatory"?"ward-rubbing":null;
        if(!interior?.clue||command.evidenceId!==expected||!this.nearAnchor(p,interior.clue.point,1.8))return this.notice(client,"TOO_FAR","Walk beside the clue first.",command.commandId);
        this.applyStory(client,{...base,kind:"inspect",evidenceId:command.evidenceId});
      }else if(command.type==="story.accuse"){
        const orin=this.npcs?.get("npc:wizard-orin-vale");if(!canDiscussForestStory(this.worldId,!!this.worldProposal,p,orin,this.mapFor(p)))return this.notice(client,"TOO_FAR","Discuss the evidence beside Orin.",command.commandId);
        this.applyStory(client,{...base,kind:"accuse",suspectId:command.suspectId},command.commandId);
      }
      const idle=this.idlePresence.get(p.id);if(idle)recordActivity(idle,Date.now());
    }catch{this.notice(client,"STORY_SAVE_FAILED","The discovery could not be saved. Please try again.",command.commandId);}
  }
  private moveArea(p:PlayerState,entering:boolean,client?:Client) {
    const id=p.id;
    if(Date.now()<(this.areaCooldowns.get(id)??0))return;
    const zone=entering?"asylum":undefined;
        const indoor=getWorld("asylum").map;
        if(entering&&!this.indoorSpawnSeats.has(id)){const reserved=new Set(this.indoorSpawnSeats.values());const seat=indoor.seats.find(s=>s.id!=="charger-seat"&&!reserved.has(s.id));if(seat)this.indoorSpawnSeats.set(id,seat.id);}
        const own=indoor.seats.find(s=>s.id===this.indoorSpawnSeats.get(id));
        const candidates=entering?[...(own?[own]:[]),...indoor.spawns]:Array.from({length:8},(_,i)=>({x:69+(i%3-1)*.8,y:15.3+Math.floor(i/3)*.8}));
        const map=getWorld(zone??this.worldId).map;
        const spawn=candidates.find(s=>!map.solids.some(solid=>overlapsPlayer(s,solid))&&[...this.players.values()].every(o=>o.id===id||o.mode!=="home"||o.zone!==zone||distance(s,o)>.65));
        if(!spawn){if(client)this.notice(client,"DOOR_BUSY","The doorway is occupied. Try again.");return;}
        cancelSprint(p,Date.now());p.zone=zone;p.zoneRevision=(p.zoneRevision??0)+1;Object.assign(p,{x:spawn.x,y:spawn.y,vx:0,vy:0});delete p.seatId;if(entering&&own&&distance(own,spawn)<.01)p.seatId=own.id;delete p.roastingAt;this.intents.delete(id);this.areaCooldowns.set(id,Date.now()+1500);this.sendSnapshots();
  }
  private moveInterior(p:PlayerState,destination:string,client?:Client){
    if(Date.now()<(this.areaCooldowns.get(p.id)??0))return;
    const leaving=destination==="outside",interior=FOREST_INTERIORS.find(i=>i.id===(leaving?p.zone:destination));
    if(!interior||leaving&&!p.zone||!leaving&&p.zone)return;
    const door=leaving?interior.exit:interior.returnPoint;
    if(distance(p,door)>GAME_CONFIG.interactionDistance||!isHomeSegmentWalkable(p,door,this.mapFor(p))){if(client)this.notice(client,"TOO_FAR","Walk to the doorway first.");return;}
    const zone=leaving?undefined:interior.id as PlayerState["zone"],map=getWorld(zone??this.worldId).map;
    const candidates=leaving?Array.from({length:12},(_,i)=>({x:interior.returnPoint.x+(i%3-1)*.8,y:interior.returnPoint.y+1.1+Math.floor(i/3)*.8})):[...interior.map.spawns,interior.entrance];
    const spawn=candidates.find(s=>isHomeWalkable(s,map)&&[...this.players.values()].every(o=>o.id===p.id||o.mode!=="home"||o.zone!==zone||distance(s,o)>.65));
    if(!spawn){if(client)this.notice(client,"DOOR_BUSY","The doorway is occupied. Try again.");return;}
    cancelSprint(p,Date.now());p.zone=zone;p.zoneRevision=(p.zoneRevision??0)+1;Object.assign(p,{x:spawn.x,y:spawn.y,vx:0,vy:0});delete p.seatId;delete p.roastingAt;this.intents.delete(p.id);this.areaCooldowns.set(p.id,Date.now()+1500);this.sendSnapshots();
  }
  private startReadyLobby() {
    if(this.race.phase!=="waiting")return;
    const joined=this.race.joinedIds??[];
    if(!joined.length){this.race={id:randomUUID(),phase:"lobby",startAt:0,endAt:0,joinedIds:[],readyIds:[],results:[]};return;}
    if(!joined.every(id=>this.players.get(id)?.connected&&this.race.readyIds.includes(id)))return;
    const now=Date.now();this.race.phase="countdown";this.race.startAt=now+3000;this.race.endAt=now+123000;
    // Discard waiting input so a held jump cannot launch the countdown start.
    for(const id of joined)this.intents.delete(id);
  }
  private startRace(ready:string[]) {
        const now = Date.now();
        this.race = {
          id: randomUUID(),
          phase: "countdown",
          startAt: now + 3000,
          endAt: now + 123000,
          joinedIds:ready,
          readyIds: ready,
          results: [],
        };
        this.chats.race = [];
        this.voiceModes.race = this.voiceModes.home;
        for (const pid of ready) {
          cancelSprint(this.players.get(pid)!,Date.now());
          this.players.set(pid, resetRacePlayer(this.players.get(pid)!));
          this.intents.delete(pid);
          this.clientsByUser
            .get(pid)
            ?.send("transition", { mode: "race", instanceId: this.race.id });
        }
  }

  private survivalCommand(client: Client, p: PlayerState, command: Extract<ClientCommand, {type: `survival.${string}`}>) {
    const now=Date.now();
    if (this.worldId!=="forest" || this.worldProposal || command.worldRevision!==this.worldRevision || p.mode!=="home" || p.respawnAt)
      return this.notice(client,"SURVIVAL_STALE","Your area changed. Try again when you are back in the forest.",command.commandId);
    if (command.type === "survival.pvp") {
      if (this.hostId!==p.id) return this.notice(client,"HOST_ONLY","Only the host can change knife combat.",command.commandId);
      if (this.survival.acceptCommand(p.id,command.commandId,now)) this.survival.setPvp(command.enabled);
      this.sendSnapshots(); return;
    }
    if (command.lifeRevision!==(p.respawnCount??0) || command.zoneRevision!==(p.zoneRevision??0))
      return this.notice(client,"SURVIVAL_STALE","Your view changed. Try again.",command.commandId);
    if (!this.survival.acceptCommand(p.id,command.commandId,now)) { this.sendSnapshots(); return; }
    let result: SurvivalResult;
    switch (command.type) {
      case "survival.select": result=this.survival.selectSlot(p.id,command.slot); break;
      case "survival.equip": result=this.survival.equip(p.id,command.item); break;
      case "survival.eat": result=this.survival.eat(p,now); break;
      case "survival.harvest": result=this.survival.harvest(p,command.treeId,now); break;
      case "survival.pickup": result=this.survival.pickup(p,command.backpackId,now); break;
      case "survival.attack": {
        const target=this.players.get(command.targetId);
        result=target?this.survival.attack(p,target,now):{ok:false,reason:"That player is no longer here"}; break;
      }
    }
    if (!result.ok) this.notice(client,"SURVIVAL_UNAVAILABLE",result.reason,command.commandId);
    else { for (const id of result.deaths) this.knockout(id,"player",now); const idle=this.idlePresence.get(p.id); if(idle)recordActivity(idle,now); }
    this.sendSnapshots();
  }
  /** All causes share one life fence, movement lock and respawn path. */
  private knockout(id: string, cause: NonNullable<PlayerState["caughtBy"]>, now: number) {
    const player=this.players.get(id); if(!player || player.respawnAt)return false;
    player.respawnCount=(player.respawnCount??0)+1;player.caughtAt=now;player.caughtBy=cause;player.respawnAt=now+900;
    player.vx=player.vy=0;player.lastInputSeq=Math.max(player.lastInputSeq,this.intents.get(id)?.value.seq??-1);
    cancelSprint(player,now);delete player.seatId;delete player.roastingAt;this.intents.delete(id);
    if(cause==="hunger"||cause==="player") {const client=this.clientsByUser.get(id);if(client)this.notice(client,"SURVIVAL_KNOCKOUT",cause==="hunger"?"You ran out of energy. Returning to the fire…":"You were knocked down. Returning to the fire…");}
    return true;
  }
  private changeWorld(worldId: "living-room"|"forest") {
    this.worldId=worldId; this.worldRevision++; this.worldProposal=null;
    this.encounter=getWorld(worldId).stalker?new ForestEncounter(getWorld(worldId)):null;
    this.encounter?.reset(Date.now());
    this.werewolf=worldId==="forest"?new ForestWerewolf(getWorld(worldId)):null;
    this.werewolf?.reset(Date.now());
    this.mimic=worldId==="forest"?new ForestMimic(getWorld(worldId)):null;
    this.npcs=worldId==="forest"?createAuthoredForestNPCs(getWorld(worldId)):null; this.lastNPCTick=0;
    this.mimic?.reset(Date.now());
    this.proposals.clear(); this.chats.home=[]; this.chats.race=[];
    this.race={id:randomUUID(),phase:"lobby",startAt:0,endAt:0,readyIds:[],results:[]};
    const map=getWorld(worldId).map;
    // Includes grace-reserved avatars; reconnect never restores the old map.
    for (const p of this.players.values()) Object.assign(p, clearRaceBoosts(p));
    const sorted=[...this.players.values()].sort((a,b)=>a.id.localeCompare(b.id));
    sorted.forEach((p,i)=>{if(p.respawnAt)this.survival.respawn(p.id);cancelSprint(p,Date.now());delete p.zone;p.zoneRevision=(p.zoneRevision??0)+1;p.mode="home";p.x=map.spawns[i]!.x;p.y=map.spawns[i]!.y;p.vx=p.vy=0;p.lastInputSeq=Math.max(p.lastInputSeq,this.intents.get(p.id)?.value.seq??-1);delete p.seatId;delete p.roastingAt;delete p.finishedAt;delete p.haloUntil;delete p.caughtAt;delete p.caughtBy;delete p.respawnAt;});
    this.intents.clear();
    this.broadcast("transition",{mode:"home",worldId,worldRevision:this.worldRevision,instanceId:this.homeId+":home:"+this.worldRevision});
    this.sendSnapshots();
  }
  private simulate(dt: number) {
    const now = Date.now();
    this.tick++;
    if(this.worldProposal && now>=this.worldProposal.endsAt) this.changeWorld(this.worldProposal.worldId);
    if (this.race.phase === "countdown" && now >= this.race.startAt)
      this.race.phase = "running";
    for (const [id, p] of this.players) {
      if(p.respawnAt){
        if(now<p.respawnAt){p.vx=p.vy=0;continue;}
        this.survival.respawn(id);
        Object.assign(p,this.findHomeSpawn(id),{vx:0,vy:0,haloUntil:now+5000,flashlightBattery:1,flashlightOn:false});delete p.respawnAt;this.intents.delete(id);
      }
      if(p.caughtAt&&now-p.caughtAt>2500){delete p.caughtAt;delete p.caughtBy;}
      const intent = this.intents.get(id);
      const input =
        p.connected && intent && now - intent.receivedAt < 250
          ? intent.value
          : neutral(p.lastInputSeq);
      if (p.mode === "home") {
        if(p.connected&&getWorld(p.zone??this.worldId).dark){
          Object.assign(p,stepFlashlight({flashlightBattery:p.flashlightBattery??1,flashlightOn:p.flashlightOn??false},dt));
        }
        if (p.seatId) Object.assign(p, stepHome(p, neutral(p.lastInputSeq), dt, this.mapFor(p), now-dt*1000));
        if (!p.seatId) {
          const next=stepHome(p,input,dt,this.mapFor(p),now-dt*1000);this.players.set(id,next);
          const door=next.zone?{x:10,y:17.5}:ASYLUM_DOOR;
          if(this.worldId==="forest"&&!this.worldProposal&&next.connected&&!next.respawnAt){
            if(Math.hypot(next.vx,next.vy)>.05&&(!next.zone||next.zone==="asylum")&&distance(next,door)<.65)this.moveArea(next,!next.zone);
            // A quick exit walk can reach the door during the entry cooldown.
            // Complete that transition when it expires even after input stops.
            const interior=FOREST_INTERIORS.find(i=>i.id===next.zone);if(interior&&distance(next,interior.exit)<.65)this.moveInterior(next,"outside");
          }
        }

        const current=this.players.get(id)!;
        const charger=this.mapFor(current).seats.find(seat=>seat.id==="charger-seat");
        if(current.connected&&charger&&distance(current,charger)<=.8&&isHomeSegmentWalkable(current,charger,this.mapFor(current)))current.flashlightBattery=1;

      } else if (
        this.race.phase === "running" &&
        !p.finishedAt &&
        !this.race.results.some((r) => r.playerId === id && r.dnf)
      ) {
        const next = stepRace(p, input, dt);
        this.players.set(id, next);
        if (hasFinishedRace(next)) {
          Object.assign(next, clearRaceBoosts(next));
          next.finishedAt = now;
          this.race.results.push({
            playerId: id,
            name: next.name,
            rank: null,
            finishedAt: now,
            elapsedMs: now - this.race.startAt,
            dnf: false,
          });
        }
      }
    }
    const hungerDeaths=this.survival.tick(now,this.worldId==="forest"?[...this.players.values()]:[]);
    for(const id of hungerDeaths)this.knockout(id,"hunger",now);
    if(this.worldId==="forest"){
      for(const hit of this.combat?.update(now,this.combatants())??[]){const victim=this.players.get(hit.targetId);if(victim){const result=this.survival.damageWorld(victim,hit.amount,now);if(result.ok)for(const id of result.deaths)this.knockout(id,"player",now);}}
      this.commitDefeats();
    }
    const outside=[...this.players.values()].filter(p=>!p.zone);
    if (now - this.lastNPCTick >= 100) { this.npcs?.update(now,{phase:worldDayAt(worldClimateAt(now,this.homeId),now).phase}); this.lastNPCTick=now; }
    // NPCs continue everywhere, but do not turn a resting human party into a hunting encounter.
    const exposed = outside.some(p=>p.connected&&p.mode==="home"&&!p.respawnAt&&(p.haloUntil??0)<=now&&distance(p,getWorld(this.worldId).fire??p)>9.5);
    const prey=exposed?[...outside,...(this.npcs?.prey()??[])]:outside;
    const catches: {id:string|null|undefined;cause:"mimic"|"werewolf"|"clown";encounterId?:string}[]=[];
    if(!this.encounter?.state&&!this.werewolf?.state)catches.push({id:this.mimic?.update(now,prey,outside),cause:"mimic",encounterId:this.mimic?.state?.id});
    if(!this.encounter?.state&&!this.mimic?.state)catches.push({id:this.werewolf?.update(now,prey,outside),cause:"werewolf",encounterId:this.werewolf?.state?.id});
    if(!this.werewolf?.state&&!this.mimic?.state)catches.push({id:this.encounter?.update(now,prey,outside),cause:"clown",encounterId:this.encounter?.state?.id});
    for(const source of [this.encounter,this.werewolf,this.mimic])for(const cue of source?.drainSounds()??[])this.worldSound({...cue,id:this.epoch+":"+this.worldRevision+":"+cue.id});
    for(const caught of catches) {
      if(!caught.id)continue;
      const npc=this.npcs?.get(caught.id),player=this.players.get(caught.id),victim=player??npc;
      if(!victim)continue;
      if(npc){if(!this.npcs?.catch(npc.id,now))continue;}
      else if(!this.knockout(caught.id,caught.cause,now))continue;
      this.worldSound({id:`${this.epoch}:${this.worldRevision}:${caught.cause}:${caught.encounterId}:hit:${caught.id}`,kind:caught.cause==="mimic"?"mimic-hit":caught.cause==="werewolf"?"claw":"slash",x:victim.x,y:victim.y,...(player?{victimId:player.id}:{}),createdAt:now,expiresAt:now+1000});
      if(player){const client=this.clientsByUser.get(player.id);if(client)this.notice(client,"FOREST_CAUGHT",`The ${caught.cause} caught you. Returning to the fire...`);}
      this.sendSnapshots();
    }
    if (this.race.phase === "running" && now >= this.race.endAt) {
      for (const p of this.players.values())
        if (p.mode === "race" && !p.finishedAt) this.recordDnf(p, "timeout");
      this.race.phase = "results";
    }
    this.checkRaceCompletion();
    for (const [key, v] of this.proposals)
      if (v.effect.expiresAt < now) this.proposals.delete(key);
  }
  private worldSound(event:WorldSoundEvent){
    event={...event,epoch:this.epoch,worldRevision:this.worldRevision};
    for(const [id,client] of this.clientsByUser){const listener=this.players.get(id);if(listener?.connected&&listener.mode==="home"&&!listener.zone&&distance(listener,event)<=(event.kind==="howl"?32:12))client.send("world.sound",event);}
  }
  private recordDnf(p: PlayerState, reason: RaceResult["reason"]) {
    if (this.race.results.some((r) => r.playerId === p.id)) return;
    this.race.results.push({
      playerId: p.id,
      name: p.name,
      rank: null,
      finishedAt: null,
      elapsedMs: null,
      dnf: true,
      reason,
    });
  }
  private checkRaceCompletion() {
    if (!["running", "countdown"].includes(this.race.phase)) return;
    if (
      this.race.readyIds.every((id) =>
        this.race.results.some((r) => r.playerId === id),
      )
    )
      this.race.phase = "results";
    const finishes = this.race.results
      .filter((r) => !r.dnf)
      .sort(
        (a, b) =>
          a.finishedAt! - b.finishedAt! || a.playerId.localeCompare(b.playerId),
      );
    let rank = 0,
      last: number | null = null;
    finishes.forEach((r, index) => {
      if (r.finishedAt !== last) rank = index + 1;
      r.rank = rank;
      last = r.finishedAt;
    });
  }
  private safeRaceRespawn(p: PlayerState) {
    Object.assign(p, respawnRacePlayer(p));
  }
  private expireIdle(id: string, client: Client, now: number): boolean {
    const state = this.idlePresence.get(id);
    if (!state || !idleStatus(state, now).expired) return false;
    this.notice(client, "IDLE_TIMEOUT", "You left the session after 18 minutes of inactivity. You can join again whenever you’re ready.");
    this.removePresence(id);
    client.leave(4012);
    return true;
  }
  private revalidate() {
    const now = Date.now();
    for (const [id, client] of this.clientsByUser)
      if (this.players.get(id)?.connected) this.expireIdle(id, client, now);
    for (const [id, client] of this.clientsByUser)
      if (!PartyRoom.store.canAccess(this.homeId, id)) {
        this.notice(client, "ACCESS_DENIED", "Your room access was revoked.");
        this.removePresence(id);
        client.leave(4003);
      }
    const home = PartyRoom.store.getHome(this.homeId);
    if (home)
      this.maxClients = Math.min(home.capacity, GAME_CONFIG.partyCapacity) + 1;
  }
  private sendSnapshots() {
    const now = Date.now();
    const climate=this.worldId==="forest"?worldClimateAt(now,this.homeId):undefined,keeper=this.keeperNPC(),npcs=[...(this.npcs?.snapshot()??[]),...(keeper?[keeper]:[])],mobs=this.combat?.snapshot();
    for (const [id, client] of this.clientsByUser) {
      const p = this.players.get(id);
      if (!p) continue;
      const waitingBridge=this.race.phase==="waiting"&&!p.zone;
      const instanceId=p.mode==="home"?this.homeId+":home:"+this.worldRevision+":"+(p.zone??"outside")+":"+(p.zoneRevision??0):this.race.id;
      const partyWideVoice = this.voiceModes.home === "room";
      const voiceContext = { worldRevision: this.worldRevision, race: this.race, mode: this.voiceModes.home };
      const voiceScope = { instanceId: this.homeId + ":" + (partyWideVoice ? "party" : voiceGroup(p, voiceContext)),
        mode: partyWideVoice || waitingBridge ? "room" as const : "proximity" as const,
        participantIds: [...this.players.values()].filter(v => v.connected &&
          (partyWideVoice || voiceGroup(v, voiceContext) === voiceGroup(p, voiceContext))).map(v => v.id) };
      const snapshot: RoomSnapshot = {
        homeId: this.homeId,
        survival: this.worldId==="forest"?this.survival.snapshot():undefined,
        idle: this.idlePresence.has(id) ? (() => { const { warningAt, kickAt } = idleStatus(this.idlePresence.get(id)!, now); return { warningAt, kickAt }; })() : undefined,
        stalker:p.zone?null:this.encounter?.visibleTo(p)??null,
        werewolf:p.zone?null:this.werewolf?.visibleTo(p)??null,
        mimic:p.zone?null:this.mimic?.visibleTo(p)??null,
        npcs:p.mode==="home"&&!p.zone?npcs?.filter(n=>distance(n,p)<56):undefined,
        climate,
        mobs:p.mode==="home"&&!p.zone&&mobs?{...mobs,mobs:mobs.mobs.filter(m=>distance(m,p)<56)}:undefined,
        rootWorldId:this.worldId,worldId:p.zone??this.worldId, worldRevision:this.worldRevision, worldProposal:this.worldProposal, media:this.media,
        instanceId: p.mode === "home" ? this.homeId + ":home:" + this.worldRevision + ":" + (p.zone??"outside") + ":" + (p.zoneRevision??0) : this.race.id,
        epoch: this.epoch,
        serverTime: now,
        members:[...this.players.values()],
        players: [...this.players.values()].filter((v) => v.mode === p.mode&&v.zone===p.zone),
        voiceMode: voiceScope.mode,voiceScope,
        hostId: this.hostId,
        soundboardEnabled: this.soundboardEnabled,
        chat: this.chats[p.mode],
        race: this.race,
      };
      const stream=this.snapshotStreams.get(client);
      try{
        if(stream){const frame=stream.encoder.encode(snapshot,now,stream.forceFull);client.send('snapshot.delta',frame);stream.forceFull=false;}
        else client.send('snapshot',snapshot);
      }catch{if(stream)stream.forceFull=true;/* A dropped recipient must not interrupt authority or other recipients. */}
    }
  }
}
