# Lantern Road living-world milestone

This extends the released keeper story without resetting it. Near an NPC, E or the visible touch button opens current guidance and explicit choices. Harvested apples can buy a potion, repair personal relationships, or help Mara recover after an escort. Mara's shared story can advance or suffer a recoverable setback while everyone else keeps exploring or watching.

## Playable scope

- Nearby selection uses distance, line of sight and a stable ID tie-break. The room independently checks membership, world/life/zone, target life, range and line of sight. NPC guidance uses disclosed story state, precise destinations and direct journal tabs. A delayed reply cannot reopen a dismissed panel; unsolicited help cannot replace an active conversation or steal typing focus.
- Orin sells strength, Nessa sells speed, and Tansy sells both for two apples per dose. Personal pockets hold two doses of each kind and use the existing five inventory slots. Equip a potion and use it. Strength lasts 20 seconds with 1.75× server damage and an original broad-shouldered body; speed lasts 20 seconds at 1.6× movement with bounded trails. Active kinds cannot stack or refresh, uses share a three-second cooldown, and death/rejoin do not renew absolute expiry.
- Global reputation belongs to one member in one home. Each NPC also remembers local trust and fear; timid residents recover more slowly than guards. Observed attacks require actual nearby witnesses with line of sight to attacker and victim. Gifts, fair trades and verified good deeds repair relationships. No observer means no invented reputation penalty for a player hit.
- Mara works near `(56,84)`. Two bandits can threaten her and nearby exposed explorers. A rare nonmodal request lets someone protect and escort her toward Bramblewick `(91,51)`, decline, or keep moving. The route runs through `(72,84)`, `(96,70)` and `(97,51)` using shared navigation. Death, abandonment or timeout produces a repeatable setback. A successful arrival leads to sheltered recovery and a personal once-only potion entitlement for members admitted by completion; a full pocket leaves it pending. A later new member sees shared progress without retroactive consumables.
- Seven new actors bring the regular controller to 32 NPCs, plus rescued Ada. Fruit picking, washing and woodwork have visible props; a frog, duck, kind spirit and malicious spirit add routines and contextual dialogue. Spirits are not a new spell/combat subsystem.
- Eight existing interiors gain layered material/furniture artwork; Reed House also gains three reachable furnishings. Orchard trees, a cart, laundry, a walkable shallow pond and rocky shelter extend the outdoor composition. The cave mouth is an outdoor nook, not a new enterable interior.
- Knife users can begin a finishing lunge only against an exposed player at 55 health or below with room PvP enabled. The 650 ms stationary wind-up marks a fixed impact circle; escape, injury, equipment change, protection or context/life change cancels it. It shares the normal swing cooldown. Existing safe areas, watching and respawn protection remain enforced.

## Authority, persistence and offscreen continuity

The server advances all humans, NPCs and mobs independently of any camera. Clients retain camera-buffer culling/preloading and recipient interest filtering; these only affect rendering and delivery. Players can remain far apart in the same continuous outdoor world. Interiors retain natural door transitions. No visible region boundaries are added.

NPC navigation and the two roadside bandits share one path query per 100 ms, with alternating priority. Existing keeper enemies and horror encounters retain their separate bounded budgets. Trails use one graphics object and at most 32 marks. No NPC consumes one of the eight human slots or enters human presence/voice membership.

The additive SQLite component is `living-world` version 1. Its tables are `living_world_personal`, `living_world_rescue`, `living_world_receipts`, `living_world_offers`, `living_world_deeds`, and `living_world_rewards`. It shares the existing `forest_adventure_inventory` apple row/revision. Purchases and rewards atomically commit payment, items and durable receipts. Reusing a command cannot repeat a grant; changing its payload conflicts. Runtime rescue outcomes remain ordered across storage failures and are acknowledged only after acceptance/deduplication. Ignored/declined attempts preserve a witness for saving setbacks without crediting that person as a helper.

The migration creates additive tables; it does not replace a database. Production deployment must retain the existing SQLite volume and follow the release owner's backup/restart procedure. Native voice stays OFF behind its existing provider/privacy/revocation gates.

## Automated and art verification

Run with the repository's Node 24 environment:

```sh
node node_modules/vitest/vitest.mjs run --maxWorkers=4
node scripts/workspaces.mjs typecheck
node scripts/workspaces.mjs build
node --expose-gc --import tsx tests/bench/expanded-room-benchmark.ts --mode integrated --scenario spread --seconds 300 --warmup 15 --delta --out /tmp/living-world-profile.json
```

Coverage includes actual SQLite payment/replay/restart/capacity/late-join state, room admission and forged/stale commands, finisher counterplay, physical escort navigation, persistent fear, ignored/declined setbacks, storage failure ordering, popup reply correlation, all-eight interior geometry, chunk/interest continuity and HTTP/Colyseus regressions. The full suite also retains media, projector, chat/focus, PIN/invites, race, sprint, idle and disabled-voice coverage.

The five SVG sheets in `apps/web/public/art/living-world/` use the runtime Canvas command stream. Native rasterized sheets were inspected for interior materials, pond placement, spirit/wildlife silhouettes and strength appearance. See [art and geometry notes](LIVING-WORLD-ART.md). These sheets do not establish Phaser depth/lighting or mobile layout.

The integrated benchmark admits eight humans through actual room admission and input validation, spread across the real map with 32 NPCs. It uses in-memory transport and reports source fingerprints, simulation/snapshot/delta CPU, bytes and process memory. It excludes browser rendering, live sockets, TLS, WAN and production-volume load. Neither its timing nor desktop emulation establishes 60 FPS, production capacity, physical iPhone playback or a real speaker mix.

## Required integrated browser acceptance

The release owner should run this exact source in an isolated preview with a disposable database, then record browser screenshots/results before readiness and paired release. Existing previews and the original dirty checkout are not inputs to overwrite.

1. **Conversation and input:** Approach Orin `(46,85)` through normal movement. Compare E, click and touch target selection; inspect main-story direction and the direct evidence tab. Type E in chat and focused controls, use modifier shortcuts, dismiss a delayed reply, leave range, cross a doorway, and reconnect. No stale panel should reopen or old action spend against a new life/zone.
2. **Potion loop:** Harvest a visibly ripe orchard tree, open Orin/Nessa/Tansy's current offer, buy and equip a dose, and use it. Inspect body proportions/feet/nameplate, speed/trails, expiry, reduced motion, counts and notices. Repeat rejected/expired/full-pocket actions and reconnect during an effect. A second browser should see the same movement/body effect while each inventory remains private.
3. **Reputation:** In a disposable home, attack an eligible NPC or player with and without a real witness; verify warnings/fleeing and distinct local/global relationship feedback. Check repair gifts and different recovery profiles. Do not substitute a client-forged event for an actual attack.
4. **Mara:** Stay exposed near Lantern Road to observe the ordinary rare help request. Verify that movement/combat/chat are not interrupted. Cover decline or ignore through a setback, then protect, follow the physical route, arrive and recover. A second player farther away should see correct shared progress on return. Verify reward once, full-pocket pending, reconnect and server restart using the same disposable SQLite file. Test a fresh later member separately.
5. **Combat:** With PvP enabled, first show that full-health and protected targets are ineligible. Wound a target, inspect the tell from both screens, dodge, interrupt with damage, switch equipment and disable PvP. Then complete one eligible lunge and observe a single knockout/respawn. Repeated packets must not create another hit.
6. **World rendering:** Walk all eight doors, immediately leave, repeat and reconnect inside. Inspect furniture collision, foot depth and arrival floor; inspect orchard depletion, pond/wildlife, laundry/woodwork props, cave nook and both spirit variants. Verify no chunk seams, missing objects or offscreen authority loss with eight separated clients.
7. **Layouts/regressions:** At desktop, narrow portrait and short landscape sizes, inspect panel scrolling/close/action visibility with joystick, hotbar, journal and voice controls. Exercise mute/reduced motion, held Space sprint, chat typing, video/projector sync, PIN/invite admission, idle/rejoin and races. Voice must remain OFF. Actual physical iPhone/Safari playback and speaker mix require separate device evidence.

Final test counts, exact commit/tree, profile values and the review PR are recorded in the milestone handoff and evidence manifest; integrated browser acceptance and deployment are distinct states.
