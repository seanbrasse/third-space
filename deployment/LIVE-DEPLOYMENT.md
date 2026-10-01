# Third Space live deployment — PR22

Friends URL: **https://third-space-topaz.vercel.app**. Backend https://third-space-seanbrasse.fly.dev/health and /ready both healthy.

Both services run **60c40736e66d07e90a60cc1733a14ae084154c76**, merged PR22. Its Git tree equals tested head fa7759b5b6b66b96525458073d770094f6894b64. Vercel READY deployment `dpl_J65ZqCFnCMehrfm5HuGMyPdxBdBS`, build https://third-space-a0es4bl8a-seanbrasse-gmailcoms-projects.vercel.app; public stable alias verified. Individual builds/previews remain protected. Fly image `registry.fly.io/third-space-seanbrasse:release-60c4073`, digest `sha256:913a030a85965f512bf02b3124b897ef95cdec13e9cc612b18f8879477e25825`. Existing machine 2874440daddd98 updated 2026-10-01T05:18:13Z; OCI revision equals frontend metadata.

## Corrected projector and released features

The actual in-world screen is 10×5.625 tiles at16:9, width +66.7% and area 2.778× the old 6-tile screen. Matching art/frame, three cushion and side-cell adjustments preserve eight seats, path/spawn/avatar/charger clearance. Watch Together returns to its 560 px compact desktop cap, retaining phone fit, scroll controls and video fullscreen. This corrects the earlier mistaken modal enlargement.

Whole-game fullscreen includes the game and descendant overlays; nested video fullscreen returns to game fullscreen. The side hub/drawers contain settings/people/worlds/map/chat/session PIN/activities/leave. Slash opens chat; successful Enter clears only the unchanged accepted draft and restores game focus, preserving failed/newer/IME drafts. Player/clown/wolf footsteps increase to .07/.24/.22 with area/mute/falloff retained. Stale scene keyboard/scroll handlers are removed on shutdown/destroy. Earlier session/PIN/idle/movement/media/encounter/contrast features remain in source.

## Release gate and independent verification

Before rollout, task3 materialized and visually inspected actual rendered room and real-video screenshots from Library: libfile_8b768d6429608191833dc54d871d9509 and libfile_4af5600008948191a5c68a9fe35e290c. These show the physical projector and satisfy the correction gate. No dirty preview or old source snapshot was deployed.

Independent **366 tests across 54 files passed in 80.60 seconds**, workspace types and production Next build passed. Actual amd64 production entrypoint capped 512 MiB/no swap boots, returns readiness and shows no OOM;240.1 MiB sample is startup evidence, not a capacity benchmark.

**Ten fresh production browser cases passed in 2.3 minutes**: whole-game fullscreen/settings/map/chat;390/1440 side drawers/close/focus;1366/390 Slash/Enter/movement/Boost/IME; owner explicit leave/saved-home/PIN reveal/refresh plus invited friend refresh; compact two-client mobile activation/current-time/source/draft/queue/reopen; physical 10-tile16:9 surface within camera; focused playback/provider keyboard ownership and nested game/video fullscreen; real YouTube on the in-world screens in two browsers.

The real-video test sampled 30 readings per client with 0 sampled pauses/media/page errors; progression 29.495/29.492 seconds and maximum sampled skew 0.156 seconds. Production scene screenshot visually inspected with the actual visible picture. This is bounded Chrome evidence, not a universal provider/device guarantee. Vercel error-level query for this deployment returned 0 records. Current health/readiness and full metadata/OCI source match verified after acceptance.

## Resources, deliverables and limits

Same one always-on iad machine, two shared CPUs/512 MiB, encrypted 1 GB SQLite volume vol_42kjoqqqmk98d034 at /data, included IPv4/IPv6 and daily snapshots/five-day retention. No new resources, plans, replicas, remote builders or credentials. Most recent pre-migration snapshot from PR21 vs_90NLKAMJ0Kolf7XaGKDp6 is created; no schema change in PR22 required another snapshot. Own builder stopped and smoke container removed; lead preview/browser/dirty trees and unrelated projects untouched.

Full feature matrix: task-3/Third Space Feature Matrix.md (49 exact-commit source links checked). Actual production image: task-3/deploy-repo/.data/pr22-live-screenshots/youtube-live-current.png. Sanitized proof: .data/pr22-release-proof.json and pr22-live-acceptance.log. Native Library export helper reported prepare_uploads unavailable before writing; these files are retained locally, with no duplicate/uncertain Library writes attempted. Existing Library candidate screenshots remain linked above.

Physical iPhone provider/fullscreen, real speaker acceptance and visually observed live wolf leap remain unverified. Native voice/Google login remain unconfigured. Alias pool 174 words is finite; old UUIDs preserved and unknown hashed PIN cannot be reconstructed. Snapshot restore untested. Process restart resets transient room state; replicas require shared persistence/presence design. High WAN concurrency not established by startup checks. Lead's newer creature-animation/greeting followup is separate and did not delay PR22.

Documentation changes need no app redeploy; running source stays 60c4073. Private session credentials, PIN grants, SQLite contents and transfer URLs are excluded from commits/uploads.
