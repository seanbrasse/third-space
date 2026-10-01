# Third Space live deployment

Friends URL: **https://third-space-topaz.vercel.app**. Backend health: https://third-space-seanbrasse.fly.dev/health. Provisioned September 30, 2026, New York time, after Sean's explicit payment/deployment approval.

## Exact release

- Frontend source commit: `25af1250446d497c771fa9c0375f4698b03a8235`, including verified main `418906dec73c5f19acfc3ab6bcfd3c122eae7b37` (PR #12 forest ambience/wayfinding), PR #10 YouTube playback changes, scoped shared-watching button gaps, and theme-aware mobile entry labels/tabs with larger phone text.
- Vercel production deployment: `dpl_9RZQdL9vayDrk2gg2KvwHTEGWjfJ`, https://third-space-1m0qavke6-seanbrasse-gmailcoms-projects.vercel.app. The stable production alias is public; the individual deployment URL and previews remain protected.
- Backend image: `registry.fly.io/third-space-seanbrasse:release-9f6480b`, digest `sha256:a657ac1bfd3fee857f9a9afd3838477a9461fdd45f1897d91653b543a99d6c58`. Backend sources are unchanged between the verified PR #10 source and PR #12; the latter changes only frontend forest code/tests. Later PR #13 racing-lobby/door followups are excluded from this scoped CSS release.
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
- Emulated mobile browser: tapping moves the player, sustained touch on the directional arrow moves the player, settings and reload passed. A precise tap-position check remains an identified issue below; the broader movement check does not erase it.

- Mobile join-screen labels, customization helper text and tabs now use matching light/dark surfaces; phone text is 11–12 px. Fresh production browser checks at 320 px, 390 px and 1440 px in both themes measured minimum text contrast 5.32:1 in light mode and 5.99:1 in dark mode, with no horizontal overflow or page errors. Screenshots inspected; input entry and mode switching worked. Vercel production build passed.

## Limits and followup

Native voice and Google login are not configured. This is one SQLite authority; process restart resets transient room state. Do not add replicas without shared persistence/presence design. Daily backups and initial snapshot creation are verified; snapshot restoration is not yet tested. Actual physical phones and larger WAN concurrency remain user testing; local 512 MiB load measurements do not guarantee shared-CPU performance at 64 players.

**Observed mobile tap offset:** with a 390×844 touch context after scrolling to the world, requesting map point (27,28) produced a Phaser move target around (27,28.87). Movement reached that target, about 0.8–0.87 tiles below the intended point. This is reproducible and distinct from connectivity. DOM projection: canvas top 55 px, zoom 0.5028409, scrollY 416, touchY 296.36 px; target discrepancy equals about 14 screen pixels. A stale Phaser canvas/input bound after layout/scroll is an inference to investigate. Directional touch controls pass. The scene owner should refresh/reconcile actual canvas bounds before converting a fresh touch to world coordinates and retain a real-touch regression. This lane has not edited the scene owner’s source to resolve it.

All browser fixtures/logs/screenshots remain local and excluded from uploads. No session cookies, PIN grants, credential values or database contents are included in this record. Local deployment-only build VM is stopped; active local preview and other applications/projects were left untouched.
