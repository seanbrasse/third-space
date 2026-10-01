# Third Space live deployment

Friends URL: **https://third-space-topaz.vercel.app**. Backend health/readiness: https://third-space-seanbrasse.fly.dev/health and /ready. Existing accounts and resources were used after Sean approved payment and deployment; no additional service or credential grants were created.

## Current exact release

Frontend and backend source: **79e6bdb931f663b314fd5a2689f24379073730be**, merged PR20, including PR18 device activation/authoritative source, PR19 larger projector and the prior PR16/17 contrast/movement/session/mobile fixes.

Vercel READY production deployment: `dpl_5ez5CmvPa1sdqeFMobrPB8rju6a1`, https://third-space-9w2ocs2yp-seanbrasse-gmailcoms-projects.vercel.app. The public stable alias resolves to this deployment; individual deployment URLs and previews remain protected. Frontend metadata matches the source SHA.

Fly image: `registry.fly.io/third-space-seanbrasse:release-79e6bdb`, digest `sha256:f1387501a48a3b553ed5a38da47ac8260b5a83f105a5b9b71bbd8cafa97971ed`. Existing machine `2874440daddd98` updated at 2026-10-01T04:25:43Z. Its OCI revision matches the frontend source. Health/readiness pass.

## Projector and playback verification

The expanded viewer grows from 560 to 960 px. Desktop picture measured 958×539 px; phones use nearly all available width at 16:9. Short landscape screens reserve control space. Controls scroll independently, fullscreen enter/exit and collapsing work. In-room map geometry is unchanged; its further frame enlargement belongs to the scene/config owner.

Fresh hosted checks pass at 1440×1000, 1024×768, 844×390, 390×844 and 320×568 with no panel overflow or page errors. Two actual Chrome clients advance through eight YouTube samples each with zero sampled pauses/media errors; the picture remains visible while hovering shared controls, confirmed from a screenshot. A deterministic mobile gesture-policy adapter passes late join, four-second blocked-device recovery, source replacement/draft separation, queue advancement, reopening and phone bounds. Recovery aligned the two clients within 0.036 seconds. This adapter is not physical iOS verification.

Independent workspace typecheck and 13 scoped media tests pass, and the production Next build passes. An actual amd64 entrypoint boots under 512 MiB/no swap, returns readiness and shows no OOM. Backend code is identical across PR19/20; this startup result is not a concurrency benchmark. Earlier full PR17 validation passed 282 tests and hosted PIN/directory, precise mobile taps, Boost/refill, sequence guard/ack/reconnect and contrast checks. Prior hosted Origin/cookie/WebSocket/persistence checks remain recorded in the deployment handoff.

## Resources and remaining work

Exactly one always-on Fly machine in iad, two shared CPUs/512 MiB; one encrypted 1 GB SQLite volume `vol_42kjoqqqmk98d034` at /data. Included shared IPv4/IPv6 and daily volume snapshots with five-day retention. The approved starting estimate was $4.04/month before tax/usage. No replicas, remote builder, extra database, plans or unrelated projects changed. The isolated deployment builder is stopped and its disposable smoke container removed; the lead's preview/browser/dirty trees were untouched.

Physical iPhone playback and actual game-audio audibility remain unverified. Snapshot creation is verified; restoration is not tested. Native voice and Google login remain unconfigured. SQLite authority must not be replicated without a shared persistence/presence design. Process restarts reset transient room state; high WAN concurrency is not guaranteed by the 512 MiB startup check.

The lead-owned mobile e2e retains obsolete exact picture heights from before PR19. `task-3/larger-projector-mobile-test.patch` replaces them with aspect/width checks and must be guarded-integrated with the lead's active test edits. Portable hosted acceptance already uses this adapted check. The further in-room projector frame and newer forest/social changes remain with the implementation lead.

Detailed sanitized evidence: `task-3/deploy-repo/.data/pr20-release-proof.json`, `.data/pr20-live-acceptance.log`. Private synthetic fixtures, credentials and SQLite contents are excluded from commits and deployment uploads. This documentation commit needs no app redeployment; the running source remains the SHA above.
