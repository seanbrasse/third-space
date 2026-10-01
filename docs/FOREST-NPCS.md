# Shared forest actors

NPCs are room-owned world actors, separate from the eight authenticated human slots, idle tracking, chat identities, inventory and voice membership. The original forest constructor creates Moss, Wren and Fern. The optional authored adapter adds eighteen residents and four animals when the expanded outdoor map is active. The hard maximum is 28 actors.

## Room integration

- Construct `new ForestNPCController(world, random)` for the original forest. Use `createAuthoredForestNPCs(world, random)` after selecting the expanded map. Rebuild only when the room's world changes; a player's interior transition must not reset the cast.
- Call `update(now, {phase})` from the room loop at 10 Hz. `phase` is optional (`dawn`, `day`, `dusk`, `night`); day is the fallback. NPC authority does not depend on the camera, rendering interest, connected proximity or a particular observer.
- Include `snapshot()` in the outdoor snapshot. A client can omit far actors from its interest payload only if it retains a separate NPC collection rather than confusing them with human membership.
- `interact(id, authenticatedPlayer, now)` validates human identity shape, outdoor/home state, connection, life state, range, line of sight and an actor-wide cooldown. The room must first validate the command's world/life/zone revision and replay ID. An accepted interaction freezes the actor while its shared six-second bubble is visible. `false` produces no dialogue or mutation.
- `get(id)` returns a defensive live-state copy for spatial checks and personal quest dispatch. `npc:wizard-orin-vale` maps to quest giver key `wizard-orin-vale`, only after validating the real actor interaction. Personal journal responses and phase-dependent story dialogue stay private; shared NPC speech never announces somebody else's progress.
- Append `prey()` only to monster candidate lists; pass real humans separately as encounter observers. Never insert adapters into the room's players map. If every connected human is safe, NPC prey must not advance ambush cadence. Process each monster catch independently; an `npc:` target calls `catch(id, now)` and can emit a positional world impact, never a human death veil.
- NPC prey contains immutable copied `npcArt` plus an avatar. A mimic may copy these visual fields without gaining an account, chat name or human presence. If the disguise renderer supports only human avatars, use human donors until NPC art is wired.

`catch()` succeeds once, sets health to zero and removes the actor from prey for 30 seconds. It then returns at its validated home with full health. `damage()` allows future authoritative sources to apply partial health loss; it is not a client-authorized attack endpoint. No player can change NPC health through the dialogue API.

## Bounded simulation and rendering

Movement integrates at most 100 ms after a stalled tick and rejects backward/nonfinite timestamps. A round-robin budget permits one path query per update, caps each path at 128 points and each schedule at 12 waypoints. Authored routes remain local. Spawn points and all movement exclude the fire sanctuary and collision geometry. These bounds are not a frame-rate claim; navigation cost still depends on the shared pathfinder and collision index.

`ForestNPCPresentation` receives the snapshot, local player, authoritative time, tile size and reduced-motion flag. It allocates sprites/text only when actors enter the viewport, culls their visuals outside it, uses stationary frames under reduced motion, and clamps dialogue in CSS pixels at camera edges. Destroy the presentation on scene teardown to release its textures. The presentation callback sends `npc.interact` through the room command wrapper; it never mutates authority.

Validation is split into `forest-npc.test.ts` for the original cast, health/lifecycle/safety, encounter observers and viewport math, and `authored-forest-npcs.test.ts` for the expanded population and schedules. Live browser rendering, room socket authorization and eight-player total-room profiling are integration responsibilities; unit counts do not verify them.

Shared integration: click an NPC or press E within 2.5 tiles with clear line of sight. The room validates current authenticated socket, world/life/zone fences and command replay. NPC snapshots never enter human members, voice participants, idle tracking or survival inventories. All actors tick at 10 Hz across the room; client culling only affects rendering.
