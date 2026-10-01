import { describe, expect, it } from "vitest";
import { createPlayer } from "@third-space/simulation";
import { holdTouchSprint, releaseTouchSprint } from "./touch-boost";
describe("mobile hold sprint",()=>{
 it("holds until release/cancel and preserves directional controls",()=>{const touch={axisX:1,sprint:false};expect(holdTouchSprint(touch,createPlayer("a","A"),1000)).toBe(true);expect(touch.sprint).toBe(true);releaseTouchSprint(touch);expect(touch.sprint).toBe(false);expect(touch.axisX).toBe(1);});
 it("cannot arm missing, disconnected, seated or exhausted state",()=>{for(const p of [undefined,{...createPlayer("a","A"),connected:false},{...createPlayer("a","A"),seatId:"s"},{...createPlayer("a","A"),stamina:0}])expect(holdTouchSprint({},p,1000)).toBe(false);});
});
