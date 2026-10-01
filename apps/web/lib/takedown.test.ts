import { describe, expect, it } from 'vitest';
import { CatchPresentation, takedownCreature, takedownWindow, TAKEDOWN_DURATION_MS } from './takedown';
describe('authoritative local takedown presentation',()=>{
 it('has no vignette without a server catch',()=>expect(takedownWindow(undefined,100)).toBeNull());
 it('accepts only authoritative known creature labels',()=>{expect(takedownCreature('clown')).toBe('clown');expect(takedownCreature('werewolf')).toBe('werewolf');expect(takedownCreature('unknown')).toBeUndefined();});
 it('joins partway through the finite vignette instead of restarting it',()=>expect(takedownWindow(1000,1700)).toEqual({elapsed:700,remaining:1100}));
 it('does not replay a stale catch on reconnect or new snapshot',()=>{expect(takedownWindow(1000,2800)).toBeNull();expect(takedownWindow(1000,9000)).toBeNull();});
 it('clamps clock skew without extending the 1800ms presentation',()=>{expect(takedownWindow(1000,900)).toEqual({elapsed:0,remaining:TAKEDOWN_DURATION_MS});expect(takedownWindow(NaN,100)).toBeNull();});
});

describe('catch closeup replay gate',()=>{
 it('shows only one fresh lunge while allowing the finite animation to finish after remount',()=>{
  const guard=new CatchPresentation();
  expect(guard.begin('room:rev:self:1000',1000,1100)?.jumpScare).toBe(true);
  expect(guard.begin('room:rev:self:1000',1000,1100)?.jumpScare).toBe(false);
  expect(guard.begin('room:rev:self:1000',1000,1700)).toEqual({elapsed:700,remaining:1100,jumpScare:false});
  expect(guard.begin('room:rev:self:1000',1000,3000)).toBeNull();
  expect(guard.begin('room:rev:self:4000',4000,4100)?.jumpScare).toBe(true);
 });
 it('does not start a delayed/reconnected closeup',()=>expect(new CatchPresentation().begin('old',1000,1500)?.jumpScare).toBe(false));
});
