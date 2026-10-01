import { describe,it,expect } from 'vitest';
import { getWorld } from '@third-space/config';
import { createPlayer,distance,isHomeWalkable,isHomeSegmentWalkable } from '@third-space/simulation';
import { ForestNPCController,NPC_RULES,DEFAULT_FOREST_NPCS } from '../../apps/game-server/src/ForestNPCController';
const world=getWorld('forest');
function controller(){let seed=42;return new ForestNPCController(world,()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;});}
describe('authoritative forest NPCs',()=>{
 it('has exactly three distinct original actors outside sanctuary and no human identity',()=>{const c=controller(),s=c.snapshot();expect(s).toHaveLength(3);expect(new Set(s.map(n=>n.id)).size).toBe(3);for(const n of s){expect(n.id.startsWith('npc:')).toBe(true);expect(isHomeWalkable(n,world.map)).toBe(true);expect(distance(n,world.fire!)).toBeGreaterThan(world.stalker!.safeRadius);}});
 it('wanders deterministically without crossing solids or map bounds over 120 seconds',()=>{const a=controller(),b=controller();let before=a.snapshot(),moved=0;for(let now=100;now<=120000;now+=100){a.update(now);b.update(now);const after=a.snapshot();expect(after).toEqual(b.snapshot());after.forEach((n,i)=>{expect(isHomeWalkable(n,world.map)).toBe(true);expect(isHomeSegmentWalkable(before[i]!,n,world.map)).toBe(true);expect(distance(before[i]!,n)).toBeLessThanOrEqual(.105001);moved+=distance(before[i]!,n);});before=after;}expect(moved).toBeGreaterThan(5);});
 it('caps movement after stalled simulation and backward clocks',()=>{const c=controller();c.update(100);const p=c.snapshot();c.update(1000000);c.snapshot().forEach((n,i)=>expect(distance(n,p[i]!)).toBeLessThanOrEqual(.105001));const q=c.snapshot();c.update(900000);expect(c.snapshot()).toEqual(q);});
 it('shares bounded dialogue only with nearby living outdoor humans and dedups cooldown',()=>{const c=controller(),n=c.snapshot()[0]!,p={...createPlayer('human','Sean'),x:n.x,y:n.y};expect(c.interact(n.id,p,1000)).toBe(true);const first=c.snapshot()[0]!;expect(first.phase).toBe('talking');expect(first.dialogue?.text.length).toBeGreaterThan(5);expect(c.interact(n.id,p,1001)).toBe(false);expect(c.interact(n.id,{...p,zone:'asylum'},8000)).toBe(false);expect(c.interact(n.id,{...p,connected:false},8000)).toBe(false);expect(c.interact(n.id,{...p,x:24,y:24},8000)).toBe(false);c.update(7000);expect(c.snapshot()[0]!.dialogue).toBeUndefined();expect(c.interact(n.id,p,7500)).toBe(true);expect(c.snapshot()[0]!.dialogue?.id).not.toBe(first.dialogue?.id);});
 it('catch is idempotent, removes prey, and respawns once at a walkable home',()=>{const c=controller(),n=c.snapshot()[1]!;expect(c.catch(n.id,1000)).toBe(true);expect(c.catch(n.id,1100)).toBe(false);expect(c.catch('human',1200)).toBe(false);expect(c.prey()).toHaveLength(2);c.update(30999);expect(c.snapshot()[1]!.phase).toBe('respawning');c.update(31000);expect(c.snapshot()[1]!.phase).toBe('wander');expect(c.prey()).toHaveLength(3);expect(c.snapshot()[1]!.x).toBe(n.x);});
 it('snapshots and prey cannot mutate authority across joins/reconnect',()=>{const c=controller(),s=c.snapshot();s[0]!.x=0;s[0]!.avatar.hair='none';const p=c.prey();p[0]!.x=0;p[0]!.avatar.hair='none';expect(c.snapshot()[0]!.x).not.toBe(0);expect(c.snapshot()[0]!.avatar.hair).toBe('curly');expect(p[0]!.mode).toBe('home');expect(p[0]!.flashlightOn).toBe(false);expect(NPC_RULES.count).toBe(3);});
});

import { ForestEncounter } from '../../apps/game-server/src/ForestStalker';
const encounterWorld={...world,map:{...world.map,solids:[],furniture:[{id:'test-cover',kind:'tree' as const,footprint:{x:34,y:12,width:2,height:3},collider:null,usePoints:[],seats:[]}]}};
it('can hunt NPC prey while a human explores, with a shared catch identity',()=>{const e=new ForestEncounter(encounterWorld,()=>.5),npc={...createPlayer('npc:forest:0','Moss'),x:35,y:18},human={...createPlayer('human','Sean'),x:70,y:45};e.reset(1000);e.update(31000,[npc,human],[human]);expect(e.state?.targetId).toBe(npc.id);e.update(34000,[npc,human],[human]);npc.x=e.state!.x;npc.y=e.state!.y;expect(e.update(34100,[npc,human],[human])).toBe(npc.id);});
it('NPCs outside sanctuary do not reset safe human perimeter cadence',()=>{const e=new ForestEncounter(encounterWorld,()=>.5),npc={...createPlayer('npc:forest:0','Moss'),x:35,y:18},human={...createPlayer('human','Sean'),x:24,y:24};e.reset(1000);e.update(31000,[npc,human],[human]);expect(e.state).toBeNull();e.update(61000,[npc,human],[human]);expect(e.state).toBeNull();});

import { forestNPCBubblePoint } from '../../apps/web/lib/forest-npc-layout';

describe('NPC health, schedules and bounded population', () => {
  it('shares partial health then atomically catches once and restores full health at respawn', () => {
    const c = controller(), n = c.snapshot()[0]!;
    expect(c.damage(n.id, 35, 100)).toBe('hurt');
    expect(c.get(n.id)?.health).toBe(65);
    expect(c.damage(n.id, NaN, 101)).toBe('ignored');
    expect(c.damage(n.id, -10, 102)).toBe('ignored');
    expect(c.damage(n.id, 65, 200)).toBe('caught');
    expect(c.get(n.id)?.health).toBe(0);
    expect(c.damage(n.id, 5, 300)).toBe('ignored');
    expect(c.get(n.id)?.respawnAt).toBe(30200);
    c.update(30199);
    expect(c.prey().some(p => p.id === n.id)).toBe(false);
    c.update(30200);
    expect(c.get(n.id)?.health).toBe(100);
    expect(c.get(n.id)?.respawnAt).toBeUndefined();
  });

  it('rejects human-shaped definition IDs and caps authoring input without allocating human presence', () => {
    const definition = DEFAULT_FOREST_NPCS[0]!;
    const defs = Array.from({ length: 50 }, (_, i) => ({ ...definition, id: `npc:bounded:${i}` }));
    const c = new ForestNPCController(world, () => .4, defs);
    expect(c.snapshot().length).toBeLessThanOrEqual(NPC_RULES.maxActors);
    expect(new ForestNPCController(world, () => .4, [{ ...definition, id: 'human' }]).snapshot()).toEqual([]);
    const n = c.snapshot()[0]!;
    expect(c.interact(n.id, { ...createPlayer('npc:impostor', 'No'), x: n.x, y: n.y }, 100)).toBe(false);
  });

  it.each([390, 844, 1440])('keeps a dialogue bubble inside a %ipx viewport at every edge', width => {
    for (const x of [-100, 0, width / 2, width, width + 100]) {
      for (const y of [-100, 0, 180, 360, 460]) {
        const p = forestNPCBubblePoint(x, y, 226, 94, width, 360);
        expect(p.x - 113).toBeGreaterThanOrEqual(8);
        expect(p.x + 113).toBeLessThanOrEqual(width - 8);
        expect(p.y - 94).toBeGreaterThanOrEqual(8);
        expect(p.y).toBeLessThanOrEqual(352);
      }
    }
  });
});
