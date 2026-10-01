import { describe, it, expect } from "vitest";
import { LocalStore } from "../src/index";
import { chooseHomeAlias, HOME_ALIAS_WORDS, normalizeHomeReference } from "../src/home-alias";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("short public home aliases", () => {
  it("contains unique vetted words strictly below eight characters", () => {
    expect(new Set(HOME_ALIAS_WORDS).size).toBe(HOME_ALIAS_WORDS.length);
    for (const word of HOME_ALIAS_WORDS) expect(word).toMatch(/^[a-z]{1,7}$/);
    expect(normalizeHomeReference("  PINE  ")).toBe("pine");
  });
  it("retries collisions and falls back without suffixes or false exhaustion", () => {
    const occupied = new Set(HOME_ALIAS_WORDS.slice(0, -1));
    expect(chooseHomeAlias(occupied, () => 0)).toBe(HOME_ALIAS_WORDS.at(-1));
    expect(chooseHomeAlias(new Set(HOME_ALIAS_WORDS), () => 0)).toBeNull();
  });
  it("assigns unique new aliases while canonical UUID tickets and invite links stay unchanged", () => {
    const store = new LocalStore({ path: ":memory:" });
    try {
      const host = store.createIdentity({ name: "Host" }).profile;
      const guest = store.createIdentity({ name: "Guest" }).profile;
      const a = store.createHome(host.id, { name: "Pines", pin: "123456" });
      const b = store.createHome(host.id, { name: "Other", pin: "654321" });
      expect(a.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(a.joinAlias).toMatch(/^[a-z]{1,7}$/);
      expect(a.joinAlias).not.toBe(b.joinAlias);
      expect(store.joinHome(` ${a.joinAlias!.toUpperCase()} `, guest.id, { pin: "123456" }).id).toBe(a.id);
      expect(store.consumeTicket(store.issueTicket(a.id, guest.id).ticket).homeId).toBe(a.id);
      const third = store.createIdentity({ name: "Invite" }).profile;
      const invite = store.createInvite(a.id, host.id);
      expect(store.joinHome(a.id, third.id, { inviteToken: invite.token }).id).toBe(a.id);
      expect(() => store.joinHome(a.joinAlias!, host.id, { pin: "654321" })).toThrowError(expect.objectContaining({ code: "INVALID_CREDENTIAL" }));
      expect(() => store.db.prepare("UPDATE homes SET join_alias=? WHERE id=?").run(a.joinAlias!.toUpperCase(), b.id)).toThrow();
    } finally { store.close(); }
  });
  it("fails atomically on finite pool exhaustion without appending longer IDs", () => {
    const store = new LocalStore({ path: ":memory:" });
    try {
      const host = store.createIdentity({ name: "Host" }).profile;
      const insert = store.db.prepare("INSERT INTO homes(id,name,owner_id,join_alias) VALUES(?,?,?,?)");
      HOME_ALIAS_WORDS.forEach((alias, i) => insert.run(`occupied-${i}`, "Used", host.id, alias));
      expect(() => store.createHome(host.id, { name: "No room", pin: "123456" })).toThrowError(expect.objectContaining({ code: "HOME_IDS_EXHAUSTED", status: 503 }));
      expect(store.db.prepare("SELECT count(*) AS n FROM homes").get()).toEqual({ n: HOME_ALIAS_WORDS.length });
      expect(store.listHomes(host.id)).toEqual([]);
    } finally { store.close(); }
  });
  it("migrates version-one databases additively and preserves older homes and intentional capacities", () => {
    const directory = mkdtempSync(join(tmpdir(), "third-space-alias-")), path = join(directory, "homes.sqlite");
    let store = new LocalStore({ path });
    try {
      const host = store.createIdentity({ name: "Host" }).profile;
      const home = store.createHome(host.id, { name: "Existing", pin: "123456" });
      store.db.exec("DROP INDEX homes_join_alias; ALTER TABLE homes DROP COLUMN join_alias; PRAGMA user_version=1;");
      store.db.prepare("UPDATE homes SET capacity=4 WHERE id=?").run(home.id);
      store.close(); store = new LocalStore({ path });
      const migrated = store.getHome(home.id)!;
      expect(migrated.id).toBe(home.id);
      expect(migrated.name).toBe("Existing");
      expect(migrated.capacity).toBe(4);
      expect(migrated.joinAlias).toBeUndefined();
      expect(store.joinHome(home.id, host.id, { pin: "123456" }).id).toBe(home.id);
      expect(store.createHome(host.id, { name: "New", pin: "654321" }).joinAlias).toMatch(/^[a-z]{1,7}$/);
    } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
  });
});

it('shares rate limits between alias variants and canonical ID',()=>{
 const store=new LocalStore({path:':memory:'});
 try{
  const host=store.createIdentity({name:'Host'}).profile,guest=store.createIdentity({name:'Guest'}).profile;
  const home=store.createHome(host.id,{name:'Limits',pin:'123456'});
  const references=[home.joinAlias!,home.joinAlias!.toUpperCase(),home.id,` ${home.joinAlias} `,home.id];
  for(const reference of references)expect(()=>store.joinHome(reference,guest.id,{pin:'654321'})).toThrowError(expect.objectContaining({code:'INVALID_CREDENTIAL'}));
  expect(()=>store.joinHome(home.id,guest.id,{pin:'123456'})).toThrowError(expect.objectContaining({code:'RATE_LIMITED'}));
 }finally{store.close();}
});
