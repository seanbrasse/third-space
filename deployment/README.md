# Third Space hosting preparation

Status: prepared only; no frontend/backend resource has been provisioned and there is no live multiplayer URL. Base candidate: cf0892500367212f4c62b39090e83228ccb546b0 (PR #8). Latest asylum/playback changes must arrive as a verified candidate from the implementation lead before release.

## Architecture

Vercel hosts only apps/web (Next 16.3.7, React 19.3, Phaser 3.90). Configure the Vercel project Root Directory as apps/web, Node 24.x, and include source files outside the root directory for its workspace imports. The new apps/web/vercel.json builds Next directly, bypassing the local root scripts that inject localhost defaults and run a second server.

The authoritative game/API is Colyseus 0.18 + Express on persistent Node 24. SQLite stores profiles, sessions, homes/PINs/access grants and board data. Gameplay positions, room destination, active race and shared playback are in memory; process restart resets those transient values. A disk preserves the stored data, not the active simulation. One process/one disk is the supported initial deployment; do not enable replicas or autoscaling.

Vercel's current WebSocket beta supports transport, but function duration and instance changes require external durable/shared room state. Moving this existing server to Vercel Functions would require a persistence/authority redesign. Keep the server on a persistent host for this release.

## Deployment sequence after host/access approval

1. Receive the verified release SHA and integrate deployment/integration-request.md through the lead. Build/test that exact candidate in the isolated checkout.
2. Provision only the chosen single server and persistent disk. No new database subscription, paid support, dedicated IP, recurring job or preview backend is needed.
3. Deploy the backend with an empty persistent /data mount. Do not upload Sean's local SQLite files or copy test fixtures. Container copies only source/package manifests, then initializes mount directory ownership and runs Node as the node user.
4. On Vercel set GAME_HTTP_URL to the backend HTTPS origin and NEXT_PUBLIC_GAME_SERVER_URL to the same host with wss://. Both must be set before build; rebuild after URL changes. Existing API rewrites keep browser session cookies on the frontend origin.
5. Set backend WEB_ORIGIN to the exact stable frontend HTTPS origin and NODE_ENV=production. Configure production Secure cookies through the lead patch. Keep preview origins blocked until separately authorized. Do not disable deployment protection on existing projects.
6. Deploy production and complete live verification below before sharing with friends. Record frontend URL, backend URL, commit SHA, host resources and limitations. Native voice remains unavailable until a separately approved/configured media service exists.

## Prepared files

- Dockerfile.game-server: pinned Node/pnpm runtime, filtered backend dependency install, no data/credentials in the image. Build from repository root using -f deployment/Dockerfile.game-server.
- container-entrypoint.sh: makes the mounted /data directory writable, then drops root and execs the server.
- fly.toml.example: exact frontend origin placeholder, TLS, one persistent disk and always-on service. Copy to a chosen config only after app name/region/cost approval. Provision one machine explicitly; Fly launch defaults may create a spare.
- render.yaml.example: current 0.5c-512mb plan, one disk, automatic deploys disabled. Reference only; applying creates paid infrastructure.
- railway.json.example: Docker backend and healthcheck. Persistent /data volume, service environment and one replica must be configured separately. Do not turn on paid billing automatically.

## Live acceptance gate

Use two independent browser profiles/devices (not merely SDK connections). Create a fresh test identity and room/PIN; join with the second profile, verify shared movement/chat and denied wrong PIN. Confirm /api cookies have HttpOnly, SameSite=Strict, Secure and are usable via the frontend rewrite. Verify successful matchmaking/WSS with the production Origin and rejected unapproved Origin.

Switch destinations, enter/exit the asylum if present in the candidate, then disconnect/reconnect and refresh. One live authority must remain consistent. Exercise shared add/remove queue, next/play/pause/seek, visible TV and expanded view. Verify direct video/YouTube media over HTTPS with actual browser restrictions and autoplay limits; avoid any localhost media URLs. Eight SDK test clients do not establish eight-device browser behavior.

Create a board note and room, restart only this new backend, then verify identities/access/PIN and board note survive on the mounted disk. Transient simulation/playback may reset and should recover through a fresh admission; do not promise preservation of live room state through redeploys. Check health/ready, mixed-content errors, WSS handshake, latency/loading UI and HTTPS on mobile.

## Current validation and limits

Pinned dependency install, the direct production Next build, and all 11 integration tests across two files passed independently on the base candidate. No shared source symlinks or active local-preview changes. JSON configuration parse, shell syntax and diff whitespace checks passed.

The Dockerfile now builds for Linux ARM64 and amd64. A benchmark-only adapter tested unchanged game sources under a hard 512 MiB cgroup limit with no swap. Native eight-player gameplay passed ten minutes at 20.04 Hz minimum snapshot throughput. A complete translated amd64 8/32/64-player run plus reconnect/churn checks passed without memory-limit/OOM events; its peak of 356.33 MiB includes translator overhead. Synthetic identity sessions, eight boards and fresh admissions survived a container restart on the test volume. See [memory methodology and limits](MEMORY-TEST.md) and [sanitized measurements](memory-results.json). Local benchmark VMs/volumes are removed after testing.

For the initial friends release, the prepared Fly configuration uses its published 2-shared-CPU / 512 MiB preset in iad plus 1 GB volume, quoted at $4.04/month resource base before tax/egress. No cloud resources have been provisioned. Repeat the memory test on the latest verified candidate. Server integration, actual-host CPU/latency, backup setup, hosted HTTPS/WSS/cookie/origin checks and browser/media verification remain required before a live-ready claim. The 64-player translated stress had latency spikes and does not establish smooth 64-player capacity.
