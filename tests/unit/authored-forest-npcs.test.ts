import { describe, it, expect } from 'vitest';
import { getWorld } from '@third-space/config';
import { distance, isHomeWalkable } from '@third-space/simulation';
import { expandAuthoredForest } from '../../packages/config/src/authored-forest';
import { createAuthoredForestNPCs } from '../../apps/game-server/src/authored-forest-npcs';
import { NPC_RULES } from '../../apps/game-server/src/ForestNPCController';
const world = getWorld('forest');
describe('authored NPC population', () => {
  it('keeps the complete authored cast active with a fixed path budget while eight humans could be far apart', () => {
    const expanded = { ...world, map: expandAuthoredForest(world.map) };
    const c = createAuthoredForestNPCs(expanded, () => .4);
    expect(c.snapshot()).toHaveLength(25);
    expect(new Set(c.snapshot().map(n => n.id)).size).toBe(25);
    const before = new Map(c.snapshot().map(n => [n.id, n]));
    for (let now = 100; now <= 8000; now += 100) {
      c.update(now);
      expect(c.diagnostics().lastPathSearches).toBeLessThanOrEqual(1);
      expect(c.diagnostics().pathPoints).toBeLessThanOrEqual(25 * NPC_RULES.maxPathPoints);
      for (const npc of c.snapshot()) expect(isHomeWalkable(npc, expanded.map)).toBe(true);
    }
    const moving = c.snapshot().filter(n => distance(n, before.get(n.id)!) > .1);
    expect(moving.some(n => n.id === 'npc:watch-garrick')).toBe(true);
    expect(moving.some(n => n.id === 'npc:guard-iona')).toBe(true);
    expect(c.get('npc:wizard-orin-vale')?.questHook).toBe('forest-ward-seals');
    expect(c.prey().find(n => n.id === 'npc:ogre-brindle')?.npcArt).toBe('ogre');
    expect(c.snapshot().every(n => !('relationships' in n) && !('nativeMode' in n))).toBe(true);
  });

  it('changes patrol intentions at night and rests diurnal wildlife without stopping the simulation', () => {
    const expanded = { ...world, map: expandAuthoredForest(world.map) };
    const c = createAuthoredForestNPCs(expanded, () => .4);
    for (let now = 100; now <= 3000; now += 100) c.update(now, { phase: 'day' });
    expect(c.get('npc:animal:hollow-owl')?.activity).toBe('resting');
    for (let now = 3100; now <= 8000; now += 100) c.update(now, { phase: 'night' });
    expect(c.get('npc:animal:orchard-rabbit')?.activity).toBe('resting');
    expect(c.get('npc:animal:hollow-owl')?.activity).not.toBe('resting');
    expect(c.get('npc:guard-iona')?.activity).toBe('patrolling');
  });

});
