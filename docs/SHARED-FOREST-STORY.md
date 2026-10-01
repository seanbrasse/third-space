# Shared home story: the keeper and the borrowed face

This cooperative implementation supersedes the earlier personal ward-quest integration proposal. `SharedForestStoryStore` is the active integration target. The earlier personal controller/store is archived outside the release checkout; only this shared completion path awards rewards. No earlier personal quest was live when this change was prepared, so no invented migration merges personal flags into home progress. Existing tables/data are left intact.

## Executable scope

The home owns one shared story. Members may contribute asynchronously, in any combination from one to eight active players. Leaving, dying, changing rooms or being absent does not erase the home’s progress.

1. Talk to Orin to discover Ada’s disappearance. Recover three seals in any order and disperse two hostile raider bands. Friendly goblin residents are separate actors and cannot satisfy combat objectives.
2. Return to Orin to restore the wards. Read Ada’s journal and the ward rubbing, then interview Nib, Fenn and Garrick. Accuse the *face an echo borrowed*, not a guilty villager. A stable server-private choice determines which coat the rubbing recorded. Each possible coat uniquely matches a witness’s account. The store requires both clues and all three interviews before accepting an accusation.
3. A correct inference opens the rescue. Clear the rootbound guardian and interact with Ada at the refuge. The story ends with Ada home, roads open, and a shared completion recap.

Wrong accusations preserve all evidence, rule out that disguise, and allow another attempt after ten seconds. No NPC is killed, banished or punished. A duplicated old attempt cannot become valid later merely because new evidence arrived.

Two actual optional stories can begin before, during or after the main story:

- **Neighbours, Not Thieves**: Merrit → Pip → Merrit, reconciling the missing-cart account.
- **The Kept Cup**: Tansy → Vesper → Tansy, carrying an invitation and reply between siblings.

Other authored hooks remain flavour until they have executable objectives. The discovered board contains only these encountered leads, collected evidence, interviewed connections and earned recaps. It never exposes an unreached quest graph.

## Files

- `packages/contracts/src/forest-story.ts`: public `ForestStorySnapshot` only.
- `packages/simulation/src/forest-story.ts`: server reducer, private state, event types and reward definitions.
- `packages/data/src/forest-story-store.ts`: SQLite transactions, home progress, event/defeat receipts, milestone entitlements, personal inventory and reward claims.
- `packages/simulation/test/forest-story.test.ts` and `packages/data/test/forest-story-store.test.ts`: pure and real SQLite verification.

The board UI consumes only the public contract. Do not import the server state type into a broadcast contract.

## Room integration API

```ts
const stories = new SharedForestStoryStore(localStore.db, {
  canAccess: (homeId, userId) => localStore.canAccess(homeId, userId),
});
const initial = stories.read(canonicalHomeId, authenticatedProfileId);
```

The constructor adds tables with `CREATE TABLE IF NOT EXISTS`; it never alters LocalStore’s `PRAGMA user_version`, clears tables, or resets unknown state versions. Component and row versions must be migrated explicitly. It uses the same durable apple table as the prior inventory helper, preserving any existing apples. Never nest its calls in another transaction on the same `DatabaseSync`.

`read(home,user)` returns `{ story, personal }`. Shared story content is identical for members; personal inventory, rewards, badges and unread recap are per identity. Hydrate `personal.inventory.apples` before a join snapshot, and cache its revision. Send a separate reliable story message on join, progress, claim or acknowledgement. Do not read SQLite or repeat the entire journal in every simulation/snapshot tick. After a shared mutation, refresh each connected recipient’s personal view once; never broadcast the actor’s personal snapshot to everybody.

`readAuthority(home)` is **server-only** and returns `{ state, mystery, revision }`, or undefined before creation. Cache it after mutations for encounter and Ada actor gates. Its private mystery must never enter client snapshots, metadata, debug events or chat.

`apply(home,event)` accepts only root-generated, already-authenticated and spatially validated events. Every event contains:

```ts
{ eventId: string, actorId: string, occurredAt: number, ...detail }
```

Details are one of:

```ts
{ kind: 'talk', npcId }
{ kind: 'recover', supplyId }
{ kind: 'inspect', evidenceId }
{ kind: 'accuse', suspectId }
{ kind: 'rescue', npcId: 'keeper-ada' }
{ kind: 'encounter-defeated', encounterId, defeatId, participantIds }
```

Use an authenticated profile ID, never a session ID supplied by the browser. For player commands, derive a bounded event ID from the profile plus command ID; a hash is suitable. Do not include room epoch in ordinary command identity. Replaying the same semantic event after a new arrival timestamp is safe; reusing it for another payload or actor fails. All known story attempts that might become meaningful later receive durable receipts, including early return/inspection and cooldown responses. Retrying gameplay after a rejection requires a new intentional command.

For encounter events, mint `defeatId` from the actual authoritative spawn/life identity. Retries of the same death reuse it. A new transport event ID cannot credit the same physical death again. An encounter objective counts at most once per home even across later respawns. Early final-boss credit is recorded as rejected, so that death cannot be replayed after unlocking the rescue. Participant IDs come from the server’s contributor set, include the attributed actor, contain no duplicates and at most eight members, and are rechecked for home access.

Before `apply`, root must validate current socket ownership/access, command/life/world/zone revisions, active home mode, no respawn, authoritative target existence, same zone, range and LOS. Accepting an ID is not proof of proximity. Every store method rechecks current home access, but it has no world geometry or socket context.

The return is `{ status, message, snapshot }`. Statuses include `updated`, `unchanged`, `replayed`, `out-of-order`, `need-evidence`, `wrong-accusation` and `cooldown`. Only successful state changes increment the shared revision. Event records retain attribution and a bounded public recap query (last 64 meaningful changes); full durable event receipts remain in SQLite.

## Exact authority IDs and map adapters

- `STORY_TALK_NPCS` lists the eight NPCs with executable story transitions. Runtime `npc:wizard-orin-vale` and similar IDs resolve to their authored keys only after finding the actual actor. Ambient NPC chatter need not call the store.
- `STORY_SEALS`: `brass-seal-a`, `brass-seal-b`, `brass-seal-c`; use the authoritative `WARD_CACHE_ANCHORS`. They are home-wide progress flags, not items competing for hotbar slots.
- Raider encounters: `keeper-copperbutton-raiders` and `keeper-mossbutton-raiders`. Activate only in chapter `wards`, and stop once the matching ID is in `state.defeated`.
- Guardian encounter: `keeper-rootbound-guardian`. Activate only in chapter `rescue`, until its defeat is recorded.
- Evidence `ada-journal` maps to physical `keeper-journal` in `interior:keeper-house` at `(5.5,7.5)`.
- Evidence `ward-rubbing` maps to the brass-circle clue `hollow-star-map` in `interior:hollow-observatory` at `(5.5,7.5)`. Display the returned dynamic evidence text, not only the static map caption: it contains the coat the mystery actually selected.
- Interview/accusation keys: `goblin-nib`, `flirt-fenn`, `watch-garrick`. These identify possible borrowed faces; actual friendly residents remain innocent and present.
- Accusation is a discussion beside Orin. The board UI can offer `onAccuse(id)` only when both exact evidence IDs and all three testimonies are present; `canAccuse` additionally requires root’s current Orin proximity. The server independently enforces every condition.
- Ada’s final target key is `keeper-ada`. Root supplies the refuge actor/anchor after rescue unlock and moves or reveals the returned Ada after completion. No client `keeper-found` flag is trusted.

## Personal rewards and inventory

Milestones create one durable entitlement for each currently admitted home member, including absent members. Eligibility is taken from canonical membership and current access inside the same transaction. Participation count does not multiply rewards. New identities joining after the milestone inherit shared progress and its recap, but do not receive retroactive personal apples. This avoids farming rewards by creating new profiles after completion.

- `wards-restored`: three apples, `keeper-of-the-small-light` badge.
- `keeper-rescued`: two apples, `friend-of-the-keeper` badge.
- `fair-rind`: one apple, `friend-of-the-button-camps` badge.
- `kept-cup`: one apple, `mender-of-small-promises` badge.

Story progress never waits for somebody’s inventory. Full inventory leaves their personal entitlement pending. `claimReward(home,user,rewardId,{ inventoryRevision, appleSlotAvailable })` checks the durable apple count, five-apple stack limit, and root’s current hotbar capacity; then adds apples, receipt and badge in one transaction. The client selects only a reward ID. Root supplies revision/capacity from authority. A repeated claim returns the current snapshot without adding apples again, including after earlier reward apples were consumed.

Ordinary `changeApples(home,user,{ before,after,expectedRevision,cause })` remains a synchronous write-before-mutation hook. Causes are `harvest`, `eat`, or deliberate `death` loss. Commit before consuming a tree, healing hunger, changing an apple count or clearing a stack. Conflict/storage failure must leave the in-room consumable action unapplied. Reconcile from `snapshot.personal.inventory`; never retry stale use automatically as a fresh action. Hydrate rewards from the committed count; do not call room-local `grantApples` afterward. Health, hunger and unique knife/backpack ownership remain under room authority. Disconnect/disposal does not delete durable apples; offline time creates no hunger debt.

`markSeen(home,user,revision)` acknowledges only a displayed revision; a newer event remains in `personal.catchUp`. Seen state survives restart. Opening a private view does not acknowledge anything automatically, and a member cannot acknowledge an impossible future revision.

## Verification and integration

Focused tests cover the whole state sequence, all possible fair clue/face combinations, no private or future graph fields in undiscovered views, optional sideplots, wrong-accusation recovery, eight asynchronous members, absent rewards/recap, repeat and stale events, early/duplicate encounter credit, transaction failure on the last entitlement and last claim write, consumed rewards across reopen, canonical home/access isolation, unknown versions, and real simultaneous Node processes recovering clues and claiming rewards.

PartyRoom connects the authored NPCs, authoritative encounters, physical interior clues, rescued Ada, board commands and durable inventory hooks. Fourteen real PartyRoom/SQLite tests cover eight members, all main chapters and both sideplots, range/LOS/zone/forgery rejection, receipt retries, command namespace isolation, offline catch-up and transport failures after commit. Visual and socket acceptance are recorded separately; a complete physical-device quest playthrough is not claimed. Publishing remains with the sole release owner.
