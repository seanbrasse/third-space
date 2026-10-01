# Third Space live deployment

Friends URL: **https://third-space-topaz.vercel.app**. Backend health: https://third-space-seanbrasse.fly.dev/health. Provisioned September 30, 2026, New York time, after Sean's explicit payment/deployment approval.

## Exact release

- Frontend source commit: `3b7638d344da4055ca0cf8dadefed1554e1baba8`, including PR #13 projector/race/map, #14 asylum audio, #15 shared playback/flashlight, #11 hosting/entry contrast, #16 dark controls/transparent hover and #17 input recovery/session discovery/PIN/idle/mobile/audio/encounter followups.
- Vercel production deployment: `dpl_dz6cZknJUvMLrpS8s49GpP1ppdmR`, https://third-space-qd480dgfq-seanbrasse-gmailcoms-projects.vercel.app. The stable production alias is public; the individual deployment URL and previews remain protected.
- Backend image: `registry.fly.io/third-space-seanbrasse:release-3b7638d`, digest `sha256:4aa5eda4f8caefa05ff4bfb4b1699125d3434096a9863ce7c97eba8ecd7e27bb`. The running image carries the full frontend commit in its OCI revision label. The existing machine updated at 03:48:05 UTC and frontend promotion completed at 03:48:45 UTC on October 1. Physical iOS player/gesture and active-source presentation remain an independent lead followup.
- Hosting configuration fixes resolve the Dockerfile relative to `deployment/fly.toml`, while the build context remains the repository root. Local build only, `--ha=false`, no remote builder.

## Approved resources and cost

Exactly one Fly machine `2874440daddd98`, `iad`, two shared CPUs, 512 MiB, always on; one encrypted 1 GB volume `vol_42kjoqqqmk98d034` mounted at `/data`. Daily snapshots enabled, retention five days. Initial snapshot `vs_R76y0blX70gPfk8RAkP2z` reached created state, approximately 38 MB. Included shared IPv4 and IPv6; no dedicated IPv4, spare machine, extra database, paid support or remote builder.

Published resource base: $3.89/month compute + $0.15/month volume = **$4.04/month before tax and usage**. North American egress $0.02/GB; first 10 GB snapshot storage free, excess $0.08/GB/month. This is an estimate, not a spending cap. [Official pricing](https://fly.io/pricing/).

## Hosted validation

- Production frontend loads publicly with no error overlay; backend HTTPS `/health` and `/ready` pass. Fly health check passes on the configured port and persistent mount.
- Direct and Vercel-rewritten API reject missing/unapproved mutation Origins. Matchmaking rejects missing/unapproved Origins. Valid secure WebSocket handshakes succeed; an unapproved Origin rejects the same valid reservation before an approved-Origin handshake succeeds.
- Session cookies returned through the frontend have HttpOnly, Secure and SameSite=Strict. Wrong PIN rejected, correct PIN joined.
- Two independent Chrome contexts passed customization, shared movement/chat/board changes and saved-room reload. Refresh/offline reconnection passed.
- Interior navigation, independently entering while a friend stays outdoors, charger/static TV, refresh recovery and returning to the forest passed a hosted followup. The initial legacy exit test expected coordinates after clicking an interactive exit; the actual click had already returned the player to the forest. The followup accepts that intended transition rather than comparing unrelated coordinates.
- Real YouTube playback, two clients: collapsed TV 30 samples/client, about 29.92 seconds advancement; expanded 60 samples/client, about 60.75/60.74 seconds advancement. No sampled paused frames, media errors or page errors. These verify the tested sources and intervals, not every provider video, network or autoplay policy.
- Direct HTTPS MP4 playback and shared play/pause/seek passed with two browsers. Shared queue add/remove/next passed. Button pairs have measured **10 px gaps on desktop and 390 px mobile**, and screenshots were visually inspected.
- Restarted only the new Fly machine: synthetic owner identity, home access and board note survived; a new secure room admission succeeded after restart. No local SQLite file or synthetic fixture database was uploaded.
- Emulated mobile browser: tapping moves the player, sustained touch on the directional arrow moves the player, settings and reload passed. PR #17 now fixes the earlier precise tap-position issue; a real emulated touch after a 14 px DOM shift passed target error below 0.06 tiles and final authority error below 0.4 tiles.

- Mobile join-screen labels, customization helper text and tabs now use matching light/dark surfaces; phone text is 11–12 px. Fresh production browser checks at 320 px, 390 px and 1440 px in both themes measured minimum text contrast 5.32:1 in light mode and 5.99:1 in dark mode, with no horizontal overflow or page errors. Screenshots inspected; input entry and mode switching worked. Vercel production build passed.

## Latest checkpoint verification

PR #15 reconciliation passed 226 unit/integration tests, workspace typechecking, production Next build and amd64 container build. The actual production entrypoint boots under 512 MiB with no swap, no OOM; smoke sample 235.7 MiB is not a capacity benchmark. Hosted charging test passes fresh OFF/full charge, walk-up dock charging and refresh. Two actual Chrome contexts passed PIN join, walking asylum admission, 16:9 projector geometry/title, shared over-video Play/Pause and 30 real YouTube samples per client: about 29.44 seconds advancement, zero sampled pauses/media/page errors, maximum sampled client difference about 0.177 seconds. Public JavaScript contains the projector/shared-play action; frontend metadata and backend image revision match exactly. Pre-rollout snapshot requested on the same existing disk.

## Limits and followup

Native voice and Google login are not configured. This is one SQLite authority; process restart resets transient room state. Do not add replicas without shared persistence/presence design. Daily backups and initial snapshot creation are verified; snapshot restoration is not yet tested. Actual physical phones and larger WAN concurrency remain user testing; local 512 MiB load measurements do not guarantee shared-CPU performance at 64 players.

**Earlier mobile tap offset resolved by PR #17:** the scene owner refreshes Phaser input bounds before fresh pointer/touch conversion after layout changes. Production verification uses actual emulated touch after a 14 px DOM-only shift and passed precise target/arrival checks. Physical-phone coverage remains separate.

All browser fixtures/logs/screenshots remain local and excluded from uploads. No session cookies, PIN grants, credential values or database contents are included in this record. Local deployment-only build VM is stopped; active local preview and other applications/projects were left untouched.

## PR #16/#17 production verification

Independent full suite passed 282 tests; workspace typecheck and Vercel production build passed. New amd64 production entrypoint passed health/readiness under 512 MiB with no swap and no OOM. Existing resource count remains one machine and one disk. Pre-rollout snapshot `vs_Qeox3DX9e3yjtG2gV9XKA` created, approximately 12 MiB; total stored snapshots approximately 60 MiB, five-day retention. Own test container/tmpfs removed and local builder stopped; active preview/other applications unchanged.

Hosted two-browser directory/PIN test passed selection, wrong-PIN rejection, correct admission, refresh and admitted PIN reveal; directory metadata exposes no PIN/verifier/ticket/token/owner ID. Mobile Boost tap/no retrigger/refill and precise floor-touch-after-layout-shift passed. Fresh entry checks at 320/390/1440 px in both themes passed with no overflow/page errors.

Settings controls verified live at 390/1440 px: minimum text contrast 6.06:1 in normal/hover states, legible disabled boundaries and a 3 px keyboard focus outline; light-theme styles were preserved by the earlier candidate parity check and checked live. The generic dark hover rule formerly painted the entire YouTube shared-control overlay green, obscuring the picture while its decoder continued playing. PR #16 keeps the overlay transparent. Production two-client real YouTube followup passed eight samples each, shared over-video actions and projector geometry/title; hovered overlay background is fully transparent and the screenshot visibly shows the picture. No sampled pause/media/page errors. This supplements the longer PR #15 playback samples above.

Direct hosted WebSocket authority check passed accepted neutral inputs acknowledged while seated, rejection of a sequence beyond the existing 10,000 limit, recovery with normal inputs afterward and reconnect with preserved acknowledgement. The client now bounds outstanding sequences and resynchronizes with authority; server validation remains intact. Reload old tabs to load this new client code. These checks do not prove recovery in every preexisting user tab without reload.

Idle 15-minute warning/3-minute grace and actual-visible-playback qualification have controlled-clock/unit coverage; no physical 18-minute idle run is claimed. Audio resume-after-gesture and positional/visibility/encounter changes have unit coverage and are deployed; actual physical-device audibility is not asserted. The supplied phone screenshot showed the earlier small box-TV frame, suggesting a retained old bundle; physical iOS autoplay/gesture and active-source presentation remain with the lead's next media candidate.
