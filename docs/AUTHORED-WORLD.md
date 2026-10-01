# Midnight Pines authored expansion

This content lane adds new files only. Root owns the exports, runtime, scene, transitions, streaming, journal and deployment integration. The map and art are implemented; narrative hooks do not become executable quests merely by appearing in this manifest.

## World geometry

`packages/config/src/authored-forest.ts` exports `expandAuthoredForest(base)`. Call it once on the original forest map before assigning the forest world definition. The output is 144×112 and immutable by convention; repeat calls on that output return it unchanged. Every existing furniture ID, coordinate, spawn and camp seat survives. Only the old rectangular outer collision boundary is replaced. Extra furniture and terrain occupy the newly available east and south land.

The outdoors remain a single map with continuous roads. `FOREST_LOCATIONS` contains narrative landmarks and natural palette choices, not gameplay partitions. It must not create visible region borders or teleport transitions. `FOREST_ROADS` reserves broad connected approaches; all resident and wildlife routes reserve space from generated trees. Existing flat navigation caps must be replaced before enabling the enlarged map.

Eleven original building props include eight natural interiors. `FOREST_BUILDINGS` has physical footprints and outdoor door use points. `FOREST_INTERIORS` provides stable `interior:*` IDs, small bounded `WorldMap`s, eight safe late-join placements, entry/exit positions and outdoor return points. Only root-authorized interaction near a door should change a player's zone. Snapshot/voice interest must use the stable interior ID, not personal transition revision. The open portcullis of Crownwatch is intentional.

Orin is outside his tower at (46,85). `WARD_CACHE_ANCHORS` uses the existing durable quest IDs: `brass-seal-a` (74.5,93.5), `brass-seal-b` (85,83), `brass-seal-c` (88,101.5). Personal recovery must leave shared props visible for others and late joiners. The interiors of Ada's house and Hollow Observatory contain authored journal/chart clues; these are descriptions and points for root's quest validation.

## Cast and story

`packages/config/src/forest-cast.ts` exports 18 authored residents, four animals and 14 connected narrative hooks. Each resident has a backstory, motivation, explicit relationships, quest hooks, bounded day/dusk/night routes, four personal-state dialogue lines and two state-neutral ambient lines. Dawn uses the day route. Castle guard Iona and village watch Garrick have different patrols and linked reports; the court, goblins, witch, warlock, cat courier and villagers contribute observations to the same mystery.

**The missing keeper is Ada.** King Rowan is a different person, formerly an orchard keeper. The first executable ward quest restores the light and reveals Ada's trail; it does not claim she has been rescued. `forestNpcDialogue(npc, flags)` picks private personal dialogue using `wardAccepted`, `wardsRestored` and `keeperFound`. Shared overhead bubbles should use `first-meeting` and `ambientLines`; one player's reward must not tell everyone else their quest is complete.

Source NPC IDs are stable narrative IDs, e.g. `wizard-orin-vale`. Runtime actor IDs should be `npc:${id}` so they cannot be mistaken for authenticated humans. The NPC runtime lane supplies this adapter. Three existing wanderers plus this cast and wildlife total 25 actors, independent of the eight human slots. Do not allocate all actor art on every snapshot: cache bounded direction/frame variants and cull views.

The 14-hook story graph includes the executable first ward arc and authored follow-ups about Ada's memories, the guard reports, borrowed signatures, sibling reconciliation and ordinary care. Root must implement durable objectives and receipt-based rewards before displaying an authored hook as an available playable quest.

## Original Canvas art API

`apps/web/lib/authored-forest-art.ts` uses no assets, network requests or new dependencies:

- `paintAuthoredForestFloorTile(ctx,x,y,tile,px?,py?)` paints global-coordinate deterministic terrain into chunks; existing camp/asylum clearings remain recognizable.
- `authoredForestObjectCanvas(item,tile)` returns an original tree/building canvas for this manifest's IDs, or `undefined` for existing objects. Fall back to the old object renderer when undefined.
- `forestInteriorFloorCanvas(interior,tile)` and `forestInteriorObjectCanvas(item,tile,interior.style)` render the corresponding interior. Rugs draw below actors and props; other props use their physical bottom edge for depth. Doors draw as visible thresholds. Existing forest object art does not support all interior furniture kinds, so use this interior renderer.
- `authoredNpcCanvas(role,appearance,facing,frame)` supports every authored role plus rabbit/deer/fox/owl. Appearance uses `{skin,hair,coat,trim}`. Preserve the source role to retain the cheesemonger's apron and cheese, the innkeeper's apron and Fenn's flower; a generic `villager` label loses those distinctions. Sprites are 32×42 and intended for nearest-neighbour scaling.

## Verification

`packages/config/test/authored-forest.test.ts` contains five meaningful checks: original coordinate preservation; bounded props and an independent half-tile flood fill from the existing camp to every door, cache, resident and wildlife home; collision-free complete patrol loops including nighttime routes; safe eight-player interior placements and entry/exit paths; complete character relationships/story references and personal dialogue precedence. These pass without relying on the old runtime A* grid cap.

Rendered evidence is outside the repository at `../authored-art-evidence/authored-contact-sheet.png` and `../authored-art-evidence/orin-interior.png`; the local renderer and entry source are beside them. The contact sheet contains all 46 building/tree/cast/interior examples. Chromium Canvas pixel readback was correct, but this installed headless build painted Canvas elements as broken white placeholders in screenshots; converting the generated canvases to PNG-backed image elements before the screenshot produced the inspected proof. This is isolated artifact rendering, not proof of an integrated multiplayer scene, mobile performance or physical-device playback.
