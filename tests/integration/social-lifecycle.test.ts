import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Client, type Room } from "@colyseus/sdk";
import type {
  ChatMessage,
  RoomSnapshot,
  ServerNotice,
  SocialEffect,
} from "../../packages/contracts/src/index";
import { HOME_MAP } from "../../packages/config/src/index";
import { createGameServer } from "../../apps/game-server/src/server";

type Peer = {
  room: Room;
  id: string;
  effects: SocialEffect[];
  notices: ServerNotice[];
  chats: ChatMessage[];
  snapshot?: RoomSnapshot;
  left: boolean;
};
let runtime: ReturnType<typeof createGameServer>;
let client: Client;
let homeId: string;
let ownerId: string;
let friendId: string;
let peers: Peer[] = [];
const pause = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
async function until(read: () => boolean, reason: string) {
  const start = Date.now();
  while (Date.now() - start < 3_000) {
    if (read()) return;
    await pause(15);
  }
  throw new Error(reason);
}
async function join(id: string, replaceExisting = false) {
  const { ticket } = runtime.store.issueTicket(homeId, id);
  const room = await client.joinOrCreate("party", {
    homeId,
    ticket,
    replaceExisting,
  });
  const peer: Peer = {
    room,
    id,
    effects: [],
    notices: [],
    chats: [],
    left: false,
  };
  room.onMessage("snapshot", (snapshot: RoomSnapshot) => {
    peer.snapshot = snapshot;
  });
  room.onMessage("effect", (effect: SocialEffect) => peer.effects.push(effect));
  room.onMessage("notice", (notice: ServerNotice) => peer.notices.push(notice));
  room.onMessage("chat", (chat: ChatMessage) => peer.chats.push(chat));
  for (const type of ["welcome", "transition", "board.changed"])
    room.onMessage(type, () => {});
  room.onLeave(() => {
    peer.left = true;
  });
  peers.push(peer);
  await until(() => !!peer.snapshot, "Missing authoritative snapshot");
  return peer;
}

describe("social consent and participant lifecycle regressions", () => {
  beforeAll(async () => {
    runtime = createGameServer({
      dataPath: ":memory:",
      origins: ["http://localhost:3000"],
    });
    await runtime.server.listen(0, "127.0.0.1");
    const address = runtime.httpServer.address();
    if (!address || typeof address === "string")
      throw new Error("Missing server port");
    client = new Client(`ws://127.0.0.1:${address.port}`);
    ownerId = runtime.store.createIdentity({ name: "Nova" }).profile.id;
    friendId = runtime.store.createIdentity({ name: "Sage" }).profile.id;
    homeId = runtime.store.createHome(ownerId, {
      name: "Consent tests",
      pin: "123456",
    }).id;
    runtime.store.joinHome(homeId, friendId, { pin: "123456" });
  });
  afterEach(async () => {
    for (const peer of peers) if (!peer.left) await peer.room.leave();
    peers = [];
    await pause(75);
  });
  afterAll(async () => {
    await runtime.server.gracefullyShutdown(false);
    runtime.store.close();
  });

  it("rejects acceptance by the source without destroying the true recipient invitation", async () => {
    const owner = await join(ownerId);
    const friend = await join(friendId);
    owner.room.send("command", {
      type: "emote",
      assetId: "high-five",
      targetId: friend.id,
    });
    await until(
      () => friend.effects.some((effect) => effect.type === "proposal"),
      "Target did not receive the proposal",
    );
    const proposal = friend.effects.find(
      (effect) => effect.type === "proposal",
    )!;
    owner.room.send("command", {
      type: "social.accept",
      proposalId: proposal.id,
    });
    await until(
      () => owner.notices.some((notice) => notice.code === "PROPOSAL_EXPIRED"),
      "Source was allowed to accept its own invitation",
    );
    friend.room.send("command", {
      type: "social.accept",
      proposalId: proposal.id,
    });
    await until(
      () =>
        owner.effects.some(
          (effect) => effect.type === "emote" && effect.assetId === "high-five",
        ),
      "Source invalidated the target invitation",
    );
    const accepted = owner.effects.find((effect) => effect.type === "emote")!;
    expect(accepted.sourceId).toBe(owner.id);
    expect(accepted.targetId).toBe(friend.id);
    expect(accepted.id).not.toBe(proposal.id);
    expect(
      friend.effects.filter((effect) => effect.type === "emote"),
    ).toHaveLength(1);
    friend.room.send("command", {
      type: "social.accept",
      proposalId: proposal.id,
    });
    await until(
      () => friend.notices.some((notice) => notice.code === "PROPOSAL_EXPIRED"),
      "Accepted invitation could be replayed",
    );
    expect(
      owner.effects.filter((effect) => effect.type === "emote"),
    ).toHaveLength(1);
  });

  it("rechecks authoritative range at acceptance and leaves avatars under their own control", async () => {
    const owner = await join(ownerId);
    const friend = await join(friendId);
    owner.room.send("command", {
      type: "emote",
      assetId: "high-five",
      targetId: friend.id,
    });
    await until(
      () => friend.effects.some((effect) => effect.type === "proposal"),
      "Target did not receive the proposal",
    );
    const proposal = friend.effects[0]!;
    let seq = 0;
    const timer = setInterval(
      () =>
        friend.room.send("command", {
          type: "input",
          input: { seq: seq++, axisX: 1, axisY: 0, jump: false },
        }),
      40,
    );
    try {
      await until(() => {
        const a = friend.snapshot?.players.find(
          (player) => player.id === ownerId,
        );
        const b = friend.snapshot?.players.find(
          (player) => player.id === friendId,
        );
        return !!a && !!b && Math.hypot(a.x - b.x, a.y - b.y) > 2.5;
      }, "Target did not move out of range");
    } finally {
      clearInterval(timer);
      friend.room.send("command", {
        type: "input",
        input: { seq: seq++, axisX: 0, axisY: 0, jump: false },
      });
    }
    friend.room.send("command", {
      type: "social.accept",
      proposalId: proposal.id,
    });
    await until(
      () => friend.notices.some((notice) => notice.code === "TOO_FAR"),
      "Out-of-range paired action was accepted",
    );
    expect(owner.effects.some((effect) => effect.type === "emote")).toBe(false);
    expect(
      owner.snapshot!.players.find((player) => player.id === ownerId)!.x,
    ).toBe(HOME_MAP.spawns[0].x);
  });

  it("cleans retry caches, rate windows, sound cooldowns and pending proposals on a genuine fresh session", async () => {
    const owner = await join(ownerId);
    const friend = await join(friendId);
    friend.room.send("command", { type: "sound", assetId: "chime" });
    for (let i = 0; i < 5; i++)
      friend.room.send("command", {
        type: "chat.send",
        commandId: `fresh-${i}`,
        text: `Before leaving ${i}`,
      });
    friend.room.send("command", {
      type: "emote",
      assetId: "high-five",
      targetId: owner.id,
    });
    await until(
      () =>
        owner.chats.length === 5 &&
        owner.effects.some((effect) => effect.type === "proposal") &&
        owner.effects.some((effect) => effect.type === "sound"),
      "Initial session did not populate its state",
    );
    const pending = owner.effects.find((effect) => effect.type === "proposal")!;
    const oldChat = owner.chats[0]!;
    await friend.room.leave();
    await until(
      () => owner.snapshot?.players.length === 1,
      "Leave did not remove presence",
    );
    owner.room.send("command", {
      type: "social.accept",
      proposalId: pending.id,
    });
    await until(
      () => owner.notices.some((notice) => notice.code === "PROPOSAL_EXPIRED"),
      "A departed participant retained a proposal",
    );
    const fresh = await join(friendId);
    fresh.room.send("command", {
      type: "chat.send",
      commandId: "fresh-0",
      text: "A new session may reuse its old retry ID",
    });
    fresh.room.send("command", { type: "sound", assetId: "chime" });
    await until(
      () =>
        owner.chats.some(
          (message) =>
            message.text === "A new session may reuse its old retry ID",
        ),
      "Fresh session retained a stale retry cache or chat rate window",
    );
    await until(
      () =>
        owner.effects.filter((effect) => effect.type === "sound").length === 2,
      "Fresh session retained the prior sound cooldown",
    );
    expect(
      owner.chats.find(
        (message) =>
          message.text === "A new session may reuse its old retry ID",
      )!.id,
    ).not.toBe(oldChat.id);
    expect(Date.now()).toBeLessThan(pending.expiresAt);
    expect(
      fresh.notices.some((notice) =>
        ["RATE_LIMITED", "INVALID_COMMAND", "SESSION_LIMIT"].includes(
          notice.code,
        ),
      ),
    ).toBe(false);
  });

  it("preserves accepted retry identity and cooldowns across explicit tab replacement", async () => {
    const owner = await join(ownerId);
    const friend = await join(friendId);
    friend.room.send("command", {
      type: "chat.send",
      commandId: "continued-tab",
      text: "Continue this session",
    });
    friend.room.send("command", { type: "sound", assetId: "chime" });
    await until(
      () =>
        owner.chats.length === 1 &&
        owner.effects.some((effect) => effect.type === "sound"),
      "Original session did not deliver its actions",
    );
    const acceptedId = owner.chats[0]!.id;
    const replacement = await join(friendId, true);
    await until(() => friend.left, "Replacement did not close the former tab");
    replacement.room.send("command", {
      type: "chat.send",
      commandId: "continued-tab",
      text: "Continue this session",
    });
    await until(
      () => replacement.chats.length === 1,
      "Replacement could not recover its accepted acknowledgment",
    );
    expect(replacement.chats[0]!.id).toBe(acceptedId);
    expect(owner.chats).toHaveLength(1);
    replacement.room.send("command", {
      type: "chat.send",
      commandId: "continued-tab",
      text: "Changed retry",
    });
    replacement.room.send("command", { type: "sound", assetId: "chime" });
    await until(
      () =>
        replacement.notices.some(
          (notice) => notice.code === "INVALID_COMMAND",
        ) &&
        replacement.notices.some((notice) => notice.code === "RATE_LIMITED"),
      "Replacement cleared its session retry cache or cooldown",
    );
    expect(
      owner.effects.filter((effect) => effect.type === "sound"),
    ).toHaveLength(1);
  });
});
