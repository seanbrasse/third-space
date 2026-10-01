# Backend decision — researched 2026-10-01

No resources or credentials have been created. Existing Vercel connector and CLI login work. Its nine listed projects contain no Third Space project. Available connected tools do not include Fly, Render or Railway; personal context lookup is unavailable. Relevant prior Vercel billing context confirms the user wants to avoid unnecessary resources and protect LifeOS/Angela/portfolio/Glossed. None of their settings were changed. Existing authorized backend hosting remains unconfirmed, rather than proven absent.

Recommendation: Vercel frontend + one always-on Node 24 server with one SQLite disk. For a simple predictable base use Render's 0.5c-512mb service plus 1 GB disk: $7 + $0.25 = $7.25/month before taxes and bandwidth. For the lowest measured configuration cost use Fly Ashburn (iad), shared 1 CPU / 512 MB + 1 GB volume: derived compute estimate $1.94 (256 MB preset) + $1.25 (additional 0.25 GB at $5/GB) + $0.15 disk = approximately $3.34/month before tax/egress. This derives the 512 MB price from the published memory rule; the actual selected machine quote must be confirmed before provisioning. The directly published Fly 2 CPU / 512 MB preset is $3.89 + $0.15 disk = $4.04/month base, if an unambiguous preset quote is preferred.

| Option | Persistence / sleep | Required user decision and access |
| --- | --- | --- |
| Existing persistent VPS/container host | Reuse an isolated process and disk if already authorized; confirm no interference with other workloads | Identify host/account and permitted access; verify incremental costs |
| Render paid, $7.25/month base | SQLite preserved on disk; no idle sleep; brief deploy interruption; one instance | Existing account/access or signup/payment approval; private GitHub import needs authorized repo access; no broad grants |
| Fly Ashburn, approximately $3.34/month derived or $4.04 published preset | Disk persists; prepared config stays awake; single-machine restart/deploy can reset active simulation | Existing account/access or signup/card approval; choose tester-near region and final quote; create exactly one machine/volume |
| Railway Hobby, $5 minimum/month with $5 usage credit | Persistent volume; disable optional sleep for uninterrupted room authority; usage overages possible | Existing account/access or paid plan approval; confirm service memory/CPU/egress and hard spending limit |
| Railway free/trial | $5 trial credit lasts at most 30 days, then $1/month credit; 0.5 GB volume; full trial network eligibility varies; trial volumes deleted 30 days after credits expire | Signup/access approval, possibly GitHub verification OAuth approval; accept limited test duration, possible suspension/deletion; no automatic paid upgrade |
| Render Free, $0 within allowances | TLS/WS supported; sleeps after 15 minutes without traffic; about a minute to wake; SQLite erased on restart/redeploy/sleep; no persistent disk | Signup/access approval and explicit acceptance that identities/PINs/boards are disposable; this does not fulfill durable hosting |
| Railway anonymous VM, short test | Official docs offer existing SSH-key identity and a 24-hour claim window; unclaimed VM/files deleted; exact public HTTPS/WSS port behavior still needs verification | Explicit temporary-test authorization and permission to use an existing SSH public-key identity; no private-key disclosure/new-key creation; no signup or claim without approval |
| Fly free trial | Only 2 VM hours or 7 days; trial machines auto-stop after 5 minutes | Too short/interrupted for sustained friends testing; do not present it as ongoing free hosting |

Fly Ashburn is only a quote region, not an assumption about user location. Other regions multiply compute costs (for example Toronto 1.115, San Jose 1.192, Los Angeles 1.2). For a small Fly app: shared IPv4 is included; avoid dedicated IPv4 ($2/month). First 10 GB of snapshots are included; excess snapshots cost $0.08/GB/month. North America/Europe egress $0.02/GB; other destination groups $0.04/$0.12. Stopped machines accrue rootfs cost $0.15/GB/month; disks accrue costs even while unattached/stopped. Optional paid support and reservations are unnecessary. Card billing/signup may involve a temporary bank hold; do not add payment methods automatically.

The current Render pricing page lists 5 GB included workspace bandwidth for Hobby, then $0.15/GB; account allowances/usage must be checked before final approval. The $7.25 is a base resource price, not a guaranteed total bill. Existing Vercel plan remains unchanged; frontend usage still consumes its existing allowance.

Vercel now has WebSocket beta, but connections end at the function maximum duration and new connections can land on a different instance. It recommends external durable/shared state. Existing Colyseus in-memory authority + local SQLite therefore still needs the persistent backend or a substantial redesign. Using Supabase Edge Functions would also not make this unmodified Node/SQLite server persistent; no protected Supabase project was touched.

## Official sources

- [Fly pricing](https://fly.io/pricing/) — retrieved also with Accept: text/markdown to obtain explicit Ashburn/regional prices.
- [Fly resource pricing](https://docs.fly.io/about/pricing/), [billing](https://docs.fly.io/about/billing/), [free trial](https://docs.fly.io/about/free-trial/).
- [Render pricing](https://render.com/pricing/) — parsed official HTML because readable web output omits the dynamic compute table.
- [Render free limitations](https://render.com/docs/free), [persistent disks](https://render.com/docs/disks), [WebSockets](https://render.com/docs/websocket), [current Blueprint plan IDs](https://render.com/docs/blueprint-spec).
- [Railway pricing](https://railway.com/pricing), [free trial and anonymous VM](https://docs.railway.com/pricing/free-trial), [volumes](https://docs.railway.com/volumes), [optional service sleep](https://docs.railway.com/deployments/serverless).
- [Vercel WebSockets](https://vercel.com/docs/functions/websockets).
