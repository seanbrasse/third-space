import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalStore } from '../../packages/data/src/index';
import { SharedForestStoryStore } from '../../packages/data/src/forest-story-store';
import { LivingWorldStore } from '../../packages/data/src/living-world-store';
import { LivingWorldRoom } from '../../apps/game-server/src/living-world-room';
import { SurvivalInventory } from '../../apps/game-server/src/survival-inventory';
import type { ForestNPCController } from '../../apps/game-server/src/ForestNPCController';
import { createPlayer, isHomeSegmentWalkable, isHomeWalkable } from '../../packages/simulation/src/index';
import { getWorld } from '../../packages/config/src/index';
import type { ClientCommand, PlayerState } from '../../packages/contracts/src/index';
import type { ForestNPC } from '../../packages/contracts/src/forest-npc';
import type { LivingWorldReceipt, LivingWorldSnapshot, NPCActionOffer, PotionKind } from '../../packages/contracts/src/living-world';

const opened: LocalStore[] = [];
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_000_000); });
afterEach(() => { opened.splice(0).forEach(store => store.close()); vi.restoreAllMocks(); vi.useRealTimers(); });

function fixture() {
  const db = new LocalStore({ path: ':memory:' }); opened.push(db);
  const host = db.createIdentity({ name: 'Road host' }).profile.id, guest = db.createIdentity({ name: 'Quiet neighbour' }).profile.id;
  const home = db.createHome(host, { name: 'Road room', pin: '123456' }).id; db.joinHome(home, guest, { pin: '123456' });
  const point = { x: 46, y: 85 }; expect(isHomeWalkable(point, getWorld('forest').map)).toBe(true);
  const players = new Map<string, PlayerState>([host, guest].map(id => [id, { ...createPlayer(id, id), ...point }]));
  const resident = (id: string): ForestNPC => ({ ...createPlayer(id, id), ...point, art: 'villager', role: 'Neighbour', phase: 'wander', activity: 'working', moving: false, health: 100, maxHealth: 100, lifeRevision: 0 });
  const residents = new Map(['wizard-orin-vale', 'innkeeper-nessa', 'orchard-worker-mara', 'keeper-ada'].map(name => [`npc:${name}`, resident(`npc:${name}`)]));
  const npcApi = {
    get: vi.fn((id: string) => residents.get(id)), snapshot: vi.fn(() => [...residents.values()].map(npc => ({ ...npc }))),
    damage: vi.fn((id: string, amount: number) => { const npc = residents.get(id)!; npc.health = Math.max(0, npc.health - amount); return npc.health ? 'hurt' : 'caught'; }),
    update: vi.fn(), steer: vi.fn(), diagnostics: vi.fn(() => ({ lastPathSearches: 0 })),
  };
  const store = new LivingWorldStore(db.db, { canAccess: (h, u) => db.canAccess(h, u), now: () => Date.now() });
  const story = new SharedForestStoryStore(db.db, { canAccess: (h, u) => db.canAccess(h, u), now: () => Date.now(), chooseCulprit: () => 'goblin-nib' });
  const send = vi.fn<(id: string, type: string, payload: unknown) => void>(), notice = vi.fn();
  const revisions = new Map<string, number>();
  const talk = vi.fn((id: string, npcId: string, commandId: string) => { story.apply(home, { eventId: `room:${id}:${commandId}`, actorId: id, kind: 'talk', npcId: npcId.slice(4), occurredAt: Date.now() }); });
  const fresh = vi.fn((player: PlayerState, command: { worldRevision: number; lifeRevision: number; zoneRevision: number }) => player.connected && player.mode === 'home' && !player.respawnAt && command.worldRevision === 7 && command.lifeRevision === (player.respawnCount ?? 0) && command.zoneRevision === (player.zoneRevision ?? 0));
  const survival = () => {
    const inventory = new SurvivalInventory({ random: () => 0, spawnPoints: [{ ...point }, { x: point.x + 4, y: point.y }], trees: [], safe: () => false, walkable: () => true, lineOfSight: () => true });
    for (const id of players.keys()) inventory.ensure(id);
    return inventory;
  };
  let inventory = survival();
  const createRoom = () => new LivingWorldRoom({ homeId: home, epoch: 'test-epoch', store, survival: inventory, players: () => players, npcs: () => npcApi as unknown as ForestNPCController, keeper: () => residents.get('npc:keeper-ada'), fresh, canAccess: id => db.canAccess(home, id), story: id => story.read(home, id), talk, refreshStory: vi.fn(), send, notice, inventoryRevision: (id, revision) => revisions.set(id, revision), knockout: vi.fn() });
  let room = createRoom(); room.push(host); room.push(guest); send.mockClear();
  let serial = 0;
  const command = (payload: Record<string, unknown>, id = host): ClientCommand => ({ commandId: `room-command-${++serial}`, worldRevision: 7, lifeRevision: players.get(id)?.respawnCount ?? 0, zoneRevision: players.get(id)?.zoneRevision ?? 0, ...payload }) as ClientCommand;
  const execute = (payload: Record<string, unknown>, id = host) => { const c = command(payload, id); room.command(id, c); return c; };
  const read = (id = host) => store.read(home, id);
  const apples = () => {
    let s = story.read(home, host);
    while (s.personal.inventory.apples < 5) s = story.changeApples(home, host, { before: s.personal.inventory.apples, after: s.personal.inventory.apples + 1, cause: 'harvest', expectedRevision: s.personal.inventory.revision }).snapshot;
    room.push(host); send.mockClear();
  };
  const offers = (npcId = 'wizard-orin-vale') => store.offers(home, host, npcId);
  const action = (offer: NPCActionOffer, extra: Record<string, unknown> = {}) => command({ type: 'npc.action', npcId: `npc:${offer.npcId}`, targetLifeRevision: residents.get(`npc:${offer.npcId}`)!.lifeRevision ?? 0, expectedInventoryRevision: read().personal.inventory.revision, actionId: offer.actionId, ...extra });
  const buy = (kind: PotionKind) => {
    const offer = offers(kind === 'strength' ? 'wizard-orin-vale' : 'innkeeper-nessa').find(o => o.kind === 'trade' && o.potion === kind)!;
    const c = action(offer); room.command(host, c); return c;
  };
  const receipts = (id = host) => send.mock.calls.filter(call => call[0] === id && call[1] === 'living.receipt').map(call => call[2] as LivingWorldReceipt);
  const restart = () => { inventory = survival(); room = createRoom(); room.push(host); room.push(guest); };
  return { db, home, host, guest, players, residents, npcApi, store, story, send, notice, revisions, talk, fresh, command, execute, read, apples, offers, action, buy, receipts, restart, get room() { return room; }, get inventory() { return inventory; } };
}

describe('living-world room boundary with actual SQLite authority', () => {
  it('rejects range, player life/world/zone and target-life changes before spending anything', () => {
    const f = fixture(); f.apples();
    const offer = f.offers().find(o => o.kind === 'trade')!, player = f.players.get(f.host)!, original = { x: player.x, y: player.y };
    const before = f.read().personal.inventory;
    for (const patch of [{ worldRevision: 8 }, { lifeRevision: 1 }, { zoneRevision: 1 }, { targetLifeRevision: 1 }]) f.room.command(f.host, f.action(offer, patch));
    player.x += 20; f.room.command(f.host, f.action(offer)); Object.assign(player, original);
    player.zone = 'asylum'; f.room.command(f.host, f.action(offer)); delete player.zone;
    player.respawnAt = Date.now() + 1000; f.room.command(f.host, f.action(offer)); delete player.respawnAt;
    player.connected = false; f.room.command(f.host, f.action(offer)); player.connected = true;
    f.residents.get('npc:wizard-orin-vale')!.phase = 'respawning'; f.room.command(f.host, f.action(offer));
    expect(f.read().personal.inventory).toEqual(before); expect(f.receipts()).toEqual([]);
    expect(f.notice.mock.calls.length).toBeGreaterThanOrEqual(9);
  });

  it('rejects a short interaction segment crossing a real forest collider', () => {
    const f = fixture(), map = getWorld('forest').map;
    const obstacle = map.solids.find(rect => rect.width < 1 && rect.height < 1)!;
    expect(obstacle).toBeDefined();
    const left = { x: obstacle.x - .35, y: obstacle.y + obstacle.height / 2 }, right = { x: obstacle.x + obstacle.width + .35, y: left.y };
    expect(Math.hypot(left.x - right.x, left.y - right.y)).toBeLessThan(2.5);
    expect(isHomeSegmentWalkable(left, right, map)).toBe(false);
    Object.assign(f.players.get(f.host)!, left); Object.assign(f.residents.get('npc:wizard-orin-vale')!, right);
    f.execute({ type: 'npc.interact', npcId: 'npc:wizard-orin-vale' });
    expect(f.talk).not.toHaveBeenCalled(); expect(f.send.mock.calls.some(c => c[1] === 'npc.conversation')).toBe(false);
  });

  it('binds owned offers to the requested nearby NPC and prevents another member using them', () => {
    const f = fixture(); f.apples(); const offer = f.offers().find(o => o.kind === 'trade')!;
    const before = f.read().personal.inventory;
    f.room.command(f.host, f.action(offer, { npcId: 'npc:innkeeper-nessa' }));
    f.room.command(f.guest, f.action(offer));
    expect(f.read().personal.inventory).toEqual(before); expect(f.read(f.guest).personal.inventory.potions.strength).toBe(0);
    f.room.command(f.host, f.action(offer)); expect(f.read().personal.inventory.potions.strength).toBe(1);
  });

  it('replays the original trade receipt both immediately and after rebuilding the room', () => {
    const f = fixture(); f.apples(); const c = f.buy('strength');
    const first = f.receipts().at(-1)!; expect(first.status).toBe('updated');
    const inventory = f.read().personal.inventory;
    f.send.mockClear(); f.room.command(f.host, c);
    expect(f.receipts()).toEqual([first]); expect(f.read().personal.inventory).toEqual(inventory);
    f.restart(); f.send.mockClear(); f.room.command(f.host, c);
    expect(f.receipts()).toEqual([first]); expect(f.read().personal.inventory).toEqual(inventory);
    expect(f.revisions.get(f.host)).toBe(inventory.revision);
  });

  it('requires equipped potions for a new use, and replays an emptied potion after reconnect without refreshing it', () => {
    const f = fixture(); f.apples(); f.buy('strength');
    const use = () => f.command({ type: 'living.use', potion: 'strength', expectedInventoryRevision: f.read().personal.inventory.revision });
    f.room.command(f.host, use()); expect(f.read().personal.inventory.potions.strength).toBe(1);
    expect(f.inventory.equip(f.host, 'strength-potion').ok).toBe(true);
    const c = use(); f.room.command(f.host, c);
    const first = f.receipts().at(-1)!, effect = f.read().personal.effects[0]!;
    expect(first.status).toBe('updated'); expect(f.inventory.ensure(f.host).equipped).toBeNull();
    expect(f.room.damage(f.players.get(f.host)!, Date.now())).toBe(52.5);
    vi.setSystemTime(Date.now() + 10_000); f.restart(); f.send.mockClear();
    f.room.command(f.host, c);
    expect(f.receipts()).toEqual([first]); expect(f.read().personal.effects).toEqual([effect]);
    expect(f.read().personal.inventory.potions.strength).toBe(0);
    vi.setSystemTime(effect.expiresAt); f.room.push(f.host);
    expect(f.players.get(f.host)!.potionEffects).toEqual([]); expect(f.room.damage(f.players.get(f.host)!, Date.now())).toBe(30);
  });

  it('sends conversations and personal fear only to their recipient, with current committed story and no private mystery', () => {
    const f = fixture();
    f.store.witnessAttack(f.home, f.host, { commandId: 'seen-hit', targetNpcId: 'wizard-orin-vale', witnessNpcIds: [] });
    f.execute({ type: 'npc.interact', npcId: 'npc:wizard-orin-vale' });
    const conversations = f.send.mock.calls.filter(call => call[1] === 'npc.conversation');
    expect(conversations).toHaveLength(1); expect(conversations[0]![0]).toBe(f.host);
    expect(f.story.read(f.home, f.host).story.chapter).toBe('wards');
    const personal = (f.send.mock.calls.filter(call => call[0] === f.host && call[1] === 'living.snapshot').at(-1)![2]) as LivingWorldSnapshot;
    expect(personal.personal.trust).toBe(-18);
    const guest = f.room.push(f.guest); expect(guest.personal.trust).toBe(0); expect(guest.personal.relationships).toEqual([]);
    expect(JSON.stringify(f.send.mock.calls)).not.toMatch(/culpritId|confirmedFace|private_json|testimony.*goblin-nib/);
    const view = (conversations[0]![2] as { view: { relationship: { afraid: boolean }; offers: NPCActionOffer[] }; targetNpcLifeRevision: number });
    expect(view.view.relationship.afraid).toBe(true); expect(view.targetNpcLifeRevision).toBe(0);
    expect(view.view.offers.find(offer => offer.kind === 'talk')?.disabledReason).toBeUndefined();
  });

  it('discovers the shared road from an actual referral conversation without starting combat', () => {
    const f = fixture(); expect(f.read().rescue.discovered).toBe(false);
    f.execute({ type: 'npc.interact', npcId: 'npc:innkeeper-nessa' });
    expect(f.read().rescue.discovered).toBe(true); expect(f.read(f.guest).rescue.discovered).toBe(true);
    expect(f.room.controller.snapshot().rescue.phase).toBe('dormant');
    expect(f.read().personal.rewards).toEqual([]);
  });

  it('keeps resting Mara safe from a player knife and marks the attack offer unavailable', () => {
    const f = fixture();
    f.store.advanceRescue(f.home, f.host, { commandId: 'protected', event: 'protected' });
    f.store.advanceRescue(f.home, f.host, { commandId: 'arrived', event: 'escort-arrived' }); f.room.push(f.host);
    f.inventory.tick(Date.now(), [...f.players.values()]);
    const bag = f.inventory.snapshot().backpacks[0]!; Object.assign(f.players.get(f.host)!, { x: bag.x, y: bag.y });
    expect(f.inventory.pickup(f.players.get(f.host)!, bag.id, Date.now()).ok).toBe(true);
    expect(f.inventory.equip(f.host, 'knife').ok).toBe(true);
    const trust = f.read().personal.trust;
    f.execute({ type: 'npc.attack', npcId: 'npc:orchard-worker-mara', targetLifeRevision: 0 });
    expect(f.npcApi.damage).not.toHaveBeenCalled(); expect(f.read().personal.trust).toBe(trust);
    f.execute({ type: 'npc.interact', npcId: 'npc:orchard-worker-mara' });
    const conversation = f.send.mock.calls.filter(call => call[1] === 'npc.conversation').at(-1)![2] as { view: { offers: NPCActionOffer[] } };
    expect(conversation.view.offers.find(offer => offer.kind === 'attack')?.disabledReason).toBeTruthy();
  });

  it('does not start protection for a disabled offer or when durable storage fails', () => {
    const f = fixture();
    const protect = vi.spyOn(f.room.controller, 'protect').mockReturnValue({ ok: true });
    f.store.advanceRescue(f.home, f.host, { commandId: 'setback', event: 'setback' });
    const disabled = f.offers('orchard-worker-mara').find(offer => offer.kind === 'protect')!;
    expect(disabled.disabledReason).toBeTruthy(); f.room.command(f.host, f.action(disabled));
    expect(protect).not.toHaveBeenCalled();
    vi.setSystemTime(Date.now() + 10_000);
    const available = f.offers('orchard-worker-mara').find(offer => offer.kind === 'protect')!;
    expect(available.disabledReason).toBeUndefined();
    const persist = vi.spyOn(f.store, 'act').mockImplementation(() => { throw new Error('SQLite unavailable'); });
    f.room.command(f.host, f.action(available));
    expect(protect).not.toHaveBeenCalled(); expect(f.notice).toHaveBeenCalled(); persist.mockRestore();
  });

  it('does not duplicate physical protection on durable command replay', () => {
    const f = fixture(), protect = vi.spyOn(f.room.controller, 'protect').mockReturnValue({ ok: true });
    const offer = f.offers('orchard-worker-mara').find(value => value.kind === 'protect')!, c = f.action(offer);
    f.room.command(f.host, c); expect(protect).toHaveBeenCalledTimes(1);
    const first = f.receipts().at(-1)!;
    f.send.mockClear(); f.room.command(f.host, c);
    expect(protect).toHaveBeenCalledTimes(1); expect(f.receipts()).toEqual([first]);
  });

  it('acknowledges a verified rescue outcome only after durable success and keeps resting Mara protected', () => {
    const f = fixture();
    const event = { eventId: 'runtime-protected', event: 'protected' as const, incidentId: 'lantern-road-v1', attemptId: 'test-attempt', actorId: f.host, participantIds: [f.host], npcId: 'npc:orchard-worker-mara', occurredAt: Date.now() };
    vi.spyOn(f.room.controller, 'update').mockReturnValue({ damage: [], steering: [], events: [event] });
    const pending = vi.spyOn(f.room.controller, 'pendingEvents').mockReturnValue([event]);
    const acknowledge = vi.spyOn(f.room.controller, 'acknowledgeEvent');
    const persist = vi.spyOn(f.store, 'advanceRescue').mockImplementationOnce(() => { throw new Error('write failure'); });
    f.room.tick(Date.now(), 'day'); expect(acknowledge).not.toHaveBeenCalled();
    vi.setSystemTime(Date.now() + 500); f.room.tick(Date.now(), 'day');
    expect(acknowledge).toHaveBeenCalledWith(event.eventId); expect(f.read().rescue.stage).toBe('escorting');
    expect(f.read().personal.trust).toBe(10); expect(f.read(f.guest).personal.trust).toBe(0);
    expect(persist).toHaveBeenCalledWith(f.home, f.host, expect.objectContaining({ participantIds: [f.host] }));
    pending.mockReturnValue([]);
    f.store.advanceRescue(f.home, f.host, { commandId: 'arrived', event: 'escort-arrived' }); f.room.push(f.host);
    expect(f.room.protectedNpc('npc:orchard-worker-mara')).toBe(true);
    vi.setSystemTime(Date.now() + 60_000); f.room.tick(Date.now(), 'day');
    expect(f.read().rescue.stage).toBe('complete'); expect(f.room.protectedNpc('npc:orchard-worker-mara')).toBe(true);
    expect(f.read(f.guest).personal.rewards[0]?.status).toBe('pending');
  });

  it('keeps queued physical outcomes in order across a storage outage', () => {
    const f = fixture();
    const protectedEvent = { eventId: 'ordered-protected', event: 'protected' as const, incidentId: 'lantern-road-v1', attemptId: 'ordered-attempt', actorId: f.host, participantIds: [f.host], npcId: 'npc:orchard-worker-mara', occurredAt: Date.now() };
    const arrivedEvent = { ...protectedEvent, eventId: 'ordered-arrived', event: 'escort-arrived' as const };
    vi.spyOn(f.room.controller, 'update').mockReturnValue({ damage: [], steering: [], events: [] });
    vi.spyOn(f.room.controller, 'pendingEvents').mockReturnValue([protectedEvent, arrivedEvent]);
    const acknowledge = vi.spyOn(f.room.controller, 'acknowledgeEvent');
    const persist = vi.spyOn(f.store, 'advanceRescue').mockImplementationOnce(() => { throw new Error('write failure'); });
    f.room.tick(Date.now(), 'day');
    expect(persist).toHaveBeenCalledTimes(1); expect(acknowledge).not.toHaveBeenCalled();
    vi.setSystemTime(Date.now() + 500); f.room.tick(Date.now(), 'day');
    expect(persist.mock.calls.map(call => call[2].event)).toEqual(['protected', 'protected', 'escort-arrived']);
    expect(acknowledge.mock.calls.map(call => call[0])).toEqual(['ordered-protected', 'ordered-arrived']);
    expect(f.read().rescue.stage).toBe('recovering');
  });

  it('persists a declined rescue setback without treating its witness as a helper', () => {
    const f = fixture(), before = f.read().personal.trust;
    const event = { eventId: 'declined-setback', event: 'setback' as const, incidentId: 'lantern-road-v1', attemptId: 'declined-attempt', actorId: f.host, participantIds: [], npcId: 'npc:orchard-worker-mara', occurredAt: Date.now() };
    vi.spyOn(f.room.controller, 'update').mockReturnValue({ damage: [], steering: [], events: [] });
    vi.spyOn(f.room.controller, 'pendingEvents').mockReturnValue([event]);
    const persist = vi.spyOn(f.store, 'advanceRescue');
    f.room.tick(Date.now(), 'day');
    expect(persist).toHaveBeenCalledWith(f.home, f.host, expect.objectContaining({ participantIds: [] }));
    expect(f.read().rescue.setbacks).toBe(1); expect(f.read().personal.trust).toBe(before);
  });

  it('recovers authoritative pockets when a private delivery throws after a successful purchase', () => {
    const f = fixture(); f.apples();
    f.send.mockImplementation(() => { throw new Error('socket closed'); });
    expect(() => f.buy('speed')).not.toThrow(); expect(f.read().personal.inventory.potions.speed).toBe(1);
    f.send.mockReset(); f.restart();
    expect(f.inventory.ensure(f.host).potions).toEqual({ strength: 0, speed: 1 });
    expect(f.send.mock.calls.filter(call => call[0] === f.host && call[1] === 'living.snapshot')).toHaveLength(1);
  });

  it('records witnessed player harm once, retries a failed write, and delivers only the attacker’s changed reputation', () => {
    const f = fixture(), victimBefore = f.read(f.guest).personal;
    const persist = vi.spyOn(f.store, 'witnessPlayerAttack').mockImplementationOnce(() => { throw new Error('temporary storage failure'); });
    f.room.recordPlayerHit(f.host, f.guest, 'verified-player-hit', Date.now());
    expect(f.read().personal.trust).toBe(0); expect(persist).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 500); f.room.tick(Date.now(), 'day');
    expect(persist).toHaveBeenCalledTimes(2); expect(f.read().personal.trust).toBe(-30);
    expect(f.read(f.guest).personal).toEqual(victimBefore);
    expect(f.send.mock.calls.filter(call => call[1] === 'living.snapshot').every(call => call[0] === f.host)).toBe(true);
    f.room.recordPlayerHit(f.host, f.guest, 'verified-player-hit', Date.now());
    expect(f.read().personal.trust).toBe(-30);
    expect(f.read().personal.relationships.every(memory => memory.trust === -10)).toBe(true);
  });

  it('leaves an unwitnessed player hit out of the reputation ledger', () => {
    const f = fixture(); f.npcApi.snapshot.mockReturnValue([]);
    const persist = vi.spyOn(f.store, 'witnessPlayerAttack'), before = f.read().personal;
    f.room.recordPlayerHit(f.host, f.guest, 'unwitnessed-player-hit', Date.now());
    expect(persist).not.toHaveBeenCalled(); expect(f.read().personal).toEqual(before);
    expect(f.send).not.toHaveBeenCalled();
  });
});
