import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Furniture, Rect, WorldMap } from '@third-space/config';
import { getWorld } from '@third-space/config';
import { FOREST_VIEW, forestCameraZoom } from '../../packages/config/src/forest-view';
import { FOREST_STREAMING, forestChunkKeys, forestVisibleChunkKeys } from '../../apps/web/lib/forest-streaming';
import { ForestMapPresentation } from '../../apps/web/lib/forest-map-presentation';
import { paintAuthoredForestFloorTile } from '../../apps/web/lib/authored-forest-art';
import { PartyRoom } from '../../apps/game-server/src/PartyRoom';
import { LocalStore } from '../../packages/data/src/index';
import type { ForestNPCController } from '../../apps/game-server/src/ForestNPCController';
import type { ForestCombatEncounters } from '../../apps/game-server/src/ForestCombatEncounters';
import type { RoomSnapshot } from '../../packages/contracts/src/index';

vi.mock('phaser', () => ({}));
const TILE = 32, SIZE = FOREST_STREAMING.chunkTiles, MAP = getWorld('forest').map;
interface Paint { color: string; x: number; y: number; width: number; height: number }
let recordPaint = false;
class Canvas {
  width = 0; height = 0;
  paints: Paint[] = [];
  context = new Proxy({ fillStyle: '', fillRect: (x: number, y: number, width: number, height: number) => {
    if (recordPaint) this.paints.push({ color: String(this.context.fillStyle), x, y, width, height });
  } }, { get: (target, property) => property in target ? Reflect.get(target, property) : () => {} });
  getContext() { return this.context; }
}
class Image {
  destroyed = false; destroyCount = 0; depth = -1; interactive = false;
  handlers = new Map<string, (...args: unknown[]) => void>();
  constructor(public x: number, public y: number, public texture: string) {}
  setOrigin() { return this; }
  setDepth(depth: number) { this.depth = depth; return this; }
  setInteractive() { this.interactive = true; return this; }
  on(event: string, handler: (...args: unknown[]) => void) { this.handlers.set(event, handler); return this; }
  destroy() { this.destroyed = true; this.destroyCount++; }
}
function rig(width = 1440, height = 900, map = MAP) {
  const zoom = forestCameraZoom(width, height, TILE);
  const view = { x: 0, y: 0, width: width / zoom / TILE, height: height / zoom / TILE };
  const textures = new Map<string, Canvas>(), images: Image[] = [], removed: string[] = [];
  const scene = {
    cameras: { main: { width, height, zoom, getWorldPoint: () => ({ x: view.x * TILE, y: view.y * TILE }) } },
    textures: {
      exists: (key: string) => textures.has(key),
      addCanvas: (key: string, canvas: Canvas) => { if (textures.has(key)) throw new Error(`Duplicate texture ${key}`); textures.set(key, canvas); },
      remove: (key: string) => {
        // Eviction must never invalidate a still-displayed chunk or prop.
        expect(images.some(i => !i.destroyed && i.texture === key), `live image uses removed ${key}`).toBe(false);
        removed.push(key); textures.delete(key);
      },
    },
    add: { image: (x: number, y: number, key: string) => { const image = new Image(x, y, key); images.push(image); return image; } },
  };
  const use = vi.fn();
  const renderer = new ForestMapPresentation(scene as never, map, TILE, use);
  const live = () => images.filter(i => !i.destroyed);
  const floorKeys = () => new Set(live().filter(i => i.texture.startsWith('forest-chunk:')).map(i => `${i.x / (SIZE * TILE)}:${i.y / (SIZE * TILE)}`));
  const move = (x: number, y: number) => { view.x = x; view.y = y; };
  const settle = () => { for (let i = 0; i < 6; i++) renderer.update(new Set()); };
  return { renderer, view, move, settle, floorKeys, live, images, textures, removed, use, scene };
}
/** Independent positive-area rectangle/chunk oracle; it does not use streaming helpers. */
function intersecting(view: Rect, width = MAP.width, height = MAP.height) {
  const keys = [];
  for (let y = 0; y < Math.ceil(height / SIZE); y++) for (let x = 0; x < Math.ceil(width / SIZE); x++) {
    const right = Math.min(width, (x + 1) * SIZE), bottom = Math.min(height, (y + 1) * SIZE);
    if (x * SIZE < view.x + view.width && right > view.x && y * SIZE < view.y + view.height && bottom > view.y) keys.push(`${x}:${y}`);
  }
  return keys;
}
function expectCoverage(r: ReturnType<typeof rig>) {
  const loaded = r.floorKeys();
  for (const key of intersecting(r.view)) expect(loaded.has(key), `visible floor missing ${key} at ${JSON.stringify(r.view)}`).toBe(true);
}
function prop(id: string, footprint: Rect, usePoints: { x: number; y: number }[] = []): Furniture {
  return { id, kind: 'tree', footprint, collider: { x: footprint.x + 1, y: footprint.y + 1, width: .5, height: .5 }, usePoints, seats: [] };
}

beforeEach(() => { recordPaint = false; vi.stubGlobal('document', { createElement: (kind: string) => { if (kind !== 'canvas') throw new Error(`Unexpected DOM element ${kind}`); return new Canvas(); } }); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('seamless forest viewport selection', () => {
  it.each([[1440, 900], [390, 844], [844, 390], [2560, 1080], [320, 480]])('bounds the %i×%i viewport and all preload sets below the cache capacity', (width, height) => {
    const zoom = forestCameraZoom(width, height, TILE), view = { x: 0, y: 0, width: width / zoom / TILE, height: height / zoom / TILE };
    expect(view.width).toBeLessThanOrEqual(FOREST_VIEW.width + 1e-9); expect(view.height).toBeLessThanOrEqual(FOREST_VIEW.height + 1e-9);
    for (let y = 0; y <= MAP.height - view.height; y += 1.7) for (let x = 0; x <= MAP.width - view.width; x += 1.9) {
      const at = { ...view, x, y }, padded = forestChunkKeys(at, MAP.width, MAP.height), visible = forestVisibleChunkKeys(at, MAP.width, MAP.height);
      expect(new Set(padded).size).toBe(padded.length);
      expect(padded.length).toBeLessThanOrEqual(20);
      expect(padded.length).toBeLessThanOrEqual(FOREST_STREAMING.cachedChunks);
      for (const key of intersecting(at)) expect(visible).toContain(key);
      for (const key of visible) expect(padded).toContain(key);
    }
  });
  it('covers map edges and exact chunk boundaries without negative or out-of-map keys', () => {
    for (const view of [{ x: -2, y: -2, width: 12, height: 12 }, { x: 12, y: 12, width: 12, height: 12 }, { x: 130, y: 102, width: 20, height: 20 }]) {
      const keys = forestChunkKeys(view, MAP.width, MAP.height);
      for (const key of keys) { const [x, y] = key.split(':').map(Number); expect(x).toBeGreaterThanOrEqual(0); expect(y).toBeGreaterThanOrEqual(0); expect(x).toBeLessThan(Math.ceil(MAP.width / SIZE)); expect(y).toBeLessThan(Math.ceil(MAP.height / SIZE)); }
      expect(new Set(keys).size).toBe(keys.length);
      for (const key of intersecting(view)) expect(keys).toContain(key);
    }
    for (const view of [{ x: NaN, y: 0, width: 10, height: 10 }, { x: 0, y: Infinity, width: 10, height: 10 }, { x: 0, y: 0, width: 0, height: 10 }, { x: 0, y: 0, width: 10, height: -1 }, { x: -100, y: -100, width: 1, height: 1 }, { x: 1000, y: 1000, width: 1, height: 1 }]) {
      expect(forestChunkKeys(view, MAP.width, MAP.height)).toEqual([]);
      expect(forestVisibleChunkKeys(view, MAP.width, MAP.height)).toEqual([]);
    }
  });
});

describe('forest renderer resource lifetime and coverage', () => {
  it.each([[1440, 900], [390, 844], [844, 390]])('fills every visible floor on a cold %i×%i arrival, budgeting only offscreen preloads', (width, height) => {
    const r = rig(width, height); r.move(49.8, 40.1); r.renderer.update(new Set());
    expectCoverage(r);
    const visible = new Set(forestVisibleChunkKeys(r.view, MAP.width, MAP.height));
    expect([...r.floorKeys()].filter(key => !visible.has(key)).length).toBeLessThanOrEqual(4);
    r.renderer.destroy();
  });
  it.each([[1440, 900], [390, 844]])('crosses horizontal and diagonal chunk boundaries without holes or cache growth at %i×%i', (width, height) => {
    const r = rig(width, height); r.settle();
    const targets = [{ x: MAP.width - r.view.width, y: 0 }, { x: 0, y: MAP.height - r.view.height }, { x: MAP.width - r.view.width, y: MAP.height - r.view.height }, { x: 0, y: 0 }];
    for (const target of targets) {
      while (Math.hypot(r.view.x - target.x, r.view.y - target.y) > .01) {
        const d = Math.hypot(target.x - r.view.x, target.y - r.view.y), step = Math.min(.2, d);
        r.move(r.view.x + (target.x - r.view.x) / d * step, r.view.y + (target.y - r.view.y) / d * step);
        r.renderer.update(new Set()); expectCoverage(r);
        expect(r.renderer.diagnostics().cachedChunks).toBeLessThanOrEqual(28);
        expect(r.renderer.diagnostics().floorImages).toBeLessThanOrEqual(20);
      }
    }
    expect(r.removed.some(key => key.startsWith('forest-chunk:'))).toBe(true);
    expect(r.renderer.diagnostics().propTextures).toBeLessThanOrEqual(64);
    r.renderer.destroy();
    expect(r.textures.size).toBe(0); expect(r.live()).toHaveLength(0);
    expect(r.images.every(i => i.destroyCount === 1)).toBe(true);
    r.renderer.destroy(); expect(r.images.every(i => i.destroyCount === 1)).toBe(true);
  });
  it('destroys cold-view images before evicting textures, and covers a far interior-exit destination immediately', () => {
    const r = rig(); r.settle();
    for (const at of [{ x: 90, y: 75 }, { x: 4, y: 70 }, { x: 95, y: 5 }, { x: 0, y: 0 }]) { r.move(at.x, at.y); r.renderer.update(new Set()); expectCoverage(r); expect(r.renderer.diagnostics().cachedChunks).toBeLessThanOrEqual(28); }
    expect(r.images.some(i => i.destroyed)).toBe(true); expect(r.removed.length).toBeGreaterThan(0);
    r.renderer.destroy();
  });
  it('indexes a prop by its complete footprint, deduplicates overlapping cells and culls the image without changing collision authority', () => {
    const spanning = prop('spanning-tree', { x: 11, y: 10, width: 3, height: 4 }, [{ x: 12, y: 14 }]);
    const distant = prop('distant-tree', { x: 110, y: 92, width: 3, height: 4 });
    const map = { ...MAP, furniture: [spanning, distant], solids: [spanning.collider!, distant.collider!] };
    const original = JSON.stringify(map); Object.freeze(map.furniture); Object.freeze(map.solids);
    const r = rig(320, 320, map); r.move(17, 10); r.renderer.update(new Set());
    const props = r.live().filter(i => i.texture.startsWith('forest-prop:') || i.texture.startsWith('forest-prop-v3:'));
    expect(props).toHaveLength(1); expect(props[0]!.x).toBe(11 * TILE);
    const event = { stopPropagation: vi.fn() }; props[0]!.handlers.get('pointerdown')!(null, 0, 0, event);
    expect(event.stopPropagation).toHaveBeenCalledOnce(); expect(r.use).toHaveBeenCalledExactlyOnceWith(spanning);
    r.move(100, 85); r.renderer.update(new Set()); expect(props[0]!.destroyed).toBe(true);
    expect(JSON.stringify(map)).toBe(original); r.renderer.destroy();
  });
  it('hands apple trees to their dedicated renderer without deleting shared world geometry or unrelated trees', () => {
    const apple = prop('apple-original', { x: 11, y: 10, width: 3, height: 4 }), ordinary = prop('ordinary', { x: 16, y: 10, width: 3, height: 4 });
    const map = { ...MAP, furniture: [apple, ordinary] }, r = rig(640, 480, map); r.move(4, 4); r.renderer.update(new Set());
    expect(r.renderer.diagnostics().propImages).toBe(2); r.renderer.update(new Set([apple.id])); expect(r.renderer.diagnostics().propImages).toBe(1);
    expect(map.furniture).toEqual([apple, ordinary]); r.renderer.update(new Set()); expect(r.renderer.diagnostics().propImages).toBe(2); r.renderer.destroy();
  });
  it('paints both sides of a chunk seam using the same global tile coordinates as a monolithic floor', () => {
    recordPaint = true;
    const r = rig(640, 480); r.move(50, 45); r.settle();
    for (const [x, y] of [[59, 53], [60, 53], [65, 59], [65, 60]]) {
      const canvas = r.textures.get(`forest-chunk:${MAP.id}:${Math.floor(x! / SIZE)}:${Math.floor(y! / SIZE)}`)!;
      expect(canvas).toBeDefined();
      const px = x! % SIZE * TILE, py = y! % SIZE * TILE;
      const start = canvas.paints.findIndex(p => p.x === px && p.y === py && p.width === TILE && p.height === TILE);
      expect(start).toBeGreaterThanOrEqual(0);
      const rest = canvas.paints.slice(start + 1), next = rest.findIndex(p => p.width === TILE && p.height === TILE);
      const actual = [canvas.paints[start]!, ...rest.slice(0, next < 0 ? undefined : next)].map(p => ({ ...p, x: p.x - px, y: p.y - py }));
      const reference = new Canvas(); paintAuthoredForestFloorTile(reference.context as never, x!, y!, TILE, 0, 0);
      expect(actual).toEqual(reference.paints);
    }
    r.renderer.destroy();
  });
});

it('keeps complete NPC/mob authority when recipient interest differs across eight far-apart humans', () => {
  vi.useFakeTimers(); vi.setSystemTime(2_000_000);
  const store = new LocalStore({ path: ':memory:' }); let room: PartyRoom | undefined;
  try {
    const ids = Array.from({ length: 8 }, (_, i) => store.createIdentity({ name: `Spread ${i}` }).profile.id);
    const homeId = store.createHome(ids[0]!, { name: 'Streaming authority', pin: '123456' }).id;
    store.db.prepare('UPDATE homes SET capacity=8 WHERE id=?').run(homeId); ids.slice(1).forEach(id => store.joinHome(homeId, id, { pin: '123456' }));
    PartyRoom.store = store; room = new PartyRoom(); room.worldId = 'forest';
    vi.spyOn(room, 'setMatchmaking').mockResolvedValue(); vi.spyOn(room, 'onMessage').mockImplementation(() => {});
    vi.spyOn(room, 'setTimestep').mockImplementation(() => {}); vi.spyOn(room.clock, 'setInterval').mockReturnValue({} as never);
    room.onCreate({ homeId });
    type Client = Parameters<PartyRoom['onJoin']>[0];
    const clients = ids.map((id, i) => { const client = { sessionId: `spread-${i}`, send: vi.fn(), leave: vi.fn() } as unknown as Client; client.auth = room!.onAuth(client, { homeId, ticket: store.issueTicket(homeId, id).ticket }); room!.onJoin(client, {}); return client; });
    const positions = [{ x: 24, y: 24 }, { x: 97, y: 38 }, { x: 124, y: 24 }, { x: 46, y: 84 }, { x: 108, y: 71 }, { x: 124, y: 94 }, { x: 72, y: 95 }, { x: 38, y: 102 }];
    ids.forEach((id, i) => Object.assign(room!.players.get(id)!, positions[i]!, { seatId: undefined }));
    const authority = room as unknown as { npcs: ForestNPCController; combat: ForestCombatEncounters; sendSnapshots(): void };
    authority.combat.syncStory(['keeper-copperbutton-raiders', 'keeper-mossbutton-raiders'], []);
    const fullNPCs = authority.npcs.snapshot(), fullMobs = authority.combat.snapshot();
    expect(fullNPCs).toHaveLength(32); expect(fullMobs.mobs).toHaveLength(4);
    authority.sendSnapshots();
    const snapshots = clients.map(client => vi.mocked(client.send).mock.calls.filter(call => call[0] === 'snapshot').at(-1)![1] as RoomSnapshot);
    expect(new Set(snapshots.map(s => s.npcs!.length)).size).toBeGreaterThan(1);
    expect(snapshots[0]!.mobs?.mobs).toHaveLength(0); expect(snapshots[6]!.mobs?.mobs.length).toBeGreaterThan(0);
    for (const snapshot of snapshots) { expect(snapshot.members).toHaveLength(8); expect(snapshot.players).toHaveLength(8); }
    expect(authority.npcs.snapshot()).toEqual(fullNPCs); expect(authority.combat.snapshot()).toEqual(fullMobs);
    const distant = fullNPCs.find(n => !snapshots[0]!.npcs!.some(visible => visible.id === n.id))!;
    expect(distant).toBeDefined(); authority.npcs.damage(distant.id, 40, Date.now()); authority.sendSnapshots();
    const nearIndex = snapshots.findIndex(s => s.npcs!.some(n => n.id === distant.id)); expect(nearIndex).toBeGreaterThanOrEqual(0);
    const updated = vi.mocked(clients[nearIndex]!.send).mock.calls.filter(c => c[0] === 'snapshot').at(-1)![1] as RoomSnapshot;
    expect(updated.npcs!.find(n => n.id === distant.id)?.health).toBe(distant.maxHealth - 40);
    expect(authority.npcs.snapshot()).toHaveLength(32); expect(room.players.size).toBe(8);
  } finally { room?.onDispose(); room?.clock.clear(); store.close(); vi.useRealTimers(); }
});
