# The keeper world milestone

Midnight Pines is one 144 × 112 outdoor map. The original camp, race cabin, asylum approach, light rules and watching spaces keep their coordinates. Roads lead to Bramblewick, Crownwatch, Orin's tower, the Reed House, the Button camps, Ada's house and Hollow Bough. These are places in one world, not separate outdoor rooms. Eight buildings use natural door transitions into safe interiors; a keyboard/touch Walk to exit control follows the same path and server-validated doorway as clicking the exit.

Twenty-five room-owned residents and wildlife wander on shared schedules. They do not consume the eight human slots or appear as accounts in chat, voice or inventory. Ada becomes a twenty-sixth actor for the rescue and returns to camp after completion. Dialogue, health, monster hunts and respawn remain authoritative. Creature encounters only become hunts when a human chooses to explore outside protection; passive company around the fire does not acquire hunger debt or mandatory quests.

The first shared story has three sequential chapters: recover stolen seals and disperse two raider bands; compare two physical clues and three witnesses to identify a mimic's borrowed face; then free Ada from the rootbound guardian. Two optional reconciliation stories can run in any order. The main story and recap belong to the home and persist while friends are absent. Each member's apples, badges and reward claims are personal, with SQLite transactions preventing duplicate rewards. New members inherit the story but cannot manufacture retroactive consumable entitlements. More authored hooks are conversation flavour, not additional implemented quests.

The town noticeboard and World journal show only discovered leads, evidence, people and recaps. Wrong accusations preserve evidence and never punish a real resident. The chosen borrowed face stays on the server until the story exposes it. Combat begins with the player's first knife strike; hostile mobs attack contributors, telegraph a fixed dodgeable point, and reset if abandoned. Human PvP keeps its reversible host setting and existing protected areas. The initial setting remains enabled outside protection.

A shared 32-minute day and six-minute weather windows add gradual light, rain, mist and breeze. Climate is cosmetic: daylight does not negate the cursed woods, weather does not remove fire safety, and reduced motion uses still effects. There is no lightning or strobe.

## Rendering and authority

The client paints invisible 12-tile floor chunks in global coordinates, preloads four tiles beyond the viewport and retains at most 28 floor textures at supported camera sizes. Cold arrival fills all visible chunks immediately. Offscreen props are culled; labels avoid collisions while retaining sprites, health bars and attack telegraphs. Interior transitions snap remote avatars rather than interpolating through the old outdoor map.

The server continues all NPCs and encounters for every player regardless of client rendering. Recipient filtering removes only distant visible-world details from that client's snapshot; all human roster/minimap positions remain complete. An opt-in versioned delta transport preserves the exact complete snapshot contract and the legacy full-snapshot path. It has independent recipient baselines, periodic full refreshes, strict sequence/epoch validation and rate-limited resync. Story updates travel reliably when changed rather than in every 20 Hz world snapshot.

See `expanded-room-performance.md` for reproducible eight-spread-player MessagePack/CPU measurements. A separate real HTTP/Colyseus test verifies seven delta clients plus one legacy client, movement, chat, shared dialogue/story, interior transitions and recovery after a deliberately dropped delta. Its isolated child server observed 191–207 MiB RSS in short local runs; this is not a production capacity guarantee. Browser timing and deployment memory must be assessed separately.

## Validation boundaries

Authority tests exercise all main chapters, both sideplots, eight concurrent members, offline catch-up, late join, persistent apples, failed transactions, access revocation, forged/stale commands and delivery failure after durable commit. Stream tests compare exact reconstructed snapshots and prove that client culling does not stop distant NPC/mob authority. Actual Phaser screenshots cover the map, all eight interiors, mobs, dialogue, weather, mobile layout and reduced motion. Local app journal opening and Escape focus restoration are checked separately from controlled scene fixtures.

Physical iPhone/Safari multi-touch, real speaker balance and a complete physical-device quest playthrough remain unverified. Native voice is a separate integration and remains unavailable until its provider-specific admission/privacy gates are satisfied. Releases are performed by the sole deployment owner against an exact reviewed commit.
