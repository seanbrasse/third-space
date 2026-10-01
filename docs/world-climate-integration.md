# Shared outdoor climate

Integrated with PartyRoom snapshots, the shared day phase used by NPC routines, the Phaser weather/light renderer and the room status line. The notes below document those integration points.

## Behavior

- One world day lasts 32 real minutes: dawn 4m, day 16m, dusk 4m, night 8m.
- The fixed epoch is 2026-01-01T00:00:00Z. Room disposal/recreation and late joins
  do not reset the clock. No offline hunger, quest progression, or rewards run here.
- Weather windows last six minutes. Clear skies are weighted 50%, light rain 25%,
  mist 12.5%, breeze 12.5%. Consecutive windows may have identical weather.
- Room id + window index determines weather; the room id supplies a stable
  cosmetic particle seed and wind direction. No client weather commands exist.
- A 20-second smooth transition preserves the previous weather at the boundary.
  Daylight changes smoothly across dawn/dusk; there is no lightning or strobe.
- Climate is atmospheric only. Daylight is not a sanctuary, rain does not extinguish
  campfires/torches, and mist does not change collision, line of sight, monster
  targeting, hunger, damage, or flashlight safety. Explain the cursed woods'
  continuing danger in exploration help if daylight is integrated.
- The fire/watch area is feathered free of the weather overlay. Indoors and race
  views hide it. Reduced motion removes falling rain/leaves and mist drift, while
  retaining calm static color/mist and the shared day phase.
- An optional effectsEnabled=false disables the overlay without changing server
  state. Existing reduced-motion is sufficient for the initial integration; an
  explicit local Weather effects setting can call this independently later.

## Minimal shared-file integrations

1. `packages/contracts/src/index.ts`: import and export
   `WorldClimateSnapshot` from `./world-climate`; add optional
   `climate?: WorldClimateSnapshot` to RoomSnapshot. Export `worldDayAt` if a
   workspace-package import is preferred; direct relative imports also work.
2. `apps/game-server/src/PartyRoom.ts`: import `worldClimateAt` from
   `./world-climate`. In sendSnapshots immediately after capturing `now`, calculate
   `const climate = this.worldId === 'forest' ? worldClimateAt(now, this.homeId) : undefined;`
   once, outside the recipient loop. Add `climate` to the snapshot. Include it for
   interior recipients too so their NPC/routine clocks remain the same; their
   renderer remains hidden. Do not seed from transport epoch or worldRevision.
3. NPC server routines can call `worldDayAt(climate, now).phase` from the contract
   module. For the content lane's three-period routines, map dawn to day. Routines
   must still preserve talking, injured, hunted, and respawning state. Weather does
   not teleport actors or grant personal quest progress.
4. `apps/web/lib/scene.ts`: import WorldClimatePresentation and
   climateDarknessFill. Add one private instance, construct it in create(), and
   destroy it in the existing scene SHUTDOWN handler (not per buildMap).
5. At the end of scene update, after camera follow/lightForest, call:

   ```ts
   this.climatePresentation?.update(snapshot.climate, snapshot.serverTime, time, {
     outdoors: this.forest && !!self && self.mode === 'home' && !self.zone,
     reducedMotion: bridge.reducedMotion,
     sanctuary: { x: 24 * TILE, y: 24 * TILE, radius: 9 * TILE },
   });
   ```

   Use world-definition fire coordinates rather than the literal if the campfire
   moves. Coordinates/radius are world pixels. The renderer follows the viewport,
   so far-apart clients don't render weather for other players' map chunks.
6. In lightForest's darkness-canvas clear/fill section use:

   ```ts
   g.fillStyle = this.forest && bridge.snapshot?.climate
     ? climateDarknessFill(bridge.snapshot.climate, bridge.snapshot.serverTime)
     : darknessFill(this.forest);
   ```

   Preserve every existing light/glow, sanctuary, and visibility check. The
   initial map-construction fill may remain the old fill for its first frame, or
   use the same helper for consistency. Daylight mask alpha ranges .43–.96;
   do not interpret daylight as gameplay flashlight illumination.
7. A discreet clock/weather label can use `climateLabel(snapshot.climate,
   snapshot.serverTime)` from world-climate-model. This is a label, not a live
   region division or boundary. Do not put rapidly changing text in aria-live.

## Bounds and evidence

- Server calculation is O(home id length), constant state/no retained history;
  run once per snapshot, not per human. Wire payload is <340 JSON bytes.
- Client: one 512×320 canvas (655,360 raw RGBA bytes), one Phaser image, one texture;
  no emitter objects, physics bodies, audio nodes, or per-particle timers.
- At most 48 rain drops, 10 leaf marks, four mist banks. Weather supports two
  overlapping conditions during transitions; total work remains bounded.
- Raster updates are capped at 20 Hz, camera placement updates each frame.
  Reduced-motion changes apply immediately; destroy removes texture/image.
- `tests/unit/world-climate.test.ts`: 13 tests cover eight matching recipient
  projections/recreated room, exact day/weather rollover, malformed clocks,
  all weather distributions, mutation isolation, smooth shared phase/weather,
  a week of bounded projections, finite geometry, reduced motion, sanctuary
  compositing, first-frame invalid camera bounds, draw throttle/resource cleanup.
- Focused Node24 Vitest and isolated strict TypeScript compilation pass. This is
  not yet an eight-connected-client gameplay/performance run.
- Original canvas art was rendered over existing forest-floor/tree art in an
  isolated browser fixture at http://localhost:3026/ and visually inspected.
  It demonstrates dawn/rain, day/mist, dusk/breeze, and static reduced-motion night.
  Fixture uses an approximate fire glow; full integrated Phaser lighting and
  fullscreen/mobile/stale-connection transitions still require root verification.

## Integration validation remaining

Run existing regressions plus a Room snapshot test confirming the same climate
for eight people in different zones, actual outdoor/interior/race browser checks,
reduced-motion/static weather and cleanup across repeated world transitions.
Inspect daytime readability against current avatar/monster visibility filtering;
keep any gameplay change explicit rather than deriving it accidentally from art.
Profile eight spread clients together with streaming/population. This foundation
makes no claim of measured 60fps, actual iPhone playback, or speaker mix.
