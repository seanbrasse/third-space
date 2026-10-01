# Movement and stamina

Tap Space in the home/campsite to receive a 1.6× movement boost for 1.5
seconds. The stamina bar drains during the boost, then refills over five seconds.
A second boost requires a full bar. This interprets “refill every five seconds”
as five seconds after the boost ends: a complete cycle lasts 6.5 seconds.
Standing still still spends the boost. Race Space remains jump.

The room owns the boost timestamps, recharge gate and speed. Input packets
provide intent and a monotonic press counter, never velocity, position, duration
or elapsed time. Each new press is consumed even when recharge is incomplete,
so holding Space through recharge cannot start another boost. The press counter
also distinguishes a rapid release/repress between two network packets.
Client prediction uses the same movement rules, timestamps and bounded
collision integration, then reconciles accepted snapshots.

Seated players, roasting players, disconnected players, race participants and
players awaiting respawn cannot start a boost. World/area changes, death and
transport drops cancel an active boost and start its five-second refill. The
spent charge and consumed press counter survive reconnect and world changes.
Ordinary focus/modal changes stop movement while the existing boost clock runs.

Physical WASD and arrow keys move after ordinary nontext button clicks. Typing
fields, inherited contenteditable, native dialogs, accessibility composite
widgets, embedded frames and explicitly excluded controls own their keys.
Space and Enter on buttons retain native activation. Enter opens chat only from
the game context. F toggles the flashlight, once per press; browser repeat,
modifier shortcuts, typing fields and modal controls do not trigger it.
Window blur, hidden tabs, blocked input and instance changes
clear held movement keys; browser auto-repeat cannot rearm them.

The map occupies its own header space. Narrow screens wrap complete words and
keep the map card within the viewport. The stamina bar sits below the game,
before people/chat on mobile, with an accessible progress value and phase text.
