import { describe, expect, it } from 'vitest';
import { takedownCreature, takedownWindow, TAKEDOWN_DURATION_MS } from './takedown';
describe('authoritative local takedown presentation',()=>{
 it('has no vignette without a server catch',()=>expect(takedownWindow(undefined,100)).toBeNull());
 it('accepts only authoritative known creature labels',()=>{expect(takedownCreature('clown')).toBe('clown');expect(takedownCreature('werewolf')).toBe('werewolf');expect(takedownCreature('unknown')).toBeUndefined();});
 it('joins partway through the finite vignette instead of restarting it',()=>expect(takedownWindow(1000,1700)).toEqual({elapsed:700,remaining:1100}));
 it('does not replay a stale catch on reconnect or new snapshot',()=>{expect(takedownWindow(1000,2800)).toBeNull();expect(takedownWindow(1000,9000)).toBeNull();});
 it('clamps clock skew without extending the 1800ms presentation',()=>{expect(takedownWindow(1000,900)).toEqual({elapsed:0,remaining:TAKEDOWN_DURATION_MS});expect(takedownWindow(NaN,100)).toBeNull();});
});
