# Third Space hosting preparation

Status: accounts connected and application projects prepared; no live multiplayer deployment yet. Release source: 41b3edb26c0b890fe875299630bc555444ef78c4 (merged PR #10, YouTube hotfix), incorporating verified milestone 9 at 14c25bd6614466665bba28355627734379f02685. Ongoing uncommitted race work is excluded. See [release validation](RELEASE-VALIDATION.md) and [account setup](SETUP.md).

## Architecture

Vercel hosts only apps/web (Next 16.3.7, React 19.3, Phaser 3.90). Configure the Vercel project Root Directory as apps/web, Node 24.x, and include source files outside the root directory for its workspace imports. The new apps/web/vercel.json builds Next directly, bypassing the local root scripts that inject localhost defaults and run a second server.

The authoritative game/API is Colyseus 0.18 + Express on persistent Node 24. SQLite stores profiles, sessions, homes/PINs/access grants and board data. Gameplay positions, room destination, active race and shared playback are in memory; process restart resets those transient values. A disk preserves the stored data, not the active simulation. One process/one disk is the supported initial deployment; do not enable replicas or autoscaling.

Vercel's current WebSocket beta supports transport, but function duration and instance changes require external durable/shared room state. Moving this existing server to Vercel Functions would require a persistence/authority redesign. Keep the server on a persistent host for this release.

## Deployment sequence after host/access approval

1. Confirm the recorded verified release SHA. The lead's production host/port, Secure cookie and origin-policy changes are already integrated in milestone 9. Build/test in the isolated checkout.
2. Provision only the chosen single server and persistent disk. No new database subscription, paid support, dedicated IP, recurring job or preview backend is needed.
3. Deploy the backend with an empty persistent /data mount. Do not upload Sean's local SQLite files or copy test fixtures. Container copies only source/package manifests, then initializes mount directory ownership and runs Node as the node user.
4. On Vercel set GAME_HTTP_URL to the backend HTTPS origin and NEXT_PUBLIC_GAME_SERVER_URL to the same host with wss://. Both must be set before build; rebuild after URL changes. Existing API rewrites keep browser session cookies on the frontend origin.
5. Set backend WEB_ORIGIN to the exact stable frontend HTTPS origin and NODE_ENV=production. Secure cookies are enabled by the verified server. Keep preview origins blocked until separately authorized. Make only this new project's production alias public for friends after authorization; retain protected previews and leave all existing projects unchanged.
6. Deploy production and complete live verification below before sharing with friends. Record frontend URL, backend URL, commit SHA, host resources and limitations. Native voice remains unavailable until a separately approved/configured media service exists.

## Prepared files

- Dockerfile.game-server: pinned Node/pnpm runtime, filtered backend dependency install, no data/credentials in the image. Build from repository root using -f deployment/Dockerfile.game-server.
- container-entrypoint.sh: makes the mounted /data directory writable, then drops root and execs the server.
- fly.toml: reserved app third-space-seanbrasse, exact Vercel production origin, TLS, one persistent disk and always-on service. Configuration validates with the authenticated CLI. Provision one machine explicitly with --ha=false; Fly deploy defaults can create a spare. fly.toml.example remains a reusable reference.
- render.yaml.example: current 0.5c-512mb plan, one disk, automatic deploys disabled. Reference only; applying creates paid infrastructure.
- railway.json.example: Docker backend and healthcheck. Persistent /data volume, service environment and one replica must be configured separately. Do not turn on paid billing automatically.

## Live acceptance gate

Use two independent browser profiles/devices (not merely SDK connections). Create a fresh test identity and room/PIN; join with the second profile, verify shared movement/chat and denied wrong PIN. Confirm /api cookies have HttpOnly, SameSite=Strict, Secure and are usable via the frontend rewrite. Verify successful matchmaking/WSS with the production Origin and rejected unapproved Origin.

Switch destinations, enter/exit the asylum if present in the candidate, then disconnect/reconnect and refresh. One live authority must remain consistent. Exercise shared add/remove queue, next/play/pause/seek, visible TV and expanded view. Verify direct video/YouTube media over HTTPS with actual browser restrictions and autoplay limits; avoid any localhost media URLs. Eight SDK test clients do not establish eight-device browser behavior.

Create a board note and room, restart only this new backend, then verify identities/access/PIN and board note survive on the mounted disk. Transient simulation/playback may reset and should recover through a fresh admission; do not promise preservation of live room state through redeploys. Check health/ready, mixed-content errors, WSS handshake, latency/loading UI and HTTPS on mobile.

## Current validation and limits

The milestone 9 production Next build and all 12 integration tests across three files passed independently. The milestone 10 YouTube-only hotfix also passed a fresh production Next build; its backend source is identical to milestone 9. No shared source symlinks or active local-preview changes. Configuration parse, shell syntax and diff whitespace checks passed.

The Dockerfile now builds for Linux ARM64 and amd64. A benchmark-only adapter tested unchanged game sources under a hard 512 MiB cgroup limit with no swap. Native eight-player gameplay passed ten minutes at 20.04 Hz minimum snapshot throughput. A complete translated amd64 8/32/64-player run plus reconnect/churn checks passed without memory-limit/OOM events; its peak of 356.33 MiB includes translator overhead. Synthetic identity sessions, eight boards and fresh admissions survived a container restart on the test volume. See [memory methodology and limits](MEMORY-TEST.md) and [sanitized measurements](memory-results.json). Local benchmark VMs/volumes are removed after testing.

Milestone 9 also passed a native Linux ARM64 512 MiB/no-swap run with 8/32/64 synthetic players and a 113.77 MiB kernel peak. Media actions were disabled for this quick run; provider playback was separately verified by the lead. The actual production container entrypoint passed health/readiness, Secure cookie flags, exact-origin rejection, wrong/correct PIN checks, and restart persistence with eight saved identities/boards and fresh WebSocket admissions. See [sanitized measurements](release9-memory-results.json). These are local checks, not hosted browser acceptance.

For the initial friends release, Fly's published 2-shared-CPU / 512 MiB preset in iad plus a 1 GB volume is $4.04/month resource base before tax/egress. Fly app and Vercel project names are reserved, with no Fly machines, disks or IPs provisioned. Paid resources await explicit approval. Actual-host CPU/latency, snapshot/restore behavior, hosted HTTPS/WSS/cookie/origin checks and two-browser media verification remain required before a live-ready claim. The older 64-player translated stress had latency spikes and does not establish smooth 64-player capacity.
