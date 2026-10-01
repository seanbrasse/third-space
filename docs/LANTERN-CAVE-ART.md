# Lantern Hollow: geometry and original artwork

This additive slice uses the existing outdoor `living:lantern-cave` sculpture and mouth `(64,81.5)`. It does not move or duplicate any outdoor furniture, tree, collider, or road. All artwork is original, generated from the existing `LivingArt` command pipeline without external assets or added dependencies.

## Integration API

`packages/config/src/lantern-cave.ts` exports:

- `LANTERN_CAVE: ForestInterior`: ID `interior:lantern-cave`, building ID `living:lantern-cave`, compatibility style `ruin`, immutable 18×16 map. Register it once in `FOREST_INTERIORS`. Do not add another `FOREST_BUILDINGS` entry, which would duplicate outdoor geometry.
- `LANTERN_CAVE_DOOR`: `{buildingId, interiorId, point:{x:64,y:81.5}}`. Resolve this special exterior furniture ID to the interior on both the client action and authoritative server doorway lookup. Use the existing admission, distance/LOS, revision/life fencing, cooldown and exit handling.
- `LANTERN_CAVE_ANCHOR`: `{x:9,y:5.5}`. The trusted Stolen Lantern recovery interaction uses this reachable point. No `ForestInterior.clue` is present; the older keeper story retains its two existing clues.
- `LANTERN_CAVE_PEDESTAL_ID`: `lantern-cave:pedestal`, for the quest's presentation update.

Arrival is `(9,13.5)`, exit `(9,14.4)`, and the eight distinct safe spawns are x7.5–10.5 on y12.5 and y11.5. A clear central route connects every arrival to the pedestal approach and natural mouth. Pools and bedrolls are traversable floor art; solid prop bases are included in the same map used by navigation and prediction.

`apps/web/lib/lantern-cave-art.ts` exports:

- `lanternCaveFloorCanvas(interior,tile)` — select for `interior:lantern-cave` before the ordinary furnished-interior floor.
- `lanternCaveObjectCanvas(item,tile,lanternPresent=true)` — select before other interior object factories; returns `undefined` for unrelated items. Keep existing rug depth 1, portal interaction and ordinary object bottom-edge depth.
- `lanternCaveFloorArt(interior=LANTERN_CAVE)` and `lanternCaveObjectArt(item,lanternPresent=true)` — the exact pure commands used for native review.
- `lanternGoblinCanvas(facing='down',frame=0,windup=false)` and `lanternGoblinArt(...)` — original pointed-ear goblin patrol sprite with stitched clothing, scarf, satchel and branch cudgel. Its 40×52 canvas and foot position match the existing forest mob asset contract. The server still chooses hostile kind, target, phase and timing.

**Pedestal state must follow the shared quest.** Use a separate texture key for `lanternPresent=false` and refresh the pedestal when recovery changes the snapshot; the rock plinth remains, but the lantern and its soft local glow disappear. The central tan floor is worn gravel, not a dynamic light beam. All art is static or uses the existing bounded stride/windup frames; reduced motion can use frame 0 and does not require pulsing or flashing.

## Evidence and checks

`tests/unit/lantern-cave.test.ts` verifies the reused exterior mouth, immutable geometry, no keeper clue, eight nonoverlapping player arrivals, safe direct exit/quest approach, prop and collider bounds, shallow-floor traversal, deterministic art, recovered-pedestal visibility and all 32 goblin facing/stride/windup combinations inside the mob footprint.

Native renders from the same command stream were inspected with `view_image`:

- `apps/web/public/art/stolen-lantern/lantern-hollow.svg`
- `apps/web/public/art/stolen-lantern/lantern-recovered.svg`
- `apps/web/public/art/stolen-lantern/goblin-patrol.svg`

PNG evidence and the native-sharp renderer are outside the checkout in `../stolen-lantern-art-evidence/`. The installed tool runtime supplied sharp; the project gained no dependency. The five unit checks and current web typecheck pass.

These are actual asset compositions at map coordinates, not integrated game screenshots. Browser input/admission, real recovery state transitions, multiplayer arrivals, live lighting, mobile rendering and performance remain root/release acceptance work. No browser or server was started, and no PR33 source, shared file, commit, or release was changed by this lane.
