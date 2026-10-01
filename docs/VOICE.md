# Native party voice

Native voice is opt-in and supports eight admitted party members. Choose **Listen only** to receive audio without capture, or **Enable microphone** to request browser permission on that click. **Off · use Discord** disconnects media and stops capture. Mute and deafen are independent controls; deafen also mutes transmission. Voice volume and per-person volume do not change game ambience or movie audio. No recording, transcription, AI audio, or video is implemented.

The host selects proximity or room-wide policy. Proximity uses actual stable zone strings, the shared world revision, and the race instance; personal zone revisions do not split friends in the same interior. Safe fire and halos preserve conversation. Audio has full gain within two tiles, fades smoothly toward twelve tiles, enters hearing range below 11.5 tiles, and remains subscribed until twelve tiles. The waiting race bridge preserves outdoor conversation until the race begins. Room-wide explicitly includes the entire admitted party, including interiors and races.

## Admission and privacy boundary

Only an active, current, admitted Colyseus session can request `voice.join`. Room access is checked before and after asynchronous provider operations and again before returning the private token. The HTTP token endpoint refuses issuance. Tokens expire after 30 seconds, bind one identity to one media room/epoch, forbid data and metadata changes, and initially forbid publishing. Each user has one media lease; replacing a tab or joining again removes its old identity. The provider room caps participants at eight. The controller removes unknown identities, extra tracks, and non-microphone tracks.

The backend computes authoritative hearing identities and policy versions. The official LiveKit publisher subscription ACL is the forwarding boundary; volume attenuation is presentation. Clients start with a deny-all ACL and acknowledge the current allowlist before the backend grants microphone publishing. A malicious listener calling `setSubscribed(true)` cannot override another publisher's ACL. A publisher can deliberately expose its own audio by modifying its client; this is not backend-only enforcement against a malicious speaker.

An acknowledgement confirms that the browser enqueued the SDK ACL update, not a transactional acknowledgement from the SFU. Honest clients deny publishing and silence playback after two seconds without fresh policy. The backend removes a lease after 2.5 seconds without a current heartbeat or changed-policy acknowledgement (eight seconds for initial connection), checked on 500 ms controller ticks. Provider requests have two-second deadlines; independent participant operations finish together and are fully settled before another tick. Roster reconciliation occurs every two seconds. Network/provider delays extend removal latency; this is not a hard real-time privacy guarantee. On provider failure the room disables native voice and attempts media-room deletion, with no allow-all fallback. A disconnected provider can prevent immediate administrative removal.

Self-hosted LiveKit 1.13.7 was tested locally with real synthetic WebRTC audio. `canSubscribe:false` plus administrative `UpdateSubscriptions` did not deliver tracks, despite a successful API response, so that architecture is not used. Related [upstream report](https://github.com/livekit/livekit/issues/4651) concerns 1.13.3; no equivalent Cloud behavior is claimed. Verify the chosen production endpoint and version before attesting `VOICE_PRIVACY_VERIFIED=true`.

## Lifecycle and browser limits

Mount `NativeVoicePanel` persistently beside the Game menu. Mounting it inside conditional menu children disconnects conversation when the menu closes. Its `connected` prop must reflect `room.connection.isOpen`; renderer pause labels and scene transport flags do not reflect socket admission while hidden.

Hidden tabs retain wanted conversation. Stale policy and a dropped game socket fail closed; reconnection never silently requests a new microphone. Pending permission, token, and media connection work is invalidated on OFF, room switch, or leave. Late captured streams are stopped. Remote tracks are detached on unsubscribe/disconnect and replaced by identity to avoid duplicate audio after restore. Hardware loss, denied permission, missing devices, occupied devices, and blocked autoplay have visible retry/resume controls. Mobile operating systems can suspend WebRTC when locked; physical mobile/Safari and real microphone/speaker tests remain necessary. Do not change browser or OS security settings to pass a test.

## Configuration and local checks

Server-only settings are `VOICE_ENABLED=true`, `VOICE_PRIVACY_VERIFIED=true`, `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET`. Production requires WSS. Unencrypted WS is accepted only for nonproduction loopback. Never put keys/secrets in browser environment variables or return them from status endpoints. Missing configuration leaves voice off and does not affect gameplay.

The voice owner's isolated preview is http://localhost:3012 with game backend 2579 and loopback-only LiveKit 7880/7882. It uses a separate temporary database and public LiveKit development credentials. It is for same-machine testing and does not provide a LAN or public service. Shared previews 3010/2577 and 3011/2578 are separate. Enter a room, open **Microphone off · Voice**, choose Listen only or Enable microphone, and grant permission only if you want to test real capture. Use two separate browser profiles/windows for two distinct admitted users. OFF releases capture. Closing the controls or hiding the tab should preserve a wanted conversation.

Run unit/regression tests with Node 24: `pnpm test`. Run `pnpm typecheck` and `pnpm build`. The reusable adversarial provider probe uses synthetic oscillator audio and no physical microphone:

```sh
pnpm exec tsx scripts/verify-voice-provider.ts
pnpm exec tsx scripts/verify-voice-controller.ts
# If needed, supply an installed Chromium executable via VOICE_TEST_BROWSER.
```

It intentionally targets only a locally running LiveKit dev server at `ws://127.0.0.1:7880`, hosts its fixture on loopback 7970, and creates/deletes one disposable room. It verifies default deny, allowed decoded audio, ACL revocation, and malicious resubscription denial. The controller probe additionally checks proximity, interiors, race transitions, rejoin and stale-publisher removal using the actual client controller and backend service. The probes do not attest a Cloud endpoint. Do not run it against production by substituting real credentials.

## Production setup decision

No cloud account, credentials, persistent grant, subscription, or production media deployment was created. Activation requires an approved endpoint and server credentials, adversarial verification against that endpoint, and a real device/browser smoke test coordinated with the sole release owner.

Options, checked against official information on October 1, 2026:

- **LiveKit Cloud Build:** $0/month; 5,000 WebRTC participant-minutes and 50 GB downstream, with 100 concurrent participants. Eight people for an hour consume 480 participant-minutes, roughly ten full-party hours in the monthly allowance. The free tier has a hard allowance cap rather than automatic paid overages, shared across free projects. Creating an account still requires terms/credential approval. See [pricing](https://livekit.com/pricing), [quotas and limits](https://docs.livekit.io/deploy/admin/quotas-and-limits/), and [terms](https://livekit.com/legal/terms-of-service).
- **LiveKit Cloud Ship:** starts at $50/month, includes 150,000 participant-minutes and 250 GB downstream; listed overages are $0.0005/minute and $0.12/GB. Requires explicit cost approval. See [pricing](https://livekit.com/pricing).
- **Self-host on approved infrastructure:** no new LiveKit subscription, but requires an available host, secure domain/TLS, UDP connectivity, TURN where necessary, monitoring, and hosting/bandwidth costs. Existing infrastructure capacity and cost must be established before activation. See [deployment documentation](https://docs.livekit.io/transport/self-hosting/deployment/) and [local server instructions](https://docs.livekit.io/transport/self-hosting/local/).

The browser-only app host and game WebSocket backend do not themselves provide a media SFU. No new dependency or paid provider is needed to ship the disabled configuration and UI; production activation is a separate setup decision.
