import { ForestEncounter } from "./ForestStalker";
import { Room, ServerError, type Client } from "@colyseus/core";
import { randomUUID } from "node:crypto";
import { resolveMediaLink, GAME_CONFIG, HOME_MAP, RACE_MAP, getWorld, WORLD_COUNTDOWN_MS, type WorldId } from "@third-space/config";
import {
  parseCommand,
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
} from "@third-space/contracts";
import {
  createPlayer,
  stepHome,
  stepRace,
  resetRacePlayer,
  hasFinishedRace,
  respawnRacePlayer,
  overlapsPlayer,
  canUseFurniture,
  isHomeSegmentWalkable,
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
  homeId = "";
  worldId: WorldId = "forest";
  worldRevision = 0;
  worldProposal: WorldProposal | null = null;
  media: SharedMedia = {revision:0,url:"",playing:false,position:0,anchorAt:0};
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
  private seq = 0;
  private tick = 0;
  private encounter: ForestEncounter | null = null;
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
    this.encounter = getWorld(this.worldId).stalker ? new ForestEncounter(getWorld(this.worldId)) : null;
    this.onMessage("connection.ping", (client, raw: unknown) => {
      const id = (client.auth as Admission)?.userId;
      if (typeof raw !== "number" || !Number.isSafeInteger(raw) || raw < 0 || raw > 1e9 || this.clientsByUser.get(id) !== client || !this.cooled(id, "ping", 1000)) return;
      client.send("connection.pong", raw);
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
      this.clientsByUser.delete(auth.userId);
      existing.leave(4011);
    }
    let player = this.players.get(auth.userId);
    if (!player) {
      player = createPlayer(auth.userId, auth.name, auth.avatar);
      const spawn = this.findHomeSpawn();
      player.x = spawn.x;
      player.y = spawn.y;
    }
    player.connected = true;
    player.flashlightOn ??= true;
    this.players.set(auth.userId, player);
    this.roles.set(auth.userId, auth.role);
    this.clientsByUser.set(auth.userId, client);
    this.chooseHost();
    client.send("welcome", {
      selfId: auth.userId,
      homeId: this.homeId,
      epoch: this.epoch,
    });
    this.sendSnapshots();
  }

  async onDrop(client: Client) {
    const id = (client.auth as Admission).userId;
    if (
      this.clientsByUser.get(id) !== client ||
      !PartyRoom.store.canAccess(this.homeId, id)
    )
      return;
    const player = this.players.get(id);
    if (player) player.connected = false;
    this.intents.delete(id);
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
    const player = this.players.get(id);
    if (player) {
      player.connected = true;
    player.flashlightOn ??= true;
      if (player.mode === "race") this.safeRaceRespawn(player);
    }
    this.clientsByUser.set(id, client);
    client.send("welcome", {
      selfId: id,
      homeId: this.homeId,
      epoch: this.epoch,
    });
    this.sendSnapshots();
  }

  onLeave(client: Client) {
    const id = (client.auth as Admission | undefined)?.userId;
    if (!id || this.clientsByUser.get(id) !== client) return;
    this.removePresence(id);
  }

  private removePresence(id: string) {
    const player = this.players.get(id);
    if (player?.mode === "race" && !player.finishedAt)
      this.recordDnf(player, "disconnected");
    this.clientsByUser.delete(id);
    this.players.delete(id);
    this.roles.delete(id);
    this.intents.delete(id);
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
    if (this.hostId === id) this.hostId = null;
    this.chooseHost();
    this.checkRaceCompletion();
    this.sendSnapshots();
  }

  onDispose() {
    PartyRoom.activeHomes.delete(this.homeId);
    this.unbindAccess?.();
    this.unbindBoard?.();
  }

  private findHomeSpawn(excludeId?: string): { x: number; y: number } {
    const map = getWorld(this.worldId).map;
    const occupied = [...this.players.values()].filter(
      (player) => player.mode === "home" && player.id !== excludeId,
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
    const authored = map.spawns.find(safe);
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
    client.send("notice", {
      code,
      message,
      ...(commandId ? { commandId } : {}),
    });
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
  private emit(mode: "home" | "race", type: string, value: unknown) {
    for (const [id, client] of this.clientsByUser)
      if (this.players.get(id)?.mode === mode) client.send(type, value);
  }

  private command(client: Client, id: string, command: ClientCommand) {
    const p = this.players.get(id);
    if (!p || !p.connected) return;
    if(p.respawnAt&&!["input.stop","chat.send","world.object","voice.status","voice.mode"].includes(command.type))return;
    switch (command.type) {
      case "world.propose": {
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
      case "flashlight": p.flashlightOn=command.enabled; break;
      case "roast": {
        const fire=getWorld(this.worldId).fire;
        if(command.enabled && (p.mode!=="home" || !fire || distance(p,fire)>4))
          return this.notice(client,"TOO_FAR","Come close to the campfire to roast a marshmallow.");
        if(command.enabled) p.roastingAt=Date.now(); else delete p.roastingAt;
        break;
      }
      case "media.control": {
        const key=id+":"+command.commandId;
        if(this.acceptedMediaCommands.has(key))break;
        if(id!==this.hostId)return this.notice(client,"ACCESS_DENIED","The host controls shared playback.");
        if(command.revision!==this.media.revision)return this.notice(client,"MEDIA_CONFLICT","Playback changed. Try again with the latest controls.");
        const now=Date.now();
        const position=Math.min(86400,this.media.position+(this.media.playing?Math.max(0,now-this.media.anchorAt)/1000:0));
        if(command.action==="source") {
          if(!command.url)return this.notice(client,"INVALID_MEDIA","Paste a YouTube link or an HTTPS video file link.");
          try {
            const source=resolveMediaLink(command.url);
            this.media={revision:this.media.revision+1,url:source.url,playing:false,position:source.start,anchorAt:now};
          }catch(error){return this.notice(client,"INVALID_MEDIA",(error as Error).message);}
        } else {
          if(!this.media.url)return this.notice(client,"INVALID_MEDIA","Choose a video first.");
          this.media={...this.media,revision:this.media.revision+1,position:command.action==="seek"?command.position??position:position,anchorAt:now,playing:command.action==="play"?true:command.action==="pause"?false:this.media.playing};
        }
        this.acceptedMediaCommands.add(key); if(this.acceptedMediaCommands.size>256)this.acceptedMediaCommands.delete(this.acceptedMediaCommands.values().next().value!);
        this.sendSnapshots(); break;
      }
      case "input.stop": { const seq=this.intents.get(id)?.value.seq??p.lastInputSeq;this.intents.set(id,{value:neutral(seq),receivedAt:Date.now()});p.vx=p.vy=0;break;}
      case "input": {
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
        this.intents.set(id, { value: command.input, receivedAt: Date.now() });
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
        const seat = getWorld(this.worldId).map.seats.find((s) => s.id === command.seatId);
        if (p.mode !== "home" || !seat || distance(p, seat) > GAME_CONFIG.interactionDistance || !isHomeSegmentWalkable(p, seat, getWorld(this.worldId).map))
          return this.notice(client, "TOO_FAR", "Walk closer to that seat.");
        if (
          [...this.players.values()].some(
            (other) => other.seatId === seat.id && other.id !== id,
          )
        )
          return this.notice(
            client,
            "SEAT_TAKEN",
            "Someone is already sitting there.",
          );
        p.seatId = seat.id;
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
            target.mode !== p.mode ||
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
        } else this.emit(p.mode, "effect", effect);
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
          source.mode !== p.mode ||
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
        });
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
        });
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
        p.nativeMode = "off";
        p.manualMute = command.manualMute;
        p.deafened = command.deafened;
        if (command.nativeMode !== "off")
          this.notice(
            client,
            "MEDIA_NOT_CONFIGURED",
            "Native voice needs a configured, verified media service. Gameplay and chat remain available.",
          );
        break;
      case "voice.mode":
        if (id === this.hostId) this.voiceModes[p.mode] = command.mode;
        else
          this.notice(
            client,
            "ACCESS_DENIED",
            "Only the host changes room voice mode.",
          );
        break;
      case "race.ready": {
        if(this.worldId!=="living-room" || this.worldProposal) return this.notice(client,"WORLD_BUSY","Return to the lounge before starting Garden Dash.");
        if (p.mode !== "home" || this.race.phase !== "lobby")
          return this.notice(
            client,
            "RACE_ACTIVE",
            "A race is already in progress.",
          );
        const portal = HOME_MAP.furniture.find((item) => item.id === HOME_MAP.portal.id)!;
        if (command.ready && !canUseFurniture(p, portal))
          return this.notice(
            client,
            "TOO_FAR",
            "Walk over to the glowing portal to join the race.",
          );
        this.race.readyIds = this.race.readyIds.filter((value) => value !== id);
        if (command.ready) this.race.readyIds.push(id);
        break;
      }
      case "race.start": {
        if(this.worldId!=="living-room" || this.worldProposal) return this.notice(client,"WORLD_BUSY","Finish the world change first.");
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
        const now = Date.now();
        this.race = {
          id: randomUUID(),
          phase: "countdown",
          startAt: now + 3000,
          endAt: now + 123000,
          readyIds: ready,
          results: [],
        };
        this.chats.race = [];
        this.voiceModes.race = this.voiceModes.home;
        for (const pid of ready) {
          this.players.set(pid, resetRacePlayer(this.players.get(pid)!));
          this.intents.delete(pid);
          this.clientsByUser
            .get(pid)
            ?.send("transition", { mode: "race", instanceId: this.race.id });
        }
        break;
      }
      case "race.return": {
        if (p.mode !== "race") break;
        if (!p.finishedAt && this.race.phase !== "results")
          this.recordDnf(p, "returned");
        const spawn = this.findHomeSpawn(id);
        p.mode = "home";
        p.x = spawn.x;
        p.y = spawn.y;
        p.vx = p.vy = 0;
        delete p.finishedAt;
        this.intents.delete(id);
        client.send("transition", {
          mode: "home",
          instanceId: this.homeId + ":home",
        });
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

  private changeWorld(worldId: WorldId) {
    this.worldId=worldId; this.worldRevision++; this.worldProposal=null;
    this.encounter=getWorld(worldId).stalker?new ForestEncounter(getWorld(worldId)):null;
    this.encounter?.reset(Date.now());
    this.proposals.clear(); this.chats.home=[]; this.chats.race=[];
    this.race={id:randomUUID(),phase:"lobby",startAt:0,endAt:0,readyIds:[],results:[]};
    const map=getWorld(worldId).map;
    // Includes grace-reserved avatars; reconnect never restores the old map.
    const sorted=[...this.players.values()].sort((a,b)=>a.id.localeCompare(b.id));
    sorted.forEach((p,i)=>{p.mode="home";p.x=map.spawns[i]!.x;p.y=map.spawns[i]!.y;p.vx=p.vy=0;p.lastInputSeq=Math.max(p.lastInputSeq,this.intents.get(p.id)?.value.seq??-1);p.flashlightOn=true;delete p.seatId;delete p.roastingAt;delete p.finishedAt;delete p.haloUntil;delete p.caughtAt;delete p.respawnAt;});
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
        Object.assign(p,this.findHomeSpawn(id),{vx:0,vy:0,haloUntil:now+5000});delete p.respawnAt;this.intents.delete(id);
      }
      if(p.caughtAt&&now-p.caughtAt>2500)delete p.caughtAt;
      const intent = this.intents.get(id);
      const input =
        p.connected && intent && now - intent.receivedAt < 250
          ? intent.value
          : neutral(p.lastInputSeq);
      if (p.mode === "home") {
        if (!p.seatId) this.players.set(id, stepHome(p, input, dt, getWorld(this.worldId).map));
      } else if (
        this.race.phase === "running" &&
        !p.finishedAt &&
        !this.race.results.some((r) => r.playerId === id && r.dnf)
      ) {
        const next = stepRace(p, input, dt);
        this.players.set(id, next);
        if (hasFinishedRace(next)) {
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
    const previousEncounter=this.encounter?.state?.id;
    const caught=this.encounter?.update(now,[...this.players.values()]);
    const encounter=this.encounter?.state;
    if(encounter?.id!==previousEncounter&&encounter?.giggleAt)this.worldSound({id:this.epoch+":"+this.worldRevision+":"+encounter.id+":giggle",kind:"giggle",x:encounter.x,y:encounter.y,createdAt:now,expiresAt:now+1200});
    if(caught){
      const player=this.players.get(caught)!;
      player.respawnCount=(player.respawnCount??0)+1;player.caughtAt=now;player.respawnAt=now+900;
      this.worldSound({id:this.epoch+":"+this.worldRevision+":"+encounter!.id+":slash",kind:"slash",x:player.x,y:player.y,victimId:caught,createdAt:now,expiresAt:now+1000});
      player.vx=player.vy=0;player.lastInputSeq=Math.max(player.lastInputSeq,this.intents.get(caught)?.value.seq??-1);
      delete player.seatId;delete player.roastingAt;this.intents.delete(caught);
      const client=this.clientsByUser.get(caught);if(client)this.notice(client,"FOREST_CAUGHT","The clown caught you. Returning to the fire...");
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
    for(const [id,client] of this.clientsByUser){const listener=this.players.get(id);if(listener?.connected&&listener.mode==="home"&&distance(listener,event)<=12)client.send("world.sound",event);}
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
  private revalidate() {
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
    for (const [id, client] of this.clientsByUser) {
      const p = this.players.get(id);
      if (!p) continue;
      const snapshot: RoomSnapshot = {
        homeId: this.homeId,
        stalker:this.encounter?.visibleTo(p)??null,
        worldId:this.worldId, worldRevision:this.worldRevision, worldProposal:this.worldProposal, media:this.media,
        instanceId: p.mode === "home" ? this.homeId + ":home:" + this.worldRevision : this.race.id,
        epoch: this.epoch,
        serverTime: now,
        players: [...this.players.values()].filter((v) => v.mode === p.mode),
        voiceMode: this.voiceModes[p.mode],
        hostId: this.hostId,
        soundboardEnabled: this.soundboardEnabled,
        chat: this.chats[p.mode],
        race: this.race,
      };
      client.send("snapshot", snapshot);
    }
  }
}
