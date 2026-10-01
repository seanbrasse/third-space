# Third Space account setup

## Current state

Fly CLI is installed and authenticated as Sean. Following Sean's explicit approval, the personal organization runs one `third-space-seanbrasse` machine with an encrypted persistent volume. Its HTTPS/WSS host is `third-space-seanbrasse.fly.dev`. Included shared IPv4 and IPv6 are allocated. No remote builder or paid support subscription was created. See [live resource and validation record](LIVE-DEPLOYMENT.md).

Vercel's existing authorized account contains the new `third-space` project, with Next.js, Node 24.x, root `apps/web`, and workspace sources outside the root enabled. Its live production alias is `https://third-space-topaz.vercel.app`. Production environment points `GAME_HTTP_URL` to the Fly HTTPS host and `NEXT_PUBLIC_GAME_SERVER_URL` to its WSS host. The project is intentionally not connected to automatic GitHub deploys while implementation continues.

After authorization, this new project's protection was set to `prod_deployment_urls_and_all_previews`: friends can open the production alias while previews remain protected. No other project or account setting changed.

## Approval before provisioning

The initial design is one always-on machine in Ashburn (`iad`), two shared CPUs, 512 MiB, one 1 GB encrypted SQLite volume, daily snapshots with five-day retention, and included shared IPv4/IPv6. Published base: $3.89/month compute + $0.15/month volume = $4.04/month, excluding tax and usage. North American egress is $0.02/GB. First 10 GB of snapshots is free; additional snapshot storage is $0.08/GB/month. See [official Fly pricing](https://fly.io/pricing/). No paid support or dedicated IPv4 is needed.

Original deployment scope required approval for paid resources and new security access. Sean approved the quoted resource cost and public production alias with "Go ahead, I added payment." This authorization is already satisfied; do not request it again for the same approved deployment. Sean completes any further payment-method, password, verification-code or additional OAuth permission step directly with the provider.

## Deployment after approval

Run from the isolated repository root, not from the active preview or publishing mirror. Use the already built Linux amd64 production image or a local Docker build, avoiding a billable remote builder. Never upload local SQLite files or synthetic fixtures.

1. Recheck Fly billing readiness and that this app still has zero machines/volumes/IPs.
2. Create one `third_space_data` volume: region `iad`, size 1 GB, scheduled snapshots enabled, retention five days. Retain default encryption.
3. Allocate included shared IPv4 and IPv6 only.
4. Deploy with `fly deploy . --config deployment/fly.toml --local-only --ha=false`. Use the dedicated deployment Docker context explicitly. Confirm exactly one machine and one volume; do not enable replicas, autoscaling, or a spare.
5. Verify the backend's public HTTPS `/health` and `/ready`, production origin and denied origins, then deploy the configured Vercel project to production.
6. Complete the README's two-browser acceptance gate before calling the application playable. Native voice is unconfigured. Stored SQLite data survives restart; active room simulations/playback restart with the process.

This is a single-host friends release. Horizontal scaling requires shared durable storage and multi-process Colyseus presence/driver design; adding machines to the SQLite configuration is unsupported.
