# PR29 final verified release — sole deployment owner

Both frontend/backend LIVE **27176acd0a193f67ce734d22d0a8f446fa4a452e** at https://third-space-topaz.vercel.app. READYfrontenddpl_6YiGK3XwBCMVny28pe4A9i1hca9g exact commit metadata, publicstablealias verified. Existing Flymachine2874440daddd98 started/ready, updated2026-10-01T07:49:39Z, full OCI revision exact; imagerelease-27176ac digest6c84965cba606f163cb862e1a44386973589bdc4527a5d1be78635a4910c232c. Same512MiB/two shared CPUs/1GB encrypted volume; no new resources/credentials. Reviewedddca87e29121460ca7d60a2e49708de5963e2e00/tree379a18ffc1bf2bc49f811222ef9b6f9e73595195 equality andPR27 ancestry verified.

Freshindependent462tests/70files PASS89.62sec in one full run; types/build PASS. Suppliedlead count463combined differs from freshobserved462; actual deployed proof uses462. Actual512MiB/no-swap/readiness/noOOM entrypoint PASS238.1MiB startup sample. Four hosted cases have passing results: baseline3 harvest/eat,desktop1440/mobile390 inventory/1–5 keys/chat typing/fullscreen/PIN/WSS/light/sharedPvP policy/reload/layout/noerrors; NPC8-client case PASS40.4sec then unobscuredartifact PASS36.5sec. All8 humans observe3separate NPCsMoss/Wren/Fern athealth100, excludedfrom human/voice/inventory collections. Ninth denied, sharedchat, legitimate walking/E NPC interaction yields identicaldialogue id/text/until for8, finite removal. NPCdialogue and desktop/mobile screenshots inspected. ScopedVercel errors0. Initial roster-arrow selector and optional artifact navigation harness issues corrected; no appsource edits, failures preserved.

Currentworld80x64 and3defaultNPCs.144x112 authored data fixture-only. NaturalNPC catch/30sec respawn and naturalMimic event not claimed hosted; authority/socket/scene evidence separate. Physicalphone/Safari/speaker/livewolf/snapshotrestore and high WANcapacity limits remain. Inventoryroom-local, SQLitehomes retained. VoicePR28at00b9175525a73a6c795d1b40b8f3a5428f34c8bb draft/conflicting/notready; neverindependentlymerge orpromote, nativevoiceunconfigured. Astra owns next integration; task3 sole platform release owner.

Proof deploy-repo/.data/pr29-release-proof.json; finalNPC .data/pr29-npc-acceptance-final-clear.log/.data/pr29-npc-results-final-clear; baseline .data/pr29-live-acceptance.log/.data/pr29-live-results. Currentfeaturematrix59exact-source paths checked. Ownsmoke removed/builder stopped; all previews3010/2577,3011/2578 andvoice3012/2579 untouched; source/userbrowser preserved. Fresh publicload getsPR29; already-open user tabs need refresh to load currentJS. No deployment blocker. User asleep routine notifications held; concrete milestone recorded forparent/Astra.

---

## Historical provisioning record

# Third Space live deployment

Friends URL: **https://third-space-topaz.vercel.app**. Backend health: https://third-space-seanbrasse.fly.dev/health. Provisioned September 30, 2026, New York time, after Sean's explicit payment/deployment approval.

## Exact release

- Frontend source commit: `5c3006de683cb5438b412f566f9f5673d32d077d`, including lead main `68f5f12087292c89be04edeb8dfdeb2a655a8584` (PR #13 projector/race/map, #14 asylum audio, #15 shared over-video playback and flashlight charging), merged hosting PR #11, scoped watching gaps and mobile entry contrast.
- Vercel production deployment: `dpl_2cCXiB8Wn2sjq1N8uSxarW9ZXSyG`, https://third-space-2nidlad6l-seanbrasse-gmailcoms-projects.vercel.app. The stable production alias is public; the individual deployment URL and previews remain protected.
- Backend image: `registry.fly.io/third-space-seanbrasse:release-5c3006d`, digest `sha256:89e736bc94ba710dd80d5d2314a148993c575f77f4315ca97e308f21123454df`. The running image carries the full frontend commit in its OCI revision label. The existing machine updated at 03:27:18 UTC and frontend promotion completed at 03:27:43 UTC on October 1. Later session/idle/mobile/encounter fixes are pending the lead’s next candidate.
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

## Latest checkpoint verification

PR #15 reconciliation passed 226 unit/integration tests, workspace typechecking, production Next build and amd64 container build. The actual production entrypoint boots under 512 MiB with no swap, no OOM; smoke sample 235.7 MiB is not a capacity benchmark. Hosted charging test passes fresh OFF/full charge, walk-up dock charging and refresh. Two actual Chrome contexts passed PIN join, walking asylum admission, 16:9 projector geometry/title, shared over-video Play/Pause and 30 real YouTube samples per client: about 29.44 seconds advancement, zero sampled pauses/media/page errors, maximum sampled client difference about 0.177 seconds. Public JavaScript contains the projector/shared-play action; frontend metadata and backend image revision match exactly. Pre-rollout snapshot requested on the same existing disk.

## Limits and followup

Native voice and Google login are not configured. This is one SQLite authority; process restart resets transient room state. Do not add replicas without shared persistence/presence design. Daily backups and initial snapshot creation are verified; snapshot restoration is not yet tested. Actual physical phones and larger WAN concurrency remain user testing; local 512 MiB load measurements do not guarantee shared-CPU performance at 64 players.

**Observed mobile tap offset:** with a 390×844 touch context after scrolling to the world, requesting map point (27,28) produced a Phaser move target around (27,28.87). Movement reached that target, about 0.8–0.87 tiles below the intended point. This is reproducible and distinct from connectivity. DOM projection: canvas top 55 px, zoom 0.5028409, scrollY 416, touchY 296.36 px; target discrepancy equals about 14 screen pixels. A stale Phaser canvas/input bound after layout/scroll is an inference to investigate. Directional touch controls pass. The scene owner should refresh/reconcile actual canvas bounds before converting a fresh touch to world coordinates and retain a real-touch regression. This lane has not edited the scene owner’s source to resolve it.

All browser fixtures/logs/screenshots remain local and excluded from uploads. No session cookies, PIN grants, credential values or database contents are included in this record. Local deployment-only build VM is stopped; active local preview and other applications/projects were left untouched.

## Prepared dark-control followup (not yet live)

The settings screenshot shows pale labels and cream segmented controls in dark mode. A scoped CSS candidate fixes settings/room button backgrounds, text, borders, selected/disabled/hover/focus states and notices; keeps disabled semantics and leaves light-theme computed styles unchanged. Actual settings checks at 390/1440 px measure minimum 6.06:1 text contrast, readable disabled outlines and a 3 px keyboard focus indicator.

A distinct CSS cascade bug paints the full-size YouTube overlay solid green on hover through the generic dark button rule. Decoder playback continues underneath, so successful timing samples alone do not prove a visible picture. The followup keeps this overlay transparent while preserving its shared-control label. Physical iOS autoplay/gesture behavior is not verified; the supplied phone screenshot still shows the old small box-TV frame, suggesting an already-open tab with an old bundle. Ask for reload before treating it as the latest-build layout.

An existing long-lived tab may retain a sequence above 10000 after the backend process restart creates an authority with sequence 0; scene code retains its counter with Math.max. This is a source-backed resync hypothesis for the reported range error, not a diagnosis from that user’s tab. Fresh-session movement passes; the lead owns the protocol correction and must retain server validation.
