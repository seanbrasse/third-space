# Movement and stamina

Hold Space while moving to sprint at 1.6× normal walking speed. A full reserve
buys three seconds of cumulative sprinting. Releasing immediately stops drain
and preserves the remaining reserve for another hold. Stationary input does not
drain. Mobile uses Hold to sprint with pointer capture and release/cancel cleanup.
Race Space remains jump.

After 500 ms without sprinting, stamina refills at one full bar per ten seconds.
Using the entire reserve causes two seconds of out-of-breath walking at 0.75×
normal speed. Release before sprinting again; holding through recharge cannot
automatically restart it. Repeated short taps spend the same reserve and cannot
bypass the rest delay or exhaustion. Seated players recover without sprinting.

Authority and prediction share the pure fixed-step resource integrator. Packets
carry held intent, never charge, speed, duration, or elapsed time. Old press and
timed-boost fields remain readable for compatibility but do not drive physics.
Simulation caps elapsed time at 250 ms, preserving collision subdivision and
preventing a stall or reconnect gap from spending/refilling a wall-clock debt.
Disconnect, race and respawn pause resource integration. Transport drops and
area changes release sprint without gifting a full charge or erasing exhaustion.

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
