import { describe, it, expect, afterEach } from "vitest";
import { LocalStore, DataError } from "../src/index";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { GAME_CONFIG } from "@third-space/config";
import express from "express";
import { createDataRouter } from "../src/index";

const stores: LocalStore[] = [];
afterEach(() => {
  stores.splice(0).forEach((s) => s.close());
});
function fixture(options: ConstructorParameters<typeof LocalStore>[0] = {}) {
  const store = new LocalStore({ path: ":memory:", ...options });
  stores.push(store);
  const owner = store.createIdentity({ name: "Host" }).profile;
  const guest = store.createIdentity({ name: "Guest" }).profile;
  const outsider = store.createIdentity({ name: "Outsider" }).profile;
  const home = store.createHome(owner.id, { name: "Cozy home", pin: "123456" });
  return { store, owner, guest, outsider, home };
}
function code(fn: () => unknown, error: string) {
  expect(fn).toThrowError(expect.objectContaining({ code: error }));
}
describe("local durable access", () => {
  it("separates identity from room admission and denies cross-room board writes", () => {
    const { store, owner, guest, outsider, home } = fixture();
    expect(store.canAccess(home.id, guest.id)).toBe(false);
    store.joinHome(home.id, guest.id, { pin: "123456" });
    expect(store.canAccess(home.id, guest.id)).toBe(true);
    const other = store.createHome(outsider.id, {
      name: "Other",
      pin: "654321",
    });
    code(
      () =>
        store.createNote(other.id, guest.id, {
          requestId: "n",
          text: "secret",
        }),
      "ACCESS_DENIED",
    );
    code(() => store.issueTicket(other.id, owner.id), "ACCESS_DENIED");
    expect(store.listHomes(guest.id).map((h) => h.id)).toEqual([home.id]);
  });
  it("stores a salted verifier and revokes PIN grants and pending tickets on rotation", () => {
    const { store, owner, guest, home } = fixture();
    store.joinHome(home.id, guest.id, { pin: "123456" });
    const ticket = store.issueTicket(home.id, guest.id);
    const changed: any[] = [];
    store.onAccessChanged((e) => changed.push(e));
    store.rotatePin(home.id, owner.id, "654321");
    expect(store.canAccess(home.id, guest.id)).toBe(false);
    code(() => store.consumeTicket(ticket.ticket), "ACCESS_DENIED");
    code(
      () => store.joinHome(home.id, guest.id, { pin: "123456" }),
      "INVALID_CREDENTIAL",
    );
    store.joinHome(home.id, guest.id, { pin: "654321" });
    const row = store.db.prepare("SELECT pin_verifier FROM homes").get()!;
    expect(row.pin_verifier).not.toContain("654321");
    expect(changed[0].userIds).toContain(guest.id);
  });
  it("revokes only derived invite grants, preserves an independent PIN grant, and bans block redemption", () => {
    const { store, owner, guest, outsider, home } = fixture();
    const invite = store.createInvite(home.id, owner.id);
    store.joinHome(home.id, guest.id, { inviteToken: invite.token });
    store.joinHome(home.id, outsider.id, { pin: "123456" });
    store.revokeInvite(home.id, owner.id, invite.id);
    expect(store.canAccess(home.id, guest.id)).toBe(false);
    expect(store.canAccess(home.id, outsider.id)).toBe(true);
    store.banMember(home.id, owner.id, outsider.id);
    code(
      () => store.joinHome(home.id, outsider.id, { pin: "123456" }),
      "INVALID_CREDENTIAL",
    );
    expect(store.canAccess(home.id, owner.id)).toBe(true);
  });
  it("enforces invite expiration/use cap and keeps redeemed access beyond expiry", () => {
    let now = 1000;
    const { store, owner, guest, outsider, home } = fixture({ now: () => now });
    const i = store.createInvite(home.id, owner.id, {
      expiresInHours: 1,
      maxUses: 1,
    });
    store.joinHome(home.id, guest.id, { inviteToken: i.token });
    code(
      () => store.joinHome(home.id, outsider.id, { inviteToken: i.token }),
      "INVALID_CREDENTIAL",
    );
    now += 3600001;
    expect(store.canAccess(home.id, guest.id)).toBe(true);
    const expired = store.createInvite(home.id, owner.id, {
      expiresInHours: 1,
    });
    now += 3600001;
    code(
      () =>
        store.joinHome(home.id, outsider.id, { inviteToken: expired.token }),
      "INVALID_CREDENTIAL",
    );
  });
  it("consumes tickets once and rejects expired credentials", () => {
    let now = 1;
    const { store, owner, home } = fixture({ now: () => now });
    const first = store.issueTicket(home.id, owner.id);
    expect(store.consumeTicket(first.ticket).userId).toBe(owner.id);
    code(() => store.consumeTicket(first.ticket), "INVALID_CREDENTIAL");
    const second = store.issueTicket(home.id, owner.id);
    now += 30001;
    code(() => store.consumeTicket(second.ticket), "INVALID_CREDENTIAL");
  });
  it("rate limits before verification and persists limits between operations", () => {
    let now = 1;
    const { store, guest, home } = fixture({ now: () => now });
    for (let n = 0; n < 5; n++)
      code(
        () => store.joinHome(home.id, guest.id, { pin: "000000" }),
        "INVALID_CREDENTIAL",
      );
    code(
      () => store.joinHome(home.id, guest.id, { pin: "123456" }),
      "RATE_LIMITED",
    );
    now += 900000;
    store.joinHome(home.id, guest.id, { pin: "123456" });
    expect(store.canAccess(home.id, guest.id)).toBe(true);
  });
  it("persists profiles, credentials, homes, board notes and admission through restart", () => {
    const dir = mkdtempSync(join(tmpdir(), "third-space-data-"));
    const path = join(dir, "db.sqlite");
    const first = new LocalStore({ path });
    const identity = first.createIdentity({ name: "Persistent" });
    const home = first.createHome(identity.profile.id, {
      name: "Saved",
      pin: "123456",
    });
    const note = first.createNote(home.id, identity.profile.id, {
      text: "Tomorrow",
      requestId: "saved",
    });
    const oldTicket = first.issueTicket(home.id, identity.profile.id);
    first.close();
    const second = new LocalStore({ path });
    try {
      expect(second.getIdentity(identity.session)?.name).toBe("Persistent");
      expect(second.canAccess(home.id, identity.profile.id)).toBe(true);
      expect(second.getBoard(home.id)[0]?.id).toBe(note.id);
      code(() => second.consumeTicket(oldTicket.ticket), "INVALID_CREDENTIAL");
    } finally {
      second.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
describe("local capacity migrations", () => {
  it("uses the shared eight-person capacity for a fresh database", () => {
    const { store, home } = fixture();
    expect(GAME_CONFIG.partyCapacity).toBe(8);
    expect(home.capacity).toBe(8);
    expect(home.settingsRevision).toBe(1);
    expect(store.db.prepare("PRAGMA user_version").get()?.user_version).toBe(1);
    const column = store.db
      .prepare("PRAGMA table_info(homes)")
      .all()
      .find((row) => row.name === "capacity");
    expect(column?.dflt_value).toBe("8");
  });

  it("creates eight-person homes even when the database retains its legacy SQL default", () => {
    const dir = mkdtempSync(join(tmpdir(), "third-space-capacity-"));
    const path = join(dir, "db.sqlite");
    const legacy = new DatabaseSync(path);
    legacy.exec(`CREATE TABLE homes(
      id TEXT PRIMARY KEY,name TEXT NOT NULL,
      owner_id TEXT NOT NULL REFERENCES profiles(id),
      capacity INTEGER NOT NULL DEFAULT 4,
      settings_revision INTEGER NOT NULL DEFAULT 1,
      pin_verifier TEXT,pin_version INTEGER NOT NULL DEFAULT 1
    )`);
    legacy.close();
    const store = new LocalStore({ path });
    try {
      const owner = store.createIdentity({ name: "Eight friends" }).profile;
      const home = store.createHome(owner.id, { name: "One shared home" });
      expect(GAME_CONFIG.partyCapacity).toBe(8);
      expect(home.capacity).toBe(8);
      expect(home.settingsRevision).toBe(1);
      expect(store.db.prepare("PRAGMA user_version").get()?.user_version).toBe(
        1,
      );
      const column = store.db
        .prepare("PRAGMA table_info(homes)")
        .all()
        .find((row) => row.name === "capacity");
      expect(column?.dflt_value).toBe("4");
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("upgrades legacy four-person homes once and preserves durable access and board records", () => {
    const dir = mkdtempSync(join(tmpdir(), "third-space-migration-"));
    const path = join(dir, "db.sqlite");
    let store: LocalStore | undefined;
    try {
      store = new LocalStore({ path });
      const identity = store.createIdentity({ name: "Host" });
      const guest = store.createIdentity({ name: "Guest" }).profile;
      const invited = store.createIdentity({ name: "Invited" }).profile;
      const home = store.createHome(identity.profile.id, {
        name: "Existing home",
        pin: "123456",
      });
      store.joinHome(home.id, guest.id, { pin: "123456" });
      const invite = store.createInvite(home.id, identity.profile.id);
      store.joinHome(home.id, invited.id, { inviteToken: invite.token });
      const note = store.createNote(home.id, guest.id, {
        requestId: "migration-note",
        text: "Keep our plans",
        x: 0.25,
        y: 0.75,
      });
      const customized = [6, 8, 12].map((capacity) => {
        const other = store!.createHome(identity.profile.id, {
          name: `Capacity ${capacity}`,
        });
        store!.db
          .prepare("UPDATE homes SET capacity=? WHERE id=?")
          .run(capacity, other.id);
        return { ...other, capacity };
      });
      store.db
        .prepare("UPDATE homes SET capacity=4,settings_revision=7 WHERE id=?")
        .run(home.id);
      store.db.exec("PRAGMA user_version=0");
      const originalHome = store.db
        .prepare("SELECT * FROM homes WHERE id=?")
        .get(home.id)!;
      const snapshot = () =>
        Object.fromEntries(
          [
            "profiles",
            "sessions",
            "members",
            "grants",
            "invites",
            "notes",
            "idempotency",
            "audit",
          ].map((table) => [
            table,
            store!.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
          ]),
        );
      const originalRecords = snapshot();
      store.close();
      store = undefined;

      store = new LocalStore({ path });
      expect(
        store.db.prepare("SELECT * FROM homes WHERE id=?").get(home.id),
      ).toEqual({
        ...originalHome,
        capacity: 8,
        settings_revision: 8,
      });
      expect(snapshot()).toEqual(originalRecords);
      expect(store.getIdentity(identity.session)?.id).toBe(identity.profile.id);
      expect(store.canAccess(home.id, guest.id)).toBe(true);
      expect(store.canAccess(home.id, invited.id)).toBe(true);
      expect(store.getBoard(home.id)).toEqual([note]);
      for (const other of customized)
        expect(store.getHome(other.id)).toEqual(other);
      store.joinHome(home.id, guest.id, { pin: "123456" });
      expect(
        store.consumeTicket(store.issueTicket(home.id, invited.id).ticket)
          .userId,
      ).toBe(invited.id);
      store.close();
      store = undefined;

      store = new LocalStore({ path });
      expect(store.getHome(home.id)?.settingsRevision).toBe(8);
      expect(store.getHome(home.id)?.capacity).toBe(8);
      expect(store.db.prepare("PRAGMA user_version").get()?.user_version).toBe(
        1,
      );
      // A later deliberate setting must not be treated as a legacy default.
      store.db.prepare("UPDATE homes SET capacity=4 WHERE id=?").run(home.id);
      store.close();
      store = undefined;
      store = new LocalStore({ path });
      expect(store.getHome(home.id)?.capacity).toBe(4);
      expect(store.getHome(home.id)?.settingsRevision).toBe(8);
    } finally {
      store?.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
describe("local avatar compatibility", () => {
  it("normalizes legacy stored appearance for profiles and tickets and persists independent colors", () => {
    const dir = mkdtempSync(join(tmpdir(), "third-space-avatar-"));
    const path = join(dir, "db.sqlite");
    let store: LocalStore | undefined;
    try {
      store = new LocalStore({ path });
      const identity = store.createIdentity({ name: "Legacy friend" });
      const home = store.createHome(identity.profile.id, { name: "Saved home" });
      const legacy = {
        color: "#d88c71",
        hair: "curly",
        outfit: "tee",
        accessory: "glasses",
      };
      store.db
        .prepare("UPDATE profiles SET avatar=? WHERE id=?")
        .run(JSON.stringify(legacy), identity.profile.id);
      const normalized = {
        ...legacy,
        skinColor: legacy.color,
        hairColor: "#635044",
        clothingColor: "#6c8364",
        trouserColor: "#52627a",
      };
      expect(store.getProfile(identity.profile.id)?.avatar).toEqual(normalized);
      expect(store.getIdentity(identity.session)?.avatar).toEqual(normalized);
      expect(
        store.consumeTicket(store.issueTicket(home.id, identity.profile.id).ticket)
          .avatar,
      ).toEqual(normalized);
      const updated = {
        ...normalized,
        skinColor: "#bf8665",
        hairColor: "#513c64",
        clothingColor: "#477d96",
        trouserColor: "#746348",
      };
      store.updateProfile(identity.profile.id, { avatar: updated });
      code(
        () => store!.updateProfile(identity.profile.id, {
          avatar: { ...updated, trouserColor: "blue" },
        }),
        "INVALID_INPUT",
      );
      store.close();
      store = undefined;
      store = new LocalStore({ path });
      expect(store.getProfile(identity.profile.id)?.avatar).toEqual(updated);
      expect(store.getIdentity(identity.session)?.avatar).toEqual(updated);
      expect(store.canAccess(home.id, identity.profile.id)).toBe(true);
    } finally {
      store?.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
describe("concurrent board contracts", () => {
  it("deduplicates create, rejects payload changes, and checks optimistic revisions", () => {
    const { store, owner, guest, home } = fixture();
    store.joinHome(home.id, guest.id, { pin: "123456" });
    const payload = { text: "Plans", requestId: "create-1", x: 0.25, y: 0.75 };
    const note = store.createNote(home.id, owner.id, payload);
    expect(store.createNote(home.id, owner.id, payload).id).toBe(note.id);
    expect(store.getBoard(home.id)).toHaveLength(1);
    code(
      () => store.createNote(home.id, owner.id, { ...payload, text: "Other" }),
      "IDEMPOTENCY_CONFLICT",
    );
    const updated = store.updateNote(home.id, guest.id, note.id, {
      text: "Friday",
      expectedRevision: 1,
    });
    expect(updated.revision).toBe(2);
    code(
      () =>
        store.updateNote(home.id, owner.id, note.id, {
          text: "Saturday",
          expectedRevision: 1,
        }),
      "REVISION_CONFLICT",
    );
    expect(store.getBoard(home.id)[0]?.text).toBe("Friday");
    code(
      () =>
        store.updateNote(
          home.id,
          guest.id,
          note.id,
          { expectedRevision: 2 },
          true,
        ),
      "ACCESS_DENIED",
    );
    expect(
      store.updateNote(
        home.id,
        owner.id,
        note.id,
        { expectedRevision: 2 },
        true,
      ).revision,
    ).toBe(3);
    expect(store.getBoard(home.id)).toEqual([]);
  });
  it("validates links, coordinates and grapheme lengths", () => {
    const { store, owner, home } = fixture();
    code(() => store.createIdentity({ name: "Line\nbreak" }), "INVALID_INPUT");
    code(
      () =>
        store.createNote(home.id, owner.id, {
          text: "x",
          requestId: "bad",
          link: "javascript:alert(1)",
        }),
      "INVALID_INPUT",
    );
    code(
      () =>
        store.createNote(home.id, owner.id, {
          text: "x",
          requestId: "bad",
          x: NaN,
        }),
      "INVALID_INPUT",
    );
    const note = store.createNote(home.id, owner.id, {
      text: "👨‍👩‍👧‍👦".repeat(1000),
      requestId: "emoji",
      x: 100,
      y: -5,
    });
    expect(note.x).toBe(1);
    expect(note.y).toBe(0);
  });
});
describe("router HTTP boundary", () => {
  it("rejects untrusted origins and bodies, uses HttpOnly sessions, and reveals no inaccessible home", async () => {
    const { store, home } = fixture();
    const app = express();
    app.use(
      "/api",
      createDataRouter(store, { allowedOrigins: ["http://localhost:3000"] }),
    );
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((r) => server.once("listening", r));
    const addr = server.address() as { port: number };
    const base = `http://127.0.0.1:${addr.port}/api`;
    try {
      const denied = await fetch(`${base}/identity`, {
        method: "POST",
        headers: {
          origin: "https://evil.test",
          "content-type": "application/json",
        },
        body: JSON.stringify({ name: "Evil" }),
      });
      expect(denied.status).toBe(403);
      const huge = await fetch(`${base}/identity`, {
        method: "POST",
        headers: {
          origin: "http://localhost:3000",
          "content-type": "application/json",
        },
        body: JSON.stringify({ name: "x".repeat(17000) }),
      });
      expect(huge.status).toBe(413);
      const created = await fetch(`${base}/identity`, {
        method: "POST",
        headers: {
          origin: "http://localhost:3000",
          "content-type": "application/json",
        },
        body: JSON.stringify({ name: "Visitor" }),
      });
      expect(created.status).toBe(201);
      const cookie = created.headers.get("set-cookie")!;
      expect(cookie).toContain("HttpOnly");
      expect(cookie).toContain("SameSite=Strict");
      const deniedHome = await fetch(`${base}/homes/${home.id}`, {
        headers: { cookie: cookie.split(";")[0]! },
      });
      expect(deniedHome.status).toBe(404);
      const missing = await fetch(`${base}/identity`);
      expect(missing.status).toBe(401);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      );
    }
  });
});

describe('explicit PIN verification for existing access',()=>{
 it('rejects incorrect explicit PIN even for an owner or an admitted guest',()=>{const {store,home,owner,guest}=fixture();store.joinHome(home.id,guest.id,{pin:'123456'});code(()=>store.joinHome(home.id,guest.id,{pin:'654321'}),'INVALID_CREDENTIAL');code(()=>store.joinHome(home.id,owner.id,{pin:'654321'}),'INVALID_CREDENTIAL');expect(store.joinHome(home.id,guest.id,{}).id).toBe(home.id);expect(store.joinHome(home.id,guest.id,{pin:'123456'}).id).toBe(home.id);});
 it('rate limits existing-grant PIN guesses and cannot verify without admission',()=>{const {store,home,owner,outsider}=fixture();code(()=>store.verifyHomePin(home.id,outsider.id,'123456'),'ACCESS_DENIED');for(let i=0;i<5;i++)code(()=>store.verifyHomePin(home.id,owner.id,'654321'),'INVALID_CREDENTIAL');code(()=>store.verifyHomePin(home.id,owner.id,'123456'),'RATE_LIMITED');});
 it('rotation invalidates an old PIN and does not return the PIN or hash',()=>{const {store,home,owner}=fixture();const updated=store.rotatePin(home.id,owner.id,'654321');expect(updated.settingsRevision).toBeGreaterThan(home.settingsRevision);code(()=>store.verifyHomePin(home.id,owner.id,'123456'),'INVALID_CREDENTIAL');expect(store.verifyHomePin(home.id,owner.id,'654321')).toEqual(updated);expect(JSON.stringify(updated)).not.toMatch(/654321|123456|verifier/);});
});

describe('PIN sharing HTTP verification',()=>{
 it('checks submitted PIN with existing owner grant and keeps credentials out of responses',async()=>{
  const store=new LocalStore({path:':memory:'});stores.push(store);
  const identity=store.createIdentity({name:'Host'}),home=store.createHome(identity.profile.id,{name:'Pines',pin:'123456'});
  const app=express();app.use('/api',createDataRouter(store,{allowedOrigins:['http://localhost:3000']}));
  const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${(server.address() as {port:number}).port}/api`;
  const headers={origin:'http://localhost:3000','content-type':'application/json',cookie:`ts_local=${identity.session}`};
  try {
    const wrong=await fetch(`${base}/homes/${home.id}/join`,{method:'POST',headers,body:JSON.stringify({pin:'654321'})});expect(wrong.status).toBe(403);
    const right=await fetch(`${base}/homes/${home.id}/join`,{method:'POST',headers,body:JSON.stringify({pin:'123456'})});expect(right.status).toBe(200);expect(await right.json()).toEqual({home});
    const noIdentity=await fetch(`${base}/homes/${home.id}/join`,{method:'POST',headers:{origin:'http://localhost:3000','content-type':'application/json'},body:JSON.stringify({pin:'123456'})});expect(noIdentity.status).toBe(401);
  } finally {await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
 });
});
