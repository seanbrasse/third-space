# Campsite werewolf

The server owns one rare werewolf encounter, sharing the clown's cover points, navigation, swept collision, safe fire boundary, catch/respawn and retreat rules. PartyRoom permits one active threat at a time. Only the campsite (`forest`) creates this helper; races and indoor players are excluded. A world change discards it.

## Tunable defaults

`WEREWOLF_DEFAULTS` in `apps/game-server/src/ForestWerewolf.ts`:

| Setting | Werewolf | Existing clown |
| --- | --- | --- |
| Explorer checks | 150 seconds, ±15% jitter | 30 seconds, ±15% jitter |
| All players near fire | 25–50 minutes | 5–10 minutes |
| Running speed | Constant 1.7 × `homeSpeed` (6.8 tiles/sec at current 4) | Lurches between 0.35 × and 1.35 × (peak 5.4 tiles/sec) |
| Target distance at spawn | 12–14 tiles | 2.5–7 tiles |
| Hidden margin | More than 2 tiles outside the ten-tile snapshot visibility boundary | No all-player hidden check |

The rate is a check cadence, not a guaranteed spawn frequency. Existing threats and unavailable cover can defer it further. Failed safe-candidate searches retry after five seconds. Camping encounters only approach up to three tiles, remaining outside the fire safety radius, then retreat; they never become hunts. Hunts retain the three-second peek and fourteen-second chase limit. Returning to fire, racing, disconnecting, respawning or entering another zone ends the hunt.

## Visibility guarantee

The actual existing server visibility model sends threat state only to connected outside home players within ten tiles. Every werewolf cover candidate must be **more than twelve tiles from every such active player**, including seated, halo-protected and respawning observers. A candidate may never rely on darkness, facing or an assumed occluder. No werewolf sprite state is delivered at spawn, regardless of camera width or lighting; it appears only after moving into the ten-tile visibility boundary. Offline, race and indoor players cannot see this campsite threat. If no safe cover exists, there is no spawn and no howl.

This guarantee depends on retaining the same snapshot visibility cull for werewolves. If the lead expands threat visibility later, update the eligibility boundary alongside it. Client camera projection currently uses a rectangular viewport fitting at least 22 tiles along its short dimension; this implementation does not assume a maximum viewport width.

## Art and sound

`werewolf-art.ts` generates six cached 48 × 32 pixel canvases: hunched mane/shoulders, long muzzle, pointed ears, amber eye, fangs, torn human trousers and four clawed limbs. Scene animation uses 75 ms frames while galloping, faces the target and retains depth ordering; reduced motion freezes pose zero. The original canvas sprite workflow needs no downloaded or paid assets.

`werewolf-sound.ts` generates original cached howl, rough low growl, paw and claw samples on the existing game audio bus. One server event ID identifies the spawn howl; no audio is reconstructed from snapshots. The howl has a 32-tile spatial cutoff; growls, claws and paws use twelve tiles. Growls start 3.5 seconds after spawn during a chase and then recur at most once per 2.6 seconds, with no catch-up burst. Paws have a 180 ms cadence and are softer than clown boots. The werewolf never sets `giggleAt`, emits giggles or uses the clown's knife impact.

All live events carry room epoch/world revision, expire quickly and are deduplicated across repeated events, snapshots and reconnect instance changes. Catch IDs distinguish wolf claws from clown slashes even if both encounter serials are `1`. The server does not retain or replay these events on reconnect. Existing local audio unlock, game mute, volume and sixteen-cue limit apply. Calls consumed while muted or locked are not queued for later playback. Ambient synthetic wolf calls remain the existing independent atmosphere system.

## Verification

The isolated dirty-source snapshot resolves package imports to its own copies rather than the original checkout's workspace symlinks. `vitest.werewolf.config.ts` and temporary tsconfig path overrides are verification scaffolding and are excluded from the integration patch.

Focused tests cover rarity relative to clown, every-player invisibility (including protected observers), no safe candidate, deferred retry, swept movement/collision, safe perimeter behavior, one howl, growl/no giggle, catch authority, distinct impact IDs, no overlapping threats, reconnect, world/race/zone transitions, muted/locked audio and finite bounded samples. Existing clown, room and audio tests are also run. The sprite gallery in `evidence/werewolf-sprites.png` was rendered in isolated headless Chrome and visually inspected at enlarged and game scale.
