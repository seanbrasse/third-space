# Living world artwork and geometry

All artwork in this module is original Third Space artwork. There are no downloaded images, stock packs, external URLs, added dependencies, or third-party license requirements. The existing campsite/asylum canvas pipeline informed the material palette and top/front/side shading. Art is generated once into ordinary cached Canvas textures.

## Runtime integration

- `packages/config/src/living-environment.ts`: `augmentLivingForest(map)` returns an immutable map with nine outdoor objects. It removes only generated extension trees underneath the compositions; original camp furniture is preserved. Call after `expandAuthoredForest` on both server and client. It is idempotent. Dimensions remain 144×112.
- `augmentLivingInterior(interior)` returns an immutable `ForestInterior`. Only the Reed House gets new collision/furniture: an apothecary dresser, washstand and rocker. Door/exit, all eight arrival points, return coordinates and clues are unchanged. Both authority and renderer must use this map.
- `livingEnvironmentObjectCanvas(item,tile,ripe=true)` returns a new scenery texture or `undefined`. Try it before the existing outdoor object factory. Include `livingEnvironmentStyle(item.id)` in the texture cache key; the generic `structure` kind is not a unique visual key. For authoritative harvestable `living:orchard-tree-*` objects, pass the current ripe boolean and cache both states separately. `false` removes fruit without changing the original canopy, trunk, size or foot position.
- **Draw `livingEnvironmentIsFloor(item.id)` at depth 1.** The pond is shallow, walkable floor scenery, so players and wildlife must remain above it. Other objects use their existing bottom-edge depth rule. Art commands stay inside their declared footprint, making existing chunk culling/preloading sufficient.
- `livingInteriorFloorCanvas(interior,tile)` replaces the flat interior floor. `livingInteriorObjectCanvas(item,tile,interior.style) ?? forestInteriorObjectCanvas(...)` adds material and perspective details to current furniture. Existing portals and fallen-column art retain their existing handlers.
- `livingActorCanvas(kind,appearance,facing,frame)` supports `spirit`, `frog`, `duck` in a 40×48 source with a common foot anchor. Lumen uses coat `#adc8a0`, trim `#ebd397`. Morrow uses coat `#5e4979`, trim `#bd97b5` for the torn, thorned silhouette. Four bounded frames are sufficient. Reduced motion can use frame 0; no flashing/glow animation is required.
- `livingStrengthAvatarCanvas(avatar,facing,frame)` generates a 34×43 sprite with broad shoulders, pectoral shading, substantial forearms and wider trousers. Personal skin, hair, outfit colors, head accessories and face are preserved using the original avatar pixel commands. Preserve the ordinary avatar's foot origin, not its fixed display width/height. This source is already approximately 1.35× as tall; **do not scale by another 1.35×**. Root owns effect expiry/authority and the bounded speed-trail pool.

## Authored placement

The Reed pond is at `(97.1,63.8)` with footprint `6.4×6.9`; its entire surface is shallow and traversable, with a visible pebble ford. Elsie `(99,68)`, frog `(99,67)`, duck `(101,69)` and Morrow `(101,70)` remain reachable. A washing line at `(98,61.3)` connects the laundry routine to an observable workplace. Bram's saw bench is beside `(94,54)`.

Lantern Orchard retains Mara `(56,84)`, Lumen `(55,82)` and the main road. Three new fruit trees, the loaded cart and a lantern-lit rocky shelter give the threatened-worker route visible landmarks. Cave mouth `(64,81.5)` is a reachable outdoor nook, **not a new interior transition**. The rock's upper mass collides; the lower mouth is open. The cave lantern's lower depth is deliberately in front of the cliff asset.

Use points on the cart, bench and cave are walk-to approaches. They do not add invented loot, trade or portal commands. The existing straight route segment `(72,84)→(96,70)` crosses the goblin tent: the NPC controller must pathfind, as the real-controller escort test in the actor lane verifies.

## Verification and limits

`packages/config/test/living-environment.test.ts` checks immutable/idempotent geometry, original camp preservation, every existing NPC/wildlife patrol leg including wrap, and a half-tile flood fill from camp to all doors, caches, new actors and cave approach. It verifies all eight interiors' entry/exit/spawn/clue safety. `apps/web/lib/living-environment-art.test.ts` checks asset footprint bounds, bounded actor frames, interior material output, portal fallback and exact personal head preservation under strength.

The five SVG sheets under `apps/web/public/art/living-world/` are inspectable source-art compositions made from the same command stream as runtime Canvas. They are optional review artifacts, not runtime downloads. The native-sharp PNG evidence is outside the checkout in `../living-world-art-evidence/`, with the renderer script and a README. No browser or server was started for this lane.

Native rendering verifies actual asset shapes, composition and authored coordinates. It does not prove Phaser depth ordering, live lighting, input, phone layout, streaming transitions, browser frame rate or network behavior. Those remain integrated browser acceptance work for the supported release browser. Outdoor sheets omit other pre-existing map props, and interior sheets omit avatars, journal/clue markers and the portal's existing overlay.
