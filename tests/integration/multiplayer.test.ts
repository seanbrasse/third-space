import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Client, type Room } from "@colyseus/sdk";
import type {
  ChatMessage,
  ClientCommand,
  RoomSnapshot,
  ServerNotice,
  SocialEffect,
  WorldSoundEvent,
} from "../../packages/contracts/src/index";
import { HOME_MAP, RACE_MAP } from "../../packages/config/src/index";
import { distance, findHomePath, isHomeSegmentWalkable } from "../../packages/simulation/src/index";
import { createGameServer } from "../../apps/game-server/src/server";

import {ForestMimic} from "../../apps/game-server/src/ForestMimic";
import {getWorld} from "../../packages/config/src/index";
import { PartyRoom } from "../../apps/game-server/src/PartyRoom";
const origin = "http://localhost:3000";
type Identity = { id: string; cookie: string; name: string };
type Peer = {
  room: Room;
  identity: Identity;
  snapshot?: RoomSnapshot;
  chats: ChatMessage[];
  notices: ServerNotice[];
  effects: SocialEffect[];
  sounds: WorldSoundEvent[];
  seq: number;
  left: boolean;
};
let runtime: ReturnType<typeof createGameServer>;
let base = "";
let identities: Identity[] = [];
let active: Peer[] = [];
const pause = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
async function until<T>(
  read: () => T | undefined | false,
  message: string,
  timeout = 5_000,
): Promise<T> {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const value = read();
    if (value) return value as T;
    await pause(20);
  }
  throw new Error(message);
}
async function request(
  path: string,
  identity?: Identity,
  body?: unknown,
  method = body === undefined ? "GET" : "POST",
) {
  const response = await fetch(`${base}/api${path}`, {
    method,
    headers: {
      Origin: origin,
      ...(identity ? { Cookie: identity.cookie } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { response, data: (await response.json()) as any };
}
async function home(owner: Identity, name: string) {
  const result = await request("/homes", owner, { name, pin: "123456" });
  expect(result.response.status).toBe(201);
  return result.data.home.id as string;
}
async function admission(
  homeId: string,
  identity: Identity,
  credential: unknown = { pin: "123456" },
) {
  const joined = await request(`/homes/${homeId}/join`, identity, credential);
  expect(joined.response.status).toBe(200);
  const ticket = await request(`/homes/${homeId}/ticket`, identity, {});
  expect(ticket.response.status).toBe(200);
  return ticket.data.ticket as string;
}
async function connect(
  homeId: string,
  identity: Identity,
  credential?: unknown,
  replaceExisting = false,
) {
  const ticket = await admission(homeId, identity, credential);
  const room = await new Client(base.replace("http:", "ws:")).joinOrCreate(
    "party",
    { homeId, ticket, replaceExisting },
  );
  const peer: Peer = {
    room,
    identity,
    chats: [],
    notices: [],
    effects: [],
    sounds: [],
    seq: 0,
    left: false,
  };
  room.onMessage("snapshot", (snapshot: RoomSnapshot) => {
    peer.snapshot = snapshot;
  });
  room.onMessage("chat", (chat: ChatMessage) => peer.chats.push(chat));
  room.onMessage("notice", (notice: ServerNotice) => peer.notices.push(notice));
  room.onMessage("effect", (effect: SocialEffect) => peer.effects.push(effect));
  room.onMessage("world.sound", (sound: WorldSoundEvent) => peer.sounds.push(sound));
  room.onMessage("welcome", () => {});
  room.onMessage("transition", () => {});
  room.onMessage("board.changed", () => {});
  room.onLeave(() => {
    peer.left = true;
  });
  active.push(peer);
  await until(
    () => peer.snapshot,
    "Player did not receive an authoritative snapshot",
  );
  return peer;
}
function send(peer: Peer, command: ClientCommand) {
  peer.room.send("command", command);
}
async function move(
  peer: Peer,
  axisX: number,
  axisY: number,
  duration: number,
  jump = false,
) {
  const tick = () =>
    send(peer, {
      type: "input",
      input: { seq: peer.seq++, axisX, axisY, jump },
    });
  tick();
  const timer = setInterval(tick, 40);
  try {
    await pause(duration);
  } finally {
    clearInterval(timer);
    send(peer, {
      type: "input",
      input: { seq: peer.seq++, axisX: 0, axisY: 0, jump: false },
    });
  }
}


async function walkToPortal(peer: Peer) {
  const start = peer.snapshot!.players.find((player) => player.id === peer.identity.id)!;
  const portal = HOME_MAP.furniture.find((item) => item.id === HOME_MAP.portal.id)!;
  const goal = [...portal.usePoints].sort((a, b) => distance(start, a) - distance(start, b))[0]!;
  const path = findHomePath(start, goal);
  expect(path).not.toBeNull();
  const started = Date.now();
  for (const target of path!.slice(1)) {
    while (true) {
      const state = peer.snapshot!.players.find((player) => player.id === peer.identity.id)!;
      const remaining = distance(state, target);
      if (remaining < 0.18) break;
      if (Date.now() - started > 8_000) throw new Error("Could not walk to the portal using authoritative input");
      // Slow near a waypoint to absorb snapshot and network latency without overshooting.
      const magnitude = Math.min(1, remaining * 2);
      send(peer, {type: "input", input: {seq: peer.seq++, axisX: (target.x - state.x) / remaining * magnitude, axisY: (target.y - state.y) / remaining * magnitude, jump: false}});
      await pause(40);
    }
  }
  send(peer, {type: "input", input: {seq: peer.seq++, axisX: 0, axisY: 0, jump: false}});
}

describe("real HTTP admission and Colyseus multiplayer", () => {
  it('shares one backpack winner and authoritative knife damage across eight socket clients',async()=>{
    const homeId=await home(identities[0]!,"Forest survival sockets");
    const peers:Peer[]=[];for(const identity of identities.slice(0,8))peers.push(await connect(homeId,identity));
    const authority=PartyRoom.liveRooms.get(homeId)!;
    (authority as unknown as {changeWorld:(id:'forest')=>void}).changeWorld('forest');
    await until(()=>peers.every(p=>p.snapshot?.survival?.backpacks.length===2),"Forest survival state missing");
    const bag=peers[0]!.snapshot!.survival!.backpacks[0]!;
    for(const p of authority.players.values()){p.x=bag.x;p.y=bag.y;delete p.seatId;delete p.haloUntil;}
    const action=(peer:Peer,body:Record<string,unknown>)=>{const snap=peer.snapshot!,player=snap.players.find(p=>p.id===peer.identity.id)!;peer.room.send('command',{commandId:crypto.randomUUID(),worldRevision:snap.worldRevision,lifeRevision:player.respawnCount??0,zoneRevision:player.zoneRevision??0,...body});};
    for(const peer of peers)action(peer,{type:'survival.pickup',backpackId:bag.id});
    await until(()=>peers.every(p=>p.snapshot?.survival?.players.filter(p=>p.knifeId===bag.id).length===1),"Contested pickup did not converge");
    const ownerId=peers[0]!.snapshot!.survival!.players.find(p=>p.knifeId===bag.id)!.id;
    const owner=peers.find(p=>p.identity.id===ownerId)!,victim=peers.find(p=>p!==owner)!;
    action(owner,{type:'survival.equip',item:'knife'});
    await until(()=>owner.snapshot?.survival?.players.find(p=>p.id===ownerId)?.equipped==='knife',"Equip not acknowledged");
    const a=authority.players.get(ownerId)!,b=authority.players.get(victim.identity.id)!;
    const clear=[{x:a.x+.7,y:a.y},{x:a.x-.7,y:a.y},{x:a.x,y:a.y+.7}].find(p=>isHomeSegmentWalkable(a,p,getWorld('forest').map))!;
    expect(clear).toBeDefined();Object.assign(b,clear);
    action(owner,{type:'survival.attack',targetId:b.id,commandId:'network-once'});
    await until(()=>peers.every(p=>p.snapshot?.survival?.players.find(v=>v.id===b.id)?.health===70),"Damage did not converge");
    action(owner,{type:'survival.attack',targetId:b.id,commandId:'network-once'});await pause(100);
    expect(victim.snapshot!.survival!.players.find(p=>p.id===b.id)!.health).toBe(70);
    for(let hit=0;hit<3;hit++){await pause(850);action(owner,{type:'survival.attack',targetId:b.id});}
    await until(()=>victim.snapshot?.players.find(p=>p.id===b.id)?.caughtBy==='player',"Knockout not shared");
    await until(()=>victim.snapshot?.survival?.players.find(p=>p.id===b.id)?.health===100,"Respawn did not restore health");
    expect(victim.snapshot!.players.find(p=>p.id===b.id)!.respawnCount).toBe(1);
    expect(victim.sounds.filter(s=>s.victimId===b.id)).toHaveLength(0);
    expect(peers.every(p=>p.snapshot!.members.length===8&&p.snapshot!.survival!.backpacks.length<=2)).toBe(true);
  },15000);
  beforeAll(async () => {
    // These existing network regressions explicitly start in the retained lounge.
    const create = PartyRoom.prototype.onCreate;
    vi.spyOn(PartyRoom.prototype,"onCreate").mockImplementation(function(options){ this.worldId="living-room"; return create.call(this,options); });
    runtime = createGameServer({ dataPath: ":memory:", origins: [origin] });
    await runtime.server.listen(0, "127.0.0.1");
    const address = runtime.httpServer.address();
    if (!address || typeof address === "string")
      throw new Error("Could not determine the test port");
    base = `http://127.0.0.1:${address.port}`;
    for (const name of [
      "Nova",
      "Sage",
      "Wren",
      "June",
      "Ash",
      "River",
      "Moss",
      "Fern",
      "Rowan",
    ]) {
      const { response, data } = await request("/identity", undefined, {
        name,
      });
      expect(response.status).toBe(201);
      identities.push({
        id: data.profile.id,
        name,
        cookie: response.headers.get("set-cookie")!.split(";")[0]!,
      });
    }
  });
  afterEach(async () => {
    await Promise.all(
      active.map(async (peer) => {
        if (!peer.left) await peer.room.leave();
      }),
    );
    active = [];
    await pause(60);
  });
  afterAll(async () => {
    await runtime.server.gracefullyShutdown(false);
    runtime.store.close();
    vi.restoreAllMocks();
  });

  it("shares mimic morph and catch over real sockets without replaying its roar on tab replacement",async()=>{
    const homeId=await home(identities[0]!,"Mimic socket QA");
    const peers=[await connect(homeId,identities[0]!),await connect(homeId,identities[1]!)];
    const authority=PartyRoom.liveRooms.get(homeId)!;
    const controls=authority as unknown as {changeWorld(id:'forest'):void;mimic:ForestMimic;encounter:null;werewolf:null};
    controls.changeWorld('forest');controls.encounter=null;controls.werewolf=null;
    const now=Date.now(),mimic=new ForestMimic(getWorld('forest'),()=>.5);mimic.reset(now);
    const target=authority.players.get(peers[0]!.identity.id)!;
    for(const peer of peers)Object.assign(authority.players.get(peer.identity.id)!,{x:38,y:24,seatId:undefined});
    mimic.state={kind:'mimic',id:'network-fixture',x:40,y:24,originX:40,originY:24,coverId:'tree',targetId:target.id,disguisePlayerId:peers[1]!.identity.id,disguise:{...target.avatar},phase:'approach',startedAt:now,phaseUntil:now+28000,transformed:false};controls.mimic=mimic;
    await until(()=>peers.every(p=>p.snapshot?.mimic?.phase==='morph'),'Both peers did not see morph');
    expect(peers[0]!.snapshot!.mimic!.disguise).toEqual(peers[1]!.snapshot!.mimic!.disguise);
    for(const peer of peers)expect(peer.sounds.filter(e=>e.kind==='mimic-roar')).toHaveLength(1);
    const replacement=await connect(homeId,identities[0]!,undefined,true);
    expect(replacement.sounds.filter(e=>e.kind==='mimic-roar')).toHaveLength(0);
    await until(()=>peers[1]!.snapshot?.players.some(p=>p.caughtBy==='mimic'),'No socket client observed catch',8000);
    await until(()=>replacement.snapshot?.players.find(p=>p.id===target.id)?.haloUntil,'Victim did not receive respawn halo',3000);
    expect(replacement.sounds.filter(e=>e.kind==='mimic-roar')).toHaveLength(0);
    expect(replacement.sounds.filter(e=>e.kind==='mimic-hit'&&e.victimId===target.id)).toHaveLength(1);
    expect(peers[1]!.sounds.filter(e=>e.kind==='mimic-hit'&&e.victimId===target.id)).toHaveLength(1);
    expect(replacement.snapshot!.players).toHaveLength(2); // cosmetic disguise never becomes a member
  });

  it("admits eight independent identities into one room, shares movement, and refuses capacity forks", async () => {
    const homeId = await home(identities[0]!, "Eight friends");
    const peers: Peer[] = [];
    for (const identity of identities.slice(0, 8))
      peers.push(await connect(homeId, identity));
    await until(
      () => peers.every((peer) => peer.snapshot?.players.length === 8),
      "Eight clients did not converge",
    );
    expect(new Set(peers.map((peer) => peer.room.roomId)).size).toBe(1);
    expect(
      new Set(peers[0]!.snapshot!.players.map((player) => player.id)).size,
    ).toBe(8);
    const initial = peers[1]!.snapshot!.players.find(
      (player) => player.id === identities[0]!.id,
    )!.x;
    await move(peers[0]!, 1, 0, 450);
    const remote = await until(
      () =>
        peers[1]!.snapshot?.players.find(
          (player) => player.id === identities[0]!.id,
        ),
      "Observer lost the moving player",
    );
    expect(remote.x).toBeGreaterThan(initial + 1);
    expect(remote.x).toBeLessThan(initial + 2.5);
    const extraTicket = await admission(homeId, identities[8]!);
    await expect(
      new Client(base.replace("http:", "ws:")).joinOrCreate("party", {
        homeId,
        ticket: extraTicket,
      }),
    ).rejects.toThrow();
    expect(peers[0]!.snapshot!.players.length).toBe(8);
    const originalToken = peers[0]!.room.reconnectionToken;
    const replacement = await connect(homeId, identities[0]!, undefined, true);
    await until(
      () => peers[0]!.left,
      "Explicit replacement did not close the original tab",
    );
    expect(replacement.room.roomId).toBe(peers[1]!.room.roomId);
    await until(
      () => replacement.snapshot?.players.length === 8,
      "Replacement changed the party capacity",
    );
    expect(
      replacement.snapshot!.players.filter(
        (player) => player.id === identities[0]!.id,
      ),
    ).toHaveLength(1);
    await expect(
      new Client(base.replace("http:", "ws:")).reconnect(originalToken),
    ).rejects.toThrow();
  });

  it("rejects unauthorized HTTP reads, guessed/replayed room tickets and duplicate sessions", async () => {
    const homeId = await home(identities[0]!, "Ticket rules");
    const denied = await request(`/homes/${homeId}`, identities[4]!);
    expect(denied.response.status).toBe(404);
    const owner = await connect(homeId, identities[0]!);
    const client = new Client(base.replace("http:", "ws:"));
    await expect(
      client.joinOrCreate("party", { homeId, ticket: "guessed" }),
    ).rejects.toThrow();
    const duplicateTicket = await admission(homeId, identities[0]!);
    await expect(
      client.joinOrCreate("party", { homeId, ticket: duplicateTicket }),
    ).rejects.toThrow(/SESSION_ACTIVE/);
    await expect(
      client.joinOrCreate("party", { homeId, ticket: duplicateTicket }),
    ).rejects.toThrow();
    await pause(100);
    expect(owner.left).toBe(false);
    expect(owner.snapshot!.players.map((player) => player.id)).toEqual([
      identities[0]!.id,
    ]);
    const originDenied = await fetch(`${base}/api/homes`, {
      method: "POST",
      headers: {
        Cookie: identities[0]!.cookie,
        Origin: "https://other.test",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "No" }),
    });
    expect(originDenied.status).toBe(403);
  });

  it("broadcasts accepted chat once, assigns unique IDs, rejects spoofing, and applies rolling rate limits", async () => {
    const homeId = await home(identities[0]!, "Chat rules");
    const owner = await connect(homeId, identities[0]!);
    const friend = await connect(homeId, identities[1]!);
    send(owner, {
      type: "chat.send",
      commandId: "same-client-id",
      text: "Hello everyone",
    });
    await until(
      () => friend.chats.length === 1,
      "Friend did not receive the accepted chat",
    );
    send(owner, {
      type: "chat.send",
      commandId: "same-client-id",
      text: "Hello everyone",
    });
    send(friend, {
      type: "chat.send",
      commandId: "same-client-id",
      text: "Hello Nova",
    });
    await until(
      () => friend.chats.length === 2,
      "The second sender collided with the first sender ID",
    );
    expect(new Set(friend.chats.map((message) => message.id)).size).toBe(2);
    expect(friend.chats[0]!.senderId).toBe(owner.identity.id);
    owner.room.send("command", {
      type: "chat.send",
      commandId: "spoof",
      text: "I am the host",
      senderId: friend.identity.id,
    });
    await until(
      () => owner.notices.some((notice) => notice.code === "INVALID_COMMAND"),
      "Spoofed sender was not rejected",
    );
    for (let i = 0; i < 5; i++)
      send(owner, {
        type: "chat.send",
        commandId: `rate-${i}`,
        text: `Message ${i}`,
      });
    await until(
      () => owner.notices.some((notice) => notice.code === "RATE_LIMITED"),
      "Chat flood was not limited",
    );
    await until(
      () => friend.snapshot?.chat.length === 6,
      "Accepted history did not converge",
    );
    expect(
      friend.chats.filter((message) => message.senderId === owner.identity.id),
    ).toHaveLength(5);
    expect(
      friend.chats.filter((message) => message.text === "Hello everyone"),
    ).toHaveLength(1);
    expect(
      friend.snapshot!.chat.some((message) => message.text === "I am the host"),
    ).toBe(false);
  });

  it("PIN rotation removes live access and blocks game, board and old-credential reentry", async () => {
    const homeId = await home(identities[0]!, "Revocation rules");
    const owner = await connect(homeId, identities[0]!);
    const friend = await connect(homeId, identities[1]!);
    await until(
      () => owner.snapshot?.players.length === 2,
      "Second player did not join",
    );
    const rotated = await request(
      `/homes/${homeId}/pin`,
      identities[0]!,
      { pin: "654321" },
      "PUT",
    );
    expect(rotated.response.status).toBe(200);
    await until(
      () => friend.left,
      "PIN rotation did not remove the live participant",
      2_000,
    );
    await until(
      () => owner.snapshot?.players.length === 1,
      "Removed player remained in the roster",
    );
    expect(
      (await request(`/homes/${homeId}/board`, identities[1]!)).response.status,
    ).toBe(404);
    expect(
      (await request(`/homes/${homeId}/ticket`, identities[1]!, {})).response
        .status,
    ).toBe(404);
    expect(
      (
        await request(`/homes/${homeId}/join`, identities[1]!, {
          pin: "123456",
        })
      ).response.status,
    ).toBe(403);
  });

  it("keeps spectators home, enforces countdown and server finish rules, isolates chat and returns unchanged avatars", async () => {
    const homeId = await home(identities[0]!, "Portal rules");
    const owner = await connect(homeId, identities[0]!);
    const friend = await connect(homeId, identities[1]!);
    const originalAvatar = owner.snapshot!.players.find(
      (player) => player.id === owner.identity.id,
    )!.avatar;
    send(owner, {
      type: "chat.send",
      commandId: "home-chat",
      text: "Staying in the home history",
    });
    send(friend, { type: "race.start" });
    await until(
      () => friend.notices.some((notice) => notice.code === "ACCESS_DENIED"),
      "Nonhost could start the race",
    );
    send(owner, { type: "race.ready", ready: true });
    await until(
      () => owner.notices.some((notice) => notice.code === "TOO_FAR"),
      "Ready request did not require portal proximity",
    );
    await walkToPortal(owner);
    send(owner, { type: "race.ready", ready: true });
    await until(
      () => owner.snapshot?.race?.readyIds.includes(owner.identity.id),
      "Racer did not ready at the portal",
    );
    send(owner, { type: "race.start" });
    await until(
      () =>
        owner.snapshot?.race?.phase === "countdown" &&
        owner.snapshot.players.every((player) => player.mode === "race"),
      "Race countdown did not begin",
    );
    expect(owner.snapshot!.chat).toHaveLength(0);
    await move(owner, 1, 0, 400, true);
    expect(owner.snapshot!.players[0]!.x).toBe(2);
    expect(
      friend.snapshot!.players.every((player) => player.mode === "home"),
    ).toBe(true);
    send(owner, {
      type: "chat.send",
      commandId: "race-chat",
      text: "Race instance only",
    });
    await until(
      () =>
        owner.snapshot?.chat.some(
          (message) => message.commandId === "race-chat",
        ),
      "Race chat was not accepted",
    );
    expect(
      friend.snapshot!.chat.some(
        (message) => message.text === "Race instance only",
      ),
    ).toBe(false);
    owner.room.send("command", {
      type: "race.finish",
      elapsedMs: 1,
      checkpoint: 4,
      x: RACE_MAP.finish.x,
    });
    await until(
      () => owner.notices.some((notice) => notice.code === "INVALID_COMMAND"),
      "Forged finish command was not rejected",
    );
    await until(
      () => owner.snapshot?.race?.phase === "running",
      "Countdown did not release to running",
    );
    expect(owner.snapshot!.race!.results).toHaveLength(0);
    expect(owner.snapshot!.players[0]!.checkpoint).toBe(0);
    // An unjumped run reaches the first hazard and cannot invent checkpoint progress.
    await move(owner, 1, 0, 1_300);
    expect(owner.snapshot!.players[0]!.checkpoint).toBe(0);
    expect(owner.snapshot!.race!.results).toHaveLength(0);
    send(owner, { type: "race.return" });
    await until(
      () =>
        owner.snapshot?.players.some(
          (player) => player.id === owner.identity.id && player.mode === "home",
        ),
      "Racer did not return home",
    );
    expect(
      owner.snapshot!.players.find((player) => player.id === owner.identity.id)!
        .avatar,
    ).toEqual(originalAvatar);
    expect(
      owner.snapshot!.chat.some(
        (message) => message.text === "Race instance only",
      ),
    ).toBe(false);
    const voice = await request("/media/token", identities[0]!, {});
    expect(voice.response.status).toBe(503);
    expect(voice.data.error.code).toBe("MEDIA_NOT_CONFIGURED");
  }, 35_000);

  it("runs eight independent racers through every obstacle with validated completion and competition ranks", async () => {
    const homeId = await home(identities[0]!, "Eight racers");
    const peers: Peer[] = [];
    for (const identity of identities.slice(0, 8))
      peers.push(await connect(homeId, identity));
    await Promise.all(peers.map((peer) => walkToPortal(peer)));
    for (const peer of peers) send(peer, { type: "race.ready", ready: true });
    await until(
      () => peers[0]!.snapshot?.race?.readyIds.length === 8,
      "All eight players could not ready at the portal",
    );
    send(peers[0]!, { type: "race.start" });
    await until(
      () =>
        peers.every(
          (peer) =>
            peer.snapshot?.race?.phase === "running" &&
            peer.snapshot.players.length === 8,
        ),
      "Eight racers did not share the synchronized start",
    );
    const obstacles = [
      ...RACE_MAP.hazards,
      ...RACE_MAP.platforms.filter((solid) => solid.y < 16),
      ...RACE_MAP.gaps.map(g=>({...g,y:16,height:2})),
    ].sort((a, b) => a.x - b.x);
    const jumps = new Map<string, boolean>();
    const drive = setInterval(() => {
      for (const peer of peers) {
        const racer = peer.snapshot?.players.find(
          (player) => player.id === peer.identity.id,
        );
        if (
          !racer ||
          racer.finishedAt ||
          peer.snapshot?.race?.phase !== "running"
        )
          continue;
        // Estimate forward motion since the received authoritative snapshot,
        // instead of jumping from a position up to one snapshot interval old.
        const predictedX=racer.x+Math.max(0,racer.vx)*Math.min(.15,Math.max(0,(Date.now()-(peer.snapshot?.serverTime??Date.now()))/1000));
        const obstacle = obstacles.find(
          (solid) => solid.x + solid.width > predictedX + 0.3,
        );
        const jump = Boolean(
          racer.grounded &&
            !jumps.get(peer.identity.id) &&
            obstacle &&
            obstacle.x - predictedX < ((racer.raceSpeedBoostSeconds??0)>0?2.1:obstacle.y>=15.3&&obstacle.y<16?1.4:1.8),
        );
        send(peer, {
          type: "input",
          input: { seq: peer.seq++, axisX: 1, axisY: 0, jump },
        });
        jumps.set(peer.identity.id, jump);
      }
    }, 40);
    try {
      await until(
        () => peers.every((peer) => peer.snapshot?.race?.phase === "results"),
        "Eight racers could not complete the course",
        75_000,
      );
    } finally {
      clearInterval(drive);
    }
    const results = peers[0]!.snapshot!.race!.results;
    expect(results).toHaveLength(8);
    expect(new Set(results.map((result) => result.playerId)).size).toBe(8);
    expect(
      results.every(
        (result) =>
          !result.dnf &&
          result.elapsedMs! >= 50_000 &&
          result.elapsedMs! < 75_000,
      ),
    ).toBe(true);
    const finishTimes = results
      .map((result) => result.finishedAt!)
      .sort((a, b) => a - b);
    for (const result of results)
      expect(result.rank).toBe(
        finishTimes.findIndex((time) => time === result.finishedAt) + 1,
      );
    for (const peer of peers)
      expect(peer.snapshot!.race!.results).toEqual(results);
    for (const peer of peers) send(peer, { type: "race.return" });
    await until(
      () =>
        peers.every(
          (peer) =>
            peer.snapshot?.players.length === 8 &&
            peer.snapshot.players.every((player) => player.mode === "home"),
        ),
      "Eight racers did not return to the same home",
    );
  }, 90_000);
  it("objections, joining during countdown and a dropped member converge on one forest revision", async()=>{
    const homeId=await home(identities[0]!,"Forest network lifecycle");
    const peers:Peer[]=[];
    for(const identity of identities.slice(0,5))peers.push(await connect(homeId,identity));
    send(peers[1]!,{type:"world.propose",worldId:"forest",revision:0,commandId:crypto.randomUUID()});
    const proposal=await until(()=>peers[2]!.snapshot?.worldProposal,"No shared countdown");
    send(peers[2]!,{type:"world.object",proposalId:proposal.id});
    await until(()=>peers.every(p=>p.snapshot?.worldProposal===null),"Objection did not cancel for everyone");
    expect(peers.every(p=>p.snapshot!.worldId==="living-room")).toBe(true);
    send(peers[3]!,{type:"world.propose",worldId:"forest",revision:0,commandId:crypto.randomUUID()});
    await until(()=>peers[0]!.snapshot?.worldProposal,"Second countdown missing");
    for(const identity of identities.slice(5,8))peers.push(await connect(homeId,identity));
    expect(peers[7]!.snapshot!.worldProposal?.worldId).toBe("forest");
    const dropped=peers[7]!,token=dropped.room.reconnectionToken;
    dropped.room.reconnection.enabled=false;
    dropped.room.connection.close();
    await until(()=>peers[0]!.snapshot?.players.find(p=>p.id===dropped.identity.id)?.connected===false,"Dropped member not reserved");
    await until(()=>peers.slice(0,7).every(p=>p.snapshot?.worldId==="forest"&&p.snapshot.worldRevision===1),"Peers did not transition together",11000);
    const resumed=await new Client(base.replace("http:","ws:")).reconnect(token);
    const rejoined:Peer={room:resumed,identity:dropped.identity,chats:[],notices:[],effects:[],seq:0,left:false};
    resumed.onMessage("snapshot",s=>rejoined.snapshot=s);resumed.onMessage("welcome",()=>{});resumed.onMessage("transition",()=>{});resumed.onMessage("notice",n=>rejoined.notices.push(n));resumed.onLeave(()=>rejoined.left=true);active.push(rejoined);
    await until(()=>rejoined.snapshot?.players.find(p=>p.id===dropped.identity.id)?.connected,"Reconnect did not restore member");
    expect(rejoined.snapshot!.worldId).toBe("forest");expect(rejoined.snapshot!.worldRevision).toBe(1);
    expect(new Set(rejoined.snapshot!.players.map(p=>p.x+":"+p.y)).size).toBe(8);
    const before=peers[0]!.snapshot!.players.find(p=>p.id===identities[0]!.id)!;
    send(peers[0]!,{type:"input",worldRevision:0,input:{seq:99999,axisX:1,axisY:0,jump:false}});await pause(300);
    expect(peers[0]!.snapshot!.players.find(p=>p.id===identities[0]!.id)!.x).toBe(before.x);
    send(peers[0]!,{type:"media.control",revision:0,commandId:crypto.randomUUID(),action:"source",url:"https://example.com/movie.mp4"});
    await until(()=>peers[0]!.notices.some(n=>n.code==="TOO_FAR"),"Outdoor media command was not rejected");
    expect(peers[0]!.snapshot!.media.revision).toBe(0);
  },30000);

});
