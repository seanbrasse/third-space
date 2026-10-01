# Garden Dash racing upgrade

The authority and Phaser prediction share the immutable `garden-dash-v3` course.
Four 90-tile sections progress from short garden blocks to taller stone steps,
wider brambles and three increasingly wide creek gaps. Every checkpoint has
safe ground beyond its flag. The normal jump clears every obstacle; boosts are
optional. No random hazard layouts, moving client-only colliders or contested
pickup inventory can advantage one racer.

Each racer can collect the eight personal pickups once per race. Gold `>>`
gives 25% more speed; purple `^` gives 18% more jump velocity. Each lasts 4.5
simulation seconds. Same-kind pickups refresh to the larger existing duration
or 4.5 seconds, with a hard 6-second bound; power never multiplies. Two different
kinds can run together. Death/respawn clear active power but preserve collected
IDs to prevent checkpoint farming; starting a new race resets inventory and
jump/death/pickup counters. Server physics checks proximity. No pickup, speed,
duration or counter command is accepted from a client.

`raceJumpCount`, `raceDeathCount` and `racePickupCount` increase only in shared
physics. The audio observer compares authoritative snapshots, baselines first
join/reconnect/visibility changes, ignores repeated or older packets, and plays
at most one cue per kind per packet. Death suppresses a jump/pickup that shares
its packet. Client prediction replay produces no audio.

The theme and cues are original deterministic Web Audio synthesis: a 132 BPM
four-chord loop with melody, bass and soft percussion, plus rising jump,
descending death and pickup arpeggio cues. They share the existing gesture-
unlocked AudioContext. The game's effects volume and game mute control their
independent bus. Music runs only during countdown/running while the local racer
is connected, unfinished and visible. It stops on return/disconnect/background/
mute and fades at finish/results. Waiting lobbies are silent until countdown.
No new media download, dependency, paid service or copyrighted track is used.

## Waiting lobby and entrance acceptance contract (lead-owned integration)

- Proximity to the cabin presents Join race / Cancel before `race.enter`.
- Cancel sends no admission command. Remaining near the doorway causes no repeat
  dialog; leaving the outer 2-tile radius rearms it. Confirm sends once.
- Confirm joins the shared waiting lobby. The first racer can wait for friends or
  ready alone. Subsequent confirms join the same lobby.
- Track lobby membership separately from ready IDs. Countdown starts when all
  currently connected joined racers are ready, including a solo ready racer.
- Lobby physics stays frozen and input queues are cleared before countdown.
  Preserve one race ID/course/start time for every participant. Reject running
  late joins. Removing a waiting racer must reevaluate the all-ready condition.
- Waiting racers and outside campsite members have a room-wide voice bridge;
  voice mute/deafen/access/connection preferences still apply. Do not use race
  tile coordinates for proximity between lobby and campsite. Restore the normal
  world/race voice boundary once countdown starts or the racer leaves.
- Worlds and the caption need separate header space at desktop/mobile widths.
  Race helper labels sit inside the map; its boost HUD undoes camera zoom and
  wraps on narrow viewports. The lead owns the Worlds/header CSS fix.

## Verification

Run `NODE_OPTIONS=--experimental-sqlite node_modules/.bin/vitest run --config
vitest.racing.config.ts` in the isolated checkout on Node 23.3 (or use the
project's Node >=24 runtime without this flag).

45 tests pass across six files: normal and boosted full-course deterministic
traces, boost limits/expiry/respawn/reset/personal inventory, prediction and
authority parity, real PartyRoom pickup validation/snapshot sync/lifecycle,
audio dedup and gesture/mute/volume/background/finish lifecycle, original sample
bounds, and existing collision/map/audio regressions. Normal full course:
3547 ticks (59.133 seconds including the final tick), boosted: 3294 ticks
(54.917 seconds including final tick), all four checkpoints, zero deaths.
Config, contracts, simulation, game-server and web typechecks pass.

The delegated lane did not restart a preview or alter the shared checkout.
Browser/real-speaker QA remains the integration owner's final check after applying
this patch and the lead's waiting-lobby/voice/header changes.

## Shared waiting lobby integration
Confirmed cabin entry joins one shared waiting lobby (`phase: waiting`, `joinedIds` separate from `readyIds`). Physics stays frozen. Each joined racer may ready/unready; all currently joined racers must be connected and ready before the automatic three-second countdown. A solo racer can ready immediately or wait. New entry is rejected after countdown begins. Leaving waiting removes membership without a DNF; remaining all-ready racers start. Disconnect clears readiness and retains membership during grace, so reconnect requires readying again.

Waiting snapshots expose one worldwide `voiceScope` containing connected campers outside and joined waiting racers, without distance cutoff. Asylum occupants are excluded and the bridge ends at countdown. Native voice is still unconfigured; this is eligibility/state integration, not a functioning voice transport.

Race music is silent while waiting, fades in for countdown/running, and follows game-sound muting independently of media and voice. Personal powerups reset on retry, death clears active power, and return/finish/world changes clear it.
