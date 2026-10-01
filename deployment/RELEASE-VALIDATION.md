# Deployment release validation

Source release: `41b3edb26c0b890fe875299630bc555444ef78c4`, merged YouTube hotfix PR #10. Backend, data, contracts and simulation source are identical to milestone 9 `14c25bd6614466665bba28355627734379f02685`, tested below. Prepared deployment files are additional scoped changes in the deployment branch. Dirty milestone 10 racing work is excluded.

## Independent local checks

- Milestone 9: all 12 integration tests in three files passed in the isolated checkout.
- Production Next builds passed both milestone 9 and PR #10 source.
- Production Dockerfile built Linux ARM64 and Linux amd64. The amd64 release image started using the actual production entrypoint with a fresh synthetic volume, 512 MiB limit, no swap and one local CPU; SQLite readiness passed and OOMKilled was false. Image manifest: `sha256:6c1e235d201c44510222315dd8f3d0a4dc610fe6cd8f9cd21c720c4183bd1a56` (local build, not a published registry digest). Its idle/startup peak including Rosetta translation was 185.54 MiB; this is a smoke check, not a new amd64 load test.
- Authenticated `fly config validate --config deployment/fly.toml` passed.
- Native Linux ARM64 backend capped at 512 MiB, no swap, one local CPU: 8 players for 60 seconds, 32 for 30 seconds, 64 for 30 seconds. 112,516 input packets, 84 board writes, one reconnect and ten room recreation cycles; no unexpected errors or memory-limit/OOM events. Kernel peak 113.77 MiB; minimum snapshot throughput 19.86 Hz. See [measurements](release9-memory-results.json).
- The production image's actual entrypoint, without benchmark adapter, bound successfully and reported production health and SQLite/Colyseus readiness. It passed exact allowed Origin, missing/unapproved mutation and matchmaking Origin rejection, HttpOnly/Secure/SameSite=Strict session flags, denied wrong PIN and successful correct PIN join.
- The production entrypoint recovered eight saved synthetic identities and eight boards after restart, and issued eight new successful WebSocket admissions. No credentials or database contents appear in committed reports. Synthetic volume/fixtures were removed after checks.

## Limits

The short milestone 9 test contains no media actions because control now requires an indoor location; the lead separately verified two-browser YouTube playback and controls. Earlier longer base tests, including translated amd64, remain in [MEMORY-TEST.md](MEMORY-TEST.md). Local ARM64 performance does not establish Fly amd64 shared-CPU capacity or WAN latency. The load test uses SDK connections, not browser devices. Hosted TLS, Vercel rewrites/session behavior, origin enforcement, reconnection, room PINs, direct/YouTube media and restart/snapshot recovery remain acceptance gates after provisioning.
