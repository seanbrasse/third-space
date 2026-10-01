# Third Space live deployment

Friends URL: **https://third-space-topaz.vercel.app**. Backend health/readiness: https://third-space-seanbrasse.fly.dev/health and /ready. Uses existing approved accounts/resources; no new credentials or paid services.

## Exact current release

Both frontend/backend run **52f6dd5abf4997cde567099bf742ad94112185eb**, merged PR21, identical tree to lead-tested head6eba53ffa72ddaa15489e91e553f797ea066e517. This includes the previous media/projector, movement/session and hosting releases.

Vercel READY `dpl_538poHWZBL2UitA5FAMGXKj8otzT`, build https://third-space-cr8x2r77c-seanbrasse-gmailcoms-projects.vercel.app. The stable public alias resolves to it; individual build/previews remain protected. Frontend metadata source equals the backend OCI revision.

Fly image `registry.fly.io/third-space-seanbrasse:release-52f6dd5`, digest `sha256:21fa252ca999d6e977b69f94ba2d70b761bbd66b17893929a0c9b9368fc8bc6f`; existing machine2874440daddd98 updated at 2026-10-01T04:45:28Z. Started/health/readiness verified.

## Included and tested

PR21 adds encounter pacing, retargeting, telegraphed collision-safe wolf leaps, creature takedown, giggle/step cues and area isolation; timestamped readable chat with corrected canvas text density; short aliases for new rooms and verified fragment PIN invites; panel-dismissal game focus; shared skip-time labels and an input-transparent projector border. Existing UUID room IDs remain compatible. Expanded 960 px viewer stays live; further in-room enlargement is separate.

Independent **348 tests/50 files passed in81.14s**, workspace types and production Next build passed. Actual amd64 production entrypoint capped at512MiB/no swap boots and returns readiness with no OOM;237.3MiB startup sample is not a concurrency benchmark. Predeploy volume snapshot `vs_90NLKAMJ0Kolf7XaGKDp6` created,15MiB,five-day retention;total stored75MiB.

Eight hosted feature cases pass: alias/invite prefill without autojoin, explicit admission/PIN reveal/refresh; chat DPR1/2 timestamps and texture density after refresh; desktop1366/mobile390 Map/Settings/Worlds/chat dismissal and Boost; mobile late-join playback activation aligned within0.03s after a4s block, source/draft/queue/reopen; five viewport sizes, expanded picture/fullscreen/collapse, skip-time labels and 3px pointer-transparent surface border; actual clown peek/chase/catch, visible takedown, audio buffer allocation, halo, respawn and refresh. Chat and takedown screenshots inspected. Vercel error-level scan for this deployment returned0 records.

The first encounter test missed a transient chase after a screenshot; a continuous observer verified it. The observer initially lost history at reload, then was corrected. Final rerun passes; no app/authority changes were made. A test-only integration suggestion is `task-3/hosted-encounter-observation.patch`. Optional hosted legacy-room admission skipped because no accessible known legacy fixture was available; migration/unit compatibility tests and startup on the existing volume passed.

## Resources and limits

Same one always-on iad machine,two shared CPUs/512MiB; one encrypted1GB SQLite volume `vol_42kjoqqqmk98d034` at/data; included shared IPv4/IPv6;daily snapshots/five-day retention. Approved starting estimate$4.04/month before tax/usage. No replicas,remote builders,extra databases/plans or unrelated-project changes. Own smoke container removed and deployment builder stopped; lead preview/browser/dirty trees untouched.

Physical iPhone and actual speaker mix remain unverified. Wolf leap authority/presentation tests pass; live wolf leap not visually reproduced. Alias pool174words is finite and applies to new rooms; old IDs stay unchanged. Native voice/Google login remain unconfigured. Snapshot creation verified, restoration untested. SQLite authority needs shared persistence/presence before replicas; process restart resets transient room state. 512MiB startup and hosted checks do not guarantee high WAN capacity.

Next full-game fullscreen/menu and proportional10-tile in-world projector remain with lead. These did not delay PR21. Source mobile picture-height e2e assertions were corrected in PR21; old patch need not be reapplied.

Evidence: `task-3/deploy-repo/.data/pr21-release-proof.json`, `pr21-live-acceptance.log`, `pr21-encounter-observed-v2.log`. Private fixtures/secrets/SQLite contents are excluded from uploads and commits. This documentation commit needs no app deployment; running source stays52f6dd5.
