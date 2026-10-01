import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPlayer } from '@third-space/simulation';
import type { ForestNPC } from '../../packages/contracts/src/forest-npc';
import type { ForestMob } from '../../packages/contracts/src/forest-mobs';
import { ScreenLabelLayout, type ScreenLabelCandidate, type ScreenLabelPriority } from '../../apps/web/lib/screen-label-layout';
import { ForestNPCPresentation } from '../../apps/web/lib/forest-npc-presentation';
import { ForestMobPresentation } from '../../apps/web/lib/forest-mob-presentation';

vi.mock('phaser', () => ({}));
vi.mock('../../apps/web/lib/forest-mob-art', () => ({ forestMobCanvas: () => ({}) }));
afterEach(() => { vi.unstubAllGlobals(); });

function candidate(id: string, priority: ScreenLabelPriority, distance = 1, x = 0): ScreenLabelCandidate {
  return { id, priority, distance, rect: { x, y: 0, width: 20, height: 20 }, setVisible: vi.fn() };
}

describe('shared screen label arbitration', () => {
  it('prioritizes dialogue, engaged enemies, idle challenges, then ambient names regardless of submission order or distance', () => {
    const priorities: ScreenLabelPriority[] = ['dialogue', 'engaged-mob', 'idle-mob', 'ambient-npc'];
    for (let first = 0; first < priorities.length; first++) {
      const layout = new ScreenLabelLayout();
      const labels = priorities.slice(first).map((priority, i) => candidate(priority, priority, 100 - i * 10)).reverse();
      for (const label of labels) layout.add(label);
      expect(layout.flush()).toEqual([priorities[first]]);
      for (const label of labels) expect(label.setVisible).toHaveBeenLastCalledWith(label.id === priorities[first]);
    }
  });

  it('uses nearest first and stable IDs for ties, independent of snapshot array order', () => {
    for (const reverse of [false, true]) {
      const layout = new ScreenLabelLayout();
      const labels = [candidate('far', 'dialogue', 10), candidate('near', 'dialogue', 1), candidate('b', 'engaged-mob', 1, 60), candidate('a', 'engaged-mob', 1, 60)];
      for (const label of reverse ? labels.reverse() : labels) layout.add(label);
      expect(layout.flush()).toEqual(['near', 'a']);
    }
  });

  it('keeps separate labels and does not let rejected labels reserve space', () => {
    const layout = new ScreenLabelLayout();
    layout.add(candidate('a', 'dialogue'));
    layout.add({ ...candidate('blocked', 'engaged-mob', 1, 15), rect: { x: 15, y: 0, width: 30, height: 20 } });
    layout.add(candidate('c', 'ambient-npc', 1, 40));
    expect(layout.flush()).toEqual(['a', 'c']);
  });

  it('keeps three CSS pixels between backgrounds and permits exactly that gap', () => {
    const layout = new ScreenLabelLayout();
    layout.add(candidate('a', 'dialogue'));
    layout.add(candidate('too-close', 'engaged-mob', 1, 22));
    layout.add(candidate('separate', 'ambient-npc', 1, 23));
    expect(layout.flush()).toEqual(['a', 'separate']);
  });

  it('hides invalid rectangles, copies bounds and releases callbacks after each flush', () => {
    const layout = new ScreenLabelLayout(), valid = candidate('valid', 'dialogue');
    layout.add(valid); valid.rect.x = 1000;
    const blocked = candidate('blocked', 'engaged-mob'); layout.add(blocked);
    for (const value of [NaN, Infinity, 0, -1]) {
      const invalid = candidate(`invalid-${value}`, 'dialogue'); invalid.rect.width = value;
      layout.add(invalid); expect(invalid.setVisible).toHaveBeenLastCalledWith(false);
    }
    expect(layout.flush()).toEqual(['valid']);
    expect(layout.flush()).toEqual([]);
    layout.add(blocked); expect(layout.flush()).toEqual(['blocked']);
    expect(valid.setVisible).toHaveBeenCalledTimes(2);
  });
});

class DisplayObject {
  visible = true; destroyed = false; x = 0; y = 0; scale = 1;
  setOrigin() { return this; } setScrollFactor() { return this; } setDepth() { return this; }
  setInteractive() { return this; } on() { return this; } setDisplaySize() { return this; }
  setTexture() { return this; } setAlpha() { return this; } setTint() { return this; } clearTint() { return this; }
  setPosition(x: number, y: number) { this.x = x; this.y = y; return this; }
  setVisible(value: boolean) { this.visible = value; return this; }
  setScale(value: number) { this.scale = value; return this; }
  destroy() { this.destroyed = true; }
}
class Text extends DisplayObject {
  text = ''; width = 0; height = 0; wrap = Infinity; maxLines = Infinity;
  style = { resolution: 1 }; frame = { source: { resolution: 1 } };
  constructor(private padding: { x: number; y: number }, private size: number) { super(); }
  setResolution(value: number) { this.style.resolution = value; return this; }
  setWordWrapWidth(width: number) { this.wrap = width; return this; }
  setMaxLines(lines: number) { this.maxLines = lines; return this; }
  setText(text: string) {
    this.text = text;
    const lengths = text.split('\n').map(line => line.length * this.size * .6);
    this.width = Math.min(this.wrap, Math.max(...lengths)) + this.padding.x * 2;
    this.height = Math.min(this.maxLines, lengths.reduce((count, length) => count + Math.max(1, Math.ceil(length / this.wrap)), 0)) * (this.size + 2) + this.padding.y * 2;
    return this;
  }
}
class Graphics extends DisplayObject {
  draws = 0; clear() { this.draws = 0; return this; } fillStyle() { return this; } lineStyle() { return this; }
  fillRect() { this.draws++; return this; } fillCircle() { this.draws++; return this; } strokeCircle() { this.draws++; return this; }
}
function rig(width = 390, height = 844, zoom = 1, dpr = 3) {
  vi.stubGlobal('window', { devicePixelRatio: dpr });
  const texts: Text[] = [], sprites: DisplayObject[] = [], graphics: Graphics[] = [], textures = new Set<string>();
  const camera = { width, height, zoom, getWorldPoint: () => ({ x: 0, y: 0 }) };
  const scene = {
    cameras: { main: camera },
    textures: { exists: (key: string) => textures.has(key), addCanvas: (key: string) => textures.add(key), remove: (key: string) => textures.delete(key) },
    add: {
      image: () => { const sprite = new DisplayObject(); sprites.push(sprite); return sprite; },
      text: (_x: number, _y: number, _text: string, style: { padding: { x: number; y: number }; fontSize: string }) => { const text = new Text(style.padding, parseInt(style.fontSize)); texts.push(text); return text; },
      graphics: () => { const graphic = new Graphics(); graphics.push(graphic); return graphic; },
    },
  };
  const npc = new ForestNPCPresentation(scene as never, vi.fn(), () => ({} as HTMLCanvasElement));
  const mob = new ForestMobPresentation(scene as never, vi.fn());
  return { npc, mob, texts, sprites, graphics, camera };
}
const local = { ...createPlayer('human', 'Sean'), x: 6, y: 8 };
function npc(id: string, overrides: Partial<ForestNPC> = {}): ForestNPC {
  return { id, name: id, role: 'wanderer', art: 'villager', avatar: local.avatar, x: 6, y: 8, facing: 'down', phase: 'wander', activity: 'wandering', moving: false, health: 80, maxHealth: 100, ...overrides };
}
function mob(id: string, overrides: Partial<ForestMob> = {}): ForestMob {
  return { id, encounterId: 'camp', name: id, kind: 'bramble-raider', x: 6, y: 8, facing: 'down', health: 40, maxHealth: 60, lifeRevision: 1, phase: 'idle', moving: false, ...overrides };
}
function currentRect(text: Text, camera: ReturnType<typeof rig>['camera']) {
  const x = camera.width / 2 + (text.x - camera.width / 2) * camera.zoom;
  const y = camera.height / 2 + (text.y - camera.height / 2) * camera.zoom;
  const width = text.width * text.scale * camera.zoom, height = text.height * text.scale * camera.zoom;
  return { x: x - width / 2, y: y - height, width, height };
}

describe('NPC and mob presenter shared label pass', () => {
  it('resolves mobile dialogue against neighboring names and challenges without hiding sprites, health or windup rings', () => {
    const r = rig(), layout = new ScreenLabelLayout();
    const residents = [npc('Moss', { dialogue: { id: 'talk', text: 'Ada followed the copper trail. Bring the ward seal home.', until: 2000 } }), npc('Wren', { y: 7 })];
    const enemies = [mob('Copper'), mob('Mossbutton', { phase: 'windup', windup: { x: 6, y: 8, radius: 1, until: 1800 } })];
    const original = JSON.stringify({ residents, enemies, local });
    r.npc.update(residents, local, 1000, 32, true, layout);
    r.mob.update({ mobs: enemies, encounters: [] }, local, 1000, 32, true, layout);
    expect(r.texts.every(text => !text.visible)).toBe(true);
    expect(layout.flush()).toEqual(['npc-dialogue:Moss']);
    expect(r.texts.filter(text => text.visible).map(text => text.text)).toEqual([residents[0]!.dialogue!.text]);
    expect(r.sprites.every(sprite => sprite.visible)).toBe(true);
    // Two injured NPC bars, two enemy health bars and one committed attack ring stay drawn.
    expect(r.graphics.filter(graphic => graphic.visible && graphic.draws > 0)).toHaveLength(5);
    expect(JSON.stringify({ residents, enemies, local })).toBe(original);
    r.npc.update(residents, local, 2001, 32, true, layout);
    r.mob.update({ mobs: enemies, encounters: [] }, local, 2001, 32, true, layout);
    expect(layout.flush()).toContain('mob-label:Mossbutton');
    expect(r.texts.find(text => text.text.startsWith('Copper'))?.visible).toBe(false);
    expect(r.texts.find(text => text.text === residents[0]!.dialogue!.text)?.visible).toBe(false);
    r.npc.destroy(); r.mob.destroy();
    expect([...r.texts, ...r.graphics, ...r.sprites].every(object => object.destroyed)).toBe(true);
  });

  it('keeps legacy caller visibility when no collector is supplied and clears labels when actors leave view', () => {
    const r = rig();
    r.npc.update([npc('Moss')], local, 1000, 32);
    r.mob.update({ mobs: [mob('Copper')], encounters: [] }, local, 1000, 32);
    expect(r.texts.filter(text => text.visible)).toHaveLength(2);
    const layout = new ScreenLabelLayout();
    r.npc.update([npc('Moss')], local, 1000, 32, false, layout);
    r.mob.update({ mobs: [mob('Copper')], encounters: [] }, local, 1000, 32, false, layout);
    expect(layout.flush()).toEqual(['mob-label:Copper']);
    r.npc.update([npc('Moss', { x: 100 })], local, 1000, 32, false, layout);
    r.mob.update({ mobs: [mob('Copper', { x: 100 })], encounters: [] }, local, 1000, 32, false, layout);
    expect(layout.flush()).toEqual([]);
    expect(r.texts.every(text => !text.visible)).toBe(true);
    expect(r.sprites.every(sprite => !sprite.visible)).toBe(true);
  });

  it.each([[390, 844, .65, 3], [390, 844, 1.7, 5], [1440, 900, 1.2, 1]])('uses final CSS pixel rectangles at %i×%i zoom %f and DPR %i', (width, height, zoom, dpr) => {
    const r = rig(width, height, zoom, dpr), layout = new ScreenLabelLayout(), add = vi.spyOn(layout, 'add');
    const nearEdge = { x: 0, y: 1 };
    r.npc.update([npc('Moss', { ...nearEdge, dialogue: { id: 'talk', text: 'Keep the lantern close. Ada left this path at dawn.', until: 2000 } })], { ...local, ...nearEdge }, 1000, 32, false, layout);
    r.mob.update({ mobs: [mob('Copper', nearEdge)], encounters: [] }, { ...local, ...nearEdge }, 1000, 32, false, layout);
    expect(add).toHaveBeenCalledTimes(2);
    for (const [candidate] of add.mock.calls) {
      const text = r.texts.find(text => candidate.id.startsWith('npc-dialogue') ? text.text.startsWith('Keep') : text.text.startsWith('Copper'))!;
      const actual = currentRect(text, r.camera);
      for (const key of ['x', 'y', 'width', 'height'] as const) expect(candidate.rect[key]).toBeCloseTo(actual[key], 8);
      expect(candidate.rect.x).toBeGreaterThanOrEqual(8 - 1e-8);
      expect(candidate.rect.y).toBeGreaterThanOrEqual(8 - 1e-8);
      expect(candidate.rect.x + candidate.rect.width).toBeLessThanOrEqual(width - 8 + 1e-8);
      expect(candidate.rect.y + candidate.rect.height).toBeLessThanOrEqual(height - 8 + 1e-8);
      expect(text.style.resolution).toBe(Math.min(3, dpr));
      expect(text.frame.source.resolution).toBe(Math.min(3, dpr));
      expect(text.scale * zoom).toBeCloseTo(1);
    }
    expect(layout.flush()).toEqual(['npc-dialogue:Moss']);
  });
});
