import { describe, expect, it } from 'vitest';
import { DEFAULT_AVATAR } from '../../../packages/contracts/src';
import type { ForestNPC, ForestNPCArt } from '../../../packages/contracts/src/forest-npc';
import { isHomeWalkable } from '../../../packages/simulation/src';
import { nearestInteractableNPC, NPC_INTERACTION_RANGE, type NearbyNPCPlayer } from './nearby-npc';

const map = { width: 20, height: 20, solids: [] };
const player = (): NearbyNPCPlayer => ({ id: 'human:reader', x: 5, y: 5, connected: true, mode: 'home' });
const npc = (id: string, patch: Partial<ForestNPC> = {}): ForestNPC => ({
  id, name: id, role: 'Neighbour', art: 'villager', avatar: { ...DEFAULT_AVATAR },
  x: 6, y: 5, facing: 'left', phase: 'wander', activity: 'working', moving: false, health: 100, maxHealth: 100, ...patch,
});

describe('deterministic nearby E conversation target', () => {
  it('chooses distance first and stable ID for equal distances, regardless of snapshot order', () => {
    const a = npc('npc:a'), b = npc('npc:b', { x: 4 }), distant = npc('npc:0', { x: 7 });
    for (const list of [[a, b, distant], [distant, b, a], [b, a, distant], [b, distant, a]]) {
      expect(nearestInteractableNPC(player(), list, map)).toBe(a);
    }
    expect(nearestInteractableNPC(player(), [distant, b], map)).toBe(b);
  });

  it('includes exactly 2.5 tiles and excludes anything farther', () => {
    const atEdge = npc('npc:edge', { x: 5 + NPC_INTERACTION_RANGE });
    expect(nearestInteractableNPC(player(), [atEdge], map)).toBe(atEdge);
    expect(nearestInteractableNPC(player(), [{ ...atEdge, x: atEdge.x + 0.001 }], map)).toBeUndefined();
  });

  it('ignores the nearest actor across a wall, even when both endpoints are walkable', () => {
    const p = player(), hidden = npc('npc:a', { x: 6.2 }), visible = npc('npc:b', { x: 5, y: 7 });
    const walled = { ...map, solids: [{ x: 5.5, y: 4.5, width: 0.2, height: 1 }] };
    expect(isHomeWalkable(p, walled)).toBe(true);
    expect(isHomeWalkable(hidden, walled)).toBe(true);
    expect(nearestInteractableNPC(p, [hidden, visible], walled)).toBe(visible);
    expect(nearestInteractableNPC(p, [hidden], walled)).toBeUndefined();
  });

  it('ignores every wildlife art, wildlife role and animal ID while allowing spirits', () => {
    const spirit = npc('npc:spirit-lumen', { x: 7, art: 'spirit' });
    const animals = (['deer', 'fox', 'rabbit', 'owl', 'frog', 'duck'] satisfies ForestNPCArt[]).map(art => npc(`npc:${art}`, { art }));
    animals.push(npc('npc:animal:unfamiliar', { art: 'villager' }), npc('npc:unfamiliar-wildlife', { role: 'Wildlife' }));
    expect(nearestInteractableNPC(player(), [...animals, spirit], map)).toBe(spirit);
    expect(nearestInteractableNPC(player(), animals, map)).toBeUndefined();
  });

  it('requires a connected living human outside in home mode', () => {
    const neighbours = [npc('npc:friend')];
    const unavailable: (NearbyNPCPlayer | undefined | null)[] = [null, undefined,
      { ...player(), connected: false }, { ...player(), mode: 'race' },
      { ...player(), zone: 'interior:orin-tower' }, { ...player(), zone: 'asylum' },
      { ...player(), respawnAt: 10 }, { ...player(), health: 0 }, { ...player(), health: -1 },
      { ...player(), health: NaN }, { ...player(), x: Infinity }, { ...player(), y: NaN },
      { ...player(), id: 'npc:impostor' },
    ];
    for (const p of unavailable) expect(nearestInteractableNPC(p, neighbours, map)).toBeUndefined();
    expect(nearestInteractableNPC({ ...player(), health: 1 }, neighbours, map)).toBe(neighbours[0]);
  });

  it('ignores absent lives, invalid coordinates and unwalkable endpoints', () => {
    for (const patch of [{ phase: 'respawning' as const }, { health: 0 }, { health: NaN }, { respawnAt: 100 }, { x: NaN }, { y: Infinity }]) {
      expect(nearestInteractableNPC(player(), [npc('npc:unavailable', patch)], map)).toBeUndefined();
    }
    const blocked = { ...map, solids: [{ x: 5.8, y: 4.8, width: 0.4, height: 0.4 }] };
    expect(nearestInteractableNPC(player(), [npc('npc:blocked')], blocked)).toBeUndefined();
    expect(nearestInteractableNPC({ ...player(), x: -1 }, [npc('npc:outside', { x: 0 })], map)).toBeUndefined();
  });

  it('leaves readonly snapshots untouched and returns the existing actor reference', () => {
    const b = Object.freeze(npc('npc:b')), a = Object.freeze(npc('npc:a'));
    const list = Object.freeze([b, a]);
    expect(nearestInteractableNPC(player(), list, map)).toBe(a);
    expect(list).toEqual([b, a]);
    expect(nearestInteractableNPC(player(), [], map)).toBeUndefined();
  });
});
