# Cooperative keeper encounters

The runtime is integrated with PartyRoom, the shared story ledger, the hotbar and the Phaser scene. `ForestCombatEncounters` runs only on the expanded forest map. The three stable story encounter IDs are:

- `keeper-copperbutton-raiders`: two Thornmask/Briarhook raiders near the southern Button camp.
- `keeper-mossbutton-raiders`: two Mossmask/Cinderhook raiders near the northern Button camp.
- `keeper-rootbound-guardian`: one root-bound ogre at Hollow Bough, enabled only during the rescue chapter.

These enemies are separate from friendly named NPCs and from human membership, inventory, voice, chat and idle tracking. The first valid knife strike opts into a fight. Only humans who contribute a strike are enemy targets. Holding a knife nearby can contribute to the starting health scale, but health never increases mid-fight. Health scales from one through eight near eligible armed humans by 35% per additional human; damage and fair windup timing do not increase. A solo raider takes two knife strikes and the guardian five. Initial retaliation waits 1.5 seconds, then a steady target circle appears for 0.8 seconds (raider) or 1.15 seconds (guardian). Impact stays at that committed point, so movement can dodge it.

An abandoned encounter waits five seconds, then resets eight seconds later. Its target life revision increments; queued attacks from the previous life are rejected. A cleared story encounter remains cleared until the story explicitly grows a new version. There is no repeat loot farm.

## Integration design

1. The snapshot field is `mobs?: ForestMobSnapshot` in `RoomSnapshot`;, export the `forest-mobs` public types, and add this strict client command:

```ts
z.object({
  type: z.literal('mob.attack'), mobId: z.string().startsWith('mob:').max(140),
  targetLifeRevision: z.number().int().min(0), commandId: CommandIdSchema,
  worldRevision: z.number().int().min(0), lifeRevision: z.number().int().min(0),
  zoneRevision: z.number().int().min(0),
}).strict()
```

The usual world/life/zone fences and `survival.acceptCommand` must run before dispatch. The server projects `ForestCombatant` from its `PlayerState` and inventory, including actual `health` and `armed = inventory.equipped === 'knife' && !!inventory.knifeId`. Never accept those values or defeat/participant IDs from a client. Do not add mob IDs to `players`.

2. Add these server-only methods inside `SurvivalInventory`. Refactor the current PvP `attack` to validate its human target/PvP policy first, then call `strikeWorldTarget` before applying human damage. This preserves one shared 800ms cooldown across player and mob attacks.

```ts
strikeWorldTarget(a: SurvivalActor, target: {x:number;y:number}, now: number): SurvivalResult {
  const p = this.players.get(a.id);
  if (!Number.isFinite(now) || !p || p.equipped !== 'knife' || !p.knifeId ||
      !this.active(a, now) || a.seatId || this.options.safe(a) ||
      this.options.safe(target) || p.health <= 0)
    return {ok:false, reason:'Equip your knife outside the safe areas'};
  if (now - (this.attackAt.get(a.id) ?? -Infinity) < SURVIVAL.attackCooldownMs)
    return {ok:false, reason:'Knife is recovering'};
  if (distance(a,target) > SURVIVAL.attackRange || !this.options.lineOfSight(a,target))
    return {ok:false, reason:'Out of reach'};
  this.attackAt.set(a.id,now);
  this.event('swing',a.id,now, 'id' in target ? String(target.id) : undefined);
  return {ok:true,deaths:[]};
}

damageWorld(a: SurvivalActor, amount:number, now:number, sourceId:string): SurvivalResult {
  const p = this.players.get(a.id);
  if (!p || !Number.isFinite(now) || !Number.isFinite(amount) || amount <= 0 || amount > 100 ||
      !this.active(a,now) || a.seatId || this.options.safe(a) || p.health <= 0)
    return {ok:false,reason:'That player is protected'};
  p.health = Math.max(0,p.health-amount);
  this.event('hurt',a.id,now,sourceId);
  if (p.health === 0) this.event('death',a.id,now,sourceId);
  return {ok:true,deaths:p.health === 0 ? [a.id] : []};
}
```

`damageWorld` is called only for the once-returned server `ForestMobHit`, not from a client endpoint. Use a calm `combat` knockout cause (new union case) so dying to a raider does not trigger a mimic jumpscare. Existing knockout/respawn protection and inventory ownership cleanup should remain centralized in `PartyRoom.knockout`.

3. Room setup: `private combat = new ForestCombatEncounters(expandedWorld)`. At story load/change call `combat.syncStory(enabledEncounterIds, clearedEncounterIds)` using the shared durable chapter state. This runtime defaults all encounters locked; calling it with every ID defeats story order. It must stay separate from the private detective culprit state.

4. Dispatch validated `mob.attack`:

```ts
const result = combat.strike(actor, command.mobId, command.targetLifeRevision, now,
  combatants, (source,target,at) => survival.strikeWorldTarget(source,target,at));
```

On success record human activity and send snapshots. On failure send the bounded reason. A failure before `spendSwing` does not consume a cooldown.

5. Call `combat.update(now, combatants)` at 10 Hz regardless of client interest. Apply each returned hit through `survival.damageWorld`; route resulting deaths through normal life fencing. Runtime movement is capped at 100ms per call, five mobs and one path refresh per update. Snapshot culling cannot suspend authority. When switching root worlds, rebuild the runtime and rehydrate shared story clears before enabling encounters.

6. After strikes, inspect `pendingDefeats()`. Each receipt already matches the story server event:

```ts
{kind:'encounter-defeated', eventId, actorId, encounterId,
 defeatId:'clear-v1', participantIds, occurredAt}
```

Write it through the shared home story transaction. Only after accepted/already-applied confirmation call `acknowledgeDefeat(eventId)`. Keep a failed transaction pending and retry the same ID. If all contributors have lost home access before the first successful commit, the server may call `discardDefeatAndReset(eventId)`; it grants nothing, advances enemy life revisions and lets authorized members retry. Never call it for a committed clear. If some contributors remain authorized, filter attribution and select an authorized actor before the first successful commit. The event ID is stable across restarts; the store must deduplicate by home plus receipt and award each story milestone once. All eligible home members, including absent members, receive the store's shared progress/reward policy; runtime participants are recap attribution only. No mob code directly changes inventory or grants loot.

7. Add `combat.snapshot()` to outdoor home snapshots, filtering `mobs` by the existing interest radius if desired. No locked encounter appears in that snapshot. Interiors/races receive no combat state. Use `new ForestMobPresentation(scene, (mobId,targetLifeRevision) => send({type:'mob.attack',mobId,targetLifeRevision}))` and update with the snapshot, player, authoritative time, tile size and reduced-motion setting. Destroy on scene teardown. Extend the client send wrapper to attach revision context to `mob.attack`.

8. Knife hotbar action should prefer a reachable live mob over a human; explicit avatar clicks retain PvP intent. Include a keyboard-accessible nearest-mob action using the same command path. The presentation labels an idle enemy “Strike with knife to challenge”; clicking it never bypasses equipment, range or safety. Sprite hit tint is finite, reduced motion skips it, and windup rings remain steady with no flashes or camera shake.

## Validation and remaining integration checks

`tests/unit/forest-combat.test.ts` verifies actual authored spawn geometry, locking, stale target lives, source safety, range/LOS, cooldown delegation, one-to-eight scaling, opt-in targeting, dodgeable fixed-point impacts, guarded hits, deterministic resets, unique pending receipts, durable-clear rehydration, defensive copies and a solo guardian completion with its real attack loop. These are runtime tests, not full room/network verification.

The integrated shared-story room suite covers the common PvP/mob cooldown, strict command revisions, full main-story completion, transaction failure/retry and eight-member delivery. Actual Phaser desktop/mobile/reduced-motion captures cover raiders, guardian and steady telegraphs. Separate network and renderer checks remain necessary to assess transport and frame rate.
