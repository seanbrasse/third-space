/** Verify only the synthetic benchmark's HTTP data across a server restart. */
import { readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { Client } from "@colyseus/sdk";
const [mode, fixtureFile, expectedFile] = process.argv.slice(2);
assert(mode === "before" || mode === "after");
const fixtures = JSON.parse(readFileSync(fixtureFile!, "utf8"));
const endpoint = process.env.LOAD_ENDPOINT || "http://127.0.0.1:2589";
const origin = process.env.LOAD_ORIGIN || "https://third-space-load.invalid";
const revisions: number[] = [];
for (const fixture of fixtures) {
  const owner = fixture.members[0];
  const headers = { cookie: owner.cookie, origin, "content-type": "application/json" };
  const identity = await fetch(`${endpoint}/api/identity`, { headers });
  assert.equal(identity.status, 200);
  assert.equal((await identity.json() as any).profile.id, owner.id);
  const response = await fetch(`${endpoint}/api/homes/${fixture.homeId}/board`, { headers });
  assert.equal(response.status, 200);
  const board = await response.json() as any;
  assert.equal(board.notes.length, 1);
  revisions.push(board.notes[0].revision);
  if (mode === "after") {
    const response = await fetch(`${endpoint}/api/homes/${fixture.homeId}/ticket`, { method: "POST", headers, body: "{}" });
    assert.equal(response.status, 200);
    const room = await new Client(endpoint, { headers: { Origin: origin } }).joinOrCreate("party", await response.json());
    room.onMessage("welcome", () => {});
    room.onMessage("snapshot", () => {});
    room.onMessage("board.changed", () => {});
    await room.leave();
  }
}
if (mode === "before") writeFileSync(expectedFile!, JSON.stringify(revisions));
else assert.deepEqual(revisions, JSON.parse(readFileSync(expectedFile!, "utf8")));
console.log(JSON.stringify({ ok: true, mode, savedIdentities: fixtures.length, savedBoards: fixtures.length, freshRoomAdmissions: mode === "after" ? fixtures.length : 0 }));
