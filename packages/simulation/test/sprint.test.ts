import { describe, expect, it } from "vitest";
import { createPlayer, stepHome, stepSprint, cancelSprint, sprintStatus, SPRINT } from "../src/index";
const start = () => ({...createPlayer("a", "A"), x:10,y:10});
function run(p = start(), ms = 1000, held = true, now = 1000) {
 for(let t=0;t<ms;t+=50) p=stepSprint(p,held,true,now+t,.05).player;
 return p;
}
describe("continuous hold stamina", () => {
 it("drains exactly a three-second reserve and preserves partial release/reuse",()=>{
  let p=run(); expect(p.stamina).toBeCloseTo(2/3);
  p=run(p,300,false,2000); expect(p.stamina).toBeCloseTo(2/3);
  p=run(p,1000,true,2300); expect(p.stamina).toBeCloseTo(1/3);
 });
 it("exhaustion slows walking briefly, requires release and is never sticky",()=>{
  let p=run(start(),3000);expect(p.stamina).toBe(0);expect(sprintStatus(p,4000).phase).toBe("exhausted");
  expect(stepSprint(p,true,true,4000,.05).multiplier).toBe(.75);
  p=run(p,11000,true,4000);expect(p.stamina).toBe(1);expect(p.sprinting).toBe(false);
  p=run(p,50,false,15000);expect(stepSprint(p,true,true,15050,.05).multiplier).toBe(1.6);
 });
 it("rest starts after release and refills in ten seconds without tap exploits",()=>{
  let p=run(start(),1500);p=run(p,500,false,2500);expect(p.stamina).toBeCloseTo(.5);
  p=run(p,5000,false,3000);expect(p.stamina).toBeCloseTo(1);
  let taps=start();for(let i=0;i<60;i++) {taps=run(taps,50,true,1000+i*100);taps=run(taps,50,false,1050+i*100);}
  expect(taps.stamina).toBe(0);
 });
 it("does not drain stationary, seated, disconnected, race or dead players",()=>{
  for(const patch of [{connected:false},{mode:"race" as const},{seatId:"s"},{respawnAt:9999}]) {
   const p={...start(),stamina:.5,...patch};expect(stepSprint(p,true,true,1000,.05).player.stamina).toBeGreaterThanOrEqual(.5);
  }
  expect(stepSprint(start(),true,false,1000,.05).player.stamina).toBe(1);
 });
 it("bounds stalls, uses precise depletion boundary and preserves reconnect reserve",()=>{
  const p={...start(),stamina:.01};const step=stepSprint(p,true,true,1000,.05);
  expect(step.multiplier).toBeCloseTo((30*1.6+20*.75)/50);
  expect(stepSprint(start(),true,true,1000,100).player.stamina).toBeCloseTo(1-.25/3);
  const spent=run();cancelSprint(spent,2000);expect(spent.stamina).toBeCloseTo(2/3);
  const off=stepSprint({...spent,connected:false},false,false,999999,.25).player;expect(off.stamina).toBe(spent.stamina);
 });
 it("keeps diagonal normalization, swept collision and independent client resources",()=>{
  const map={width:100,height:100,solids:[{x:11,y:0,width:.05,height:100}]};
  const p=stepHome(start(),{seq:1,axisX:1,axisY:1,jump:false,sprint:true},.25,map,1000);
  expect(p.x).toBeLessThanOrEqual(11-.3);expect(p.stamina).toBeCloseTo(1-.25/3);
  expect(start().stamina).toBeUndefined();expect(SPRINT.durationMs).toBe(3000);
 });
});
