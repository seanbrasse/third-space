# Exploring the forest

The campsite stays a social hub. Health starts at 100, hunger at 75, and the flashlight is selected in the hotbar. Hunger drains only while a connected player is moving outside the nine-tile fire sanctuary. Resting, sitting, interiors, races, respawn protection, and disconnected time pause it. At zero hunger, continued exploration drains health; a knockout returns the player to the fire with five seconds of protection. Food and knife knockouts use a calm finite return scene, without creature art or a catch sting.

Sixteen existing trees provide apples. Click their apples from nearby clear ground to harvest; a tree regrows after 45 seconds. Carry up to five apples and select/eat one in the hotbar to restore 25 hunger. Full pockets and full hunger do not consume supplies. The flashlight toggle and battery authority keep their existing behavior when another item is selected.

At most two hidden world backpacks are active. Each contains one unique knife. Claims remove the world backpack before assigning ownership, and only one player can win a contested pickup. A replacement can appear after 30 seconds. A player carries at most one knife; respawn or permanent departure returns it to an eligible world location, keeping the active-backpack cap. Transport grace keeps the existing inventory.

Select a knife, then click a nearby player or use Swing knife. Hits require server-validated range (1.4 tiles), clear collision line of sight, and an 800 ms cooldown; each hit deals 30 health. The fire sanctuary, all interiors, seats, races, disconnected players, and respawn protection prevent attacks. A short blade/arc and hurt outline communicate shared hits without gore or flashing. Reduced motion keeps the blade still.

Knife combat defaults on outside protected areas. The current host can disable it in Home controls. This room policy is reversible. NPCs are not eligible human PvP targets. The room authenticates every command and fences it with world/life/area revisions; replayed commands cannot mutate inventory again within the deduplication window.

Inventory is room-local in this milestone. Quest persistence and durable reward transactions are a separate integration; the temporary controller reward helper is not a durable ledger.

Validation: 417 tests across 65 files pass, including seven actual-room authority cases and eight real HTTP/Colyseus clients racing to claim one backpack, sharing damage, and observing one protected respawn. Workspace TypeScript and production build pass. The real local app renders the HUD and world in a connected room without browser errors. At 390 CSS pixels, the compact HUD is 103 pixels tall, its four buttons are at least 44 pixels high, and the document does not overflow horizontally. Physical iPhone multi-touch and real speaker playback remain unverified.

## Five-slot viewport inventory

The hotbar is anchored to the bottom center of the Phaser viewport in both normal and game fullscreen layouts. It has five total slots. Slot 1 begins with the flashlight; four slots begin empty. Click/tap or press 1–5 to select. Empty slots put the held item away. Number keys preserve chat, text fields, menus, dialogs and media-control focus. Selection returns focus to the game after a button click.

Slots are authoritative and retain acquisition order. First-time pickups fill the first empty slot; apples stack to five in one slot. Depleting a stack empties that slot without shifting other items. Rejected/full pickups preserve the world object. Respawn restores the flashlight in slot 1. A new `survival.select` command has the same world/life/zone fences and replay prevention as existing inventory actions.

Fruit trees now replace selected evergreens at their original footprint and collision anchor. Ready and regrowing sprites share one canopy, branch structure and ground interaction point. Apples are smaller, shaded and partly covered by leaves.
