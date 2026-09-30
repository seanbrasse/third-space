import { Room, ServerError, type Client } from "@colyseus/core";
import { randomUUID } from "node:crypto";
import { GAME_CONFIG, HOME_MAP, RACE_MAP } from "@third-space/config";
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
    if (this.clientsByUser.get(id) !== client) {
      client.leave(4011);
      return;
    }
    const player = this.players.get(id);
    if (player) {
      player.connected = true;
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
    const occupied = [...this.players.values()].filter(
      (player) => player.mode === "home" && player.id !== excludeId,
    );
    const safe = (point: { x: number; y: number }) =>
      point.x >= GAME_CONFIG.playerRadius &&
      point.x <= HOME_MAP.width - GAME_CONFIG.playerRadius &&
      point.y >= GAME_CONFIG.playerRadius &&
      point.y <= HOME_MAP.height - GAME_CONFIG.playerRadius &&
      !HOME_MAP.solids.some((solid) => overlapsPlayer(point, solid)) &&
      occupied.every(
        (player) => distance(player, point) >= 2 * GAME_CONFIG.playerRadius,
      );
    const authored = HOME_MAP.spawns.find(safe);
    if (authored) return { x: authored.x, y: authored.y };
    // Moving occupants can cover more than one authored point. Find a nearby clear
    // location rather than stacking a new/returning avatar on another participant.
    const candidates: { x: number; y: number }[] = [];
    for (let y = 1.5; y < HOME_MAP.height - 1; y += 0.75)
      for (let x = 1.5; x < HOME_MAP.width - 1; x += 0.75)
        candidates.push({ x, y });
    candidates.sort(
      (a, b) => distance(a, HOME_MAP.spawn) - distance(b, HOME_MAP.spawn),
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
    switch (command.type) {
      case "input": {
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
        if (command.input.axisX || command.input.axisY) delete p.seatId;
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
        const seat = HOME_MAP.seats.find((s) => s.id === command.seatId);
        if (p.mode !== "home" || !seat || distance(p, seat) > GAME_CONFIG.interactionDistance || !isHomeSegmentWalkable(p, seat))
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

  private simulate(dt: number) {
    const now = Date.now();
    this.tick++;
    if (this.race.phase === "countdown" && now >= this.race.startAt)
      this.race.phase = "running";
    for (const [id, p] of this.players) {
      const intent = this.intents.get(id);
      const input =
        p.connected && intent && now - intent.receivedAt < 250
          ? intent.value
          : neutral(p.lastInputSeq);
      if (p.mode === "home") {
        if (!p.seatId) this.players.set(id, stepHome(p, input, dt));
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
    if (this.race.phase === "running" && now >= this.race.endAt) {
      for (const p of this.players.values())
        if (p.mode === "race" && !p.finishedAt) this.recordDnf(p, "timeout");
      this.race.phase = "results";
    }
    this.checkRaceCompletion();
    for (const [key, v] of this.proposals)
      if (v.effect.expiresAt < now) this.proposals.delete(key);
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
        instanceId: p.mode === "home" ? this.homeId + ":home" : this.race.id,
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
