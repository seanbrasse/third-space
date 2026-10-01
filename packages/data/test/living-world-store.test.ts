import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, type ChildProcess } from 'node:child_process';
import { LocalStore } from '../src/index';
import { SharedForestStoryStore } from '../src/forest-story-store';
import { LivingWorldStore } from '../src/living-world-store';
import type { NPCActionKind, NPCActionOffer, PotionKind } from '../../contracts/src/living-world';

const stores: LocalStore[] = [], dirs: string[] = [];
afterEach(() => { for (const store of stores.splice(0)) store.close(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function fixture(disk = false) {
  const dir = disk ? mkdtempSync(join(tmpdir(), 'third-space-living-world-')) : null; if (dir) dirs.push(dir);
  const path = dir ? join(dir, 'world.sqlite') : ':memory:';
  const store = new LocalStore({ path }); stores.push(store);
  const user = store.createIdentity({ name: 'Lantern host' }).profile.id;
  const home = store.createHome(user, { name: 'Lantern home', pin: '123456' }).id;
  let now = 1_000_000, serial = 0;
  const clock = () => now;
  const world = new LivingWorldStore(store.db, { canAccess: (h, u) => store.canAccess(h, u), now: clock });
  const story = new SharedForestStoryStore(store.db, { canAccess: (h, u) => store.canAccess(h, u), now: clock, chooseCulprit: () => 'goblin-nib' });
  const command = () => `living-${++serial}`;
  const read = () => world.read(home, user);
  const apples = (target = 5) => {
    let s = story.read(home, user);
    while (s.personal.inventory.apples < target) s = story.changeApples(home, user, { before: s.personal.inventory.apples, after: s.personal.inventory.apples + 1, cause: 'harvest', expectedRevision: s.personal.inventory.revision }).snapshot;
    return s;
  };
  const offer = (npc: string, kind: NPCActionKind, potion?: PotionKind) => world.offers(home, user, npc).find(o => o.kind === kind && o.potion === potion)!;
  const act = (offer: NPCActionOffer, extra: { commandId?: string; expectedInventoryRevision?: number; potionSlotAvailable?: boolean } = {}) => world.act(home, user, { commandId: command(), actionId: offer.actionId, expectedInventoryRevision: read().personal.inventory.revision, potionSlotAvailable: true, ...extra });
  const buy = (potion: PotionKind) => act(offer(potion === 'strength' ? 'wizard-orin-vale' : 'innkeeper-nessa', 'trade', potion));
  const rescue = (event: 'discovered' | 'protected' | 'escort-arrived' | 'setback', id = command()) => world.advanceRescue(home, user, { event, commandId: id, incidentId: 'lantern-road-v1' });
  const member = () => { const id = store.createIdentity({ name: 'Lantern neighbour' }).profile.id; store.joinHome(home, id, { pin: '123456' }); return id; };
  return { store, world, story, home, user, path, read, apples, offer, act, buy, rescue, member, command, clock, advance: (ms: number) => { now += ms; } };
}

async function race(path: string, home: string, user: string, bodies: string[]): Promise<any[]> {
  const children: ChildProcess[] = [];
  try {
    const workers = bodies.map(body => {
      const code = `import { DatabaseSync } from 'node:sqlite';
        import { LivingWorldStore } from ${JSON.stringify(new URL('../src/living-world-store.ts', import.meta.url).href)};
        const db=new DatabaseSync(process.env.LIVING_DB); db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON');
        const world=new LivingWorldStore(db,{canAccess:()=>true,now:()=>1000000});const home=process.env.LIVING_HOME,user=process.env.LIVING_USER;
        process.send({ready:true});process.on('message',()=>{try{const result=(()=>{${body}})();process.send({result});db.close();process.exit(0);}catch(error){process.send({error:String(error)});process.exit(1);}});`;
      const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code], { cwd: fileURLToPath(new URL('../../../', import.meta.url)), stdio: ['ignore', 'ignore', 'pipe', 'ipc'], env: { ...process.env, LIVING_DB: path, LIVING_HOME: home, LIVING_USER: user } });
      children.push(child); let stderr = '', started = false, delivered = false;
      child.stderr!.on('data', data => { stderr += data.toString(); });
      const ready = new Promise<void>((resolve, reject) => {
        child.on('message', message => { if ((message as any).ready) { started = true; resolve(); } });
        child.on('error', reject); child.on('exit', code => { if (!started) reject(new Error(`Living worker exited ${code}: ${stderr}`)); });
      });
      const result = new Promise<any>((resolve, reject) => {
        child.on('message', message => { const m = message as any; if (m.error) reject(new Error(m.error)); if (m.result) { delivered = true; resolve(m.result); } });
        child.on('error', reject); child.on('exit', code => { if (!delivered) reject(new Error(`Living worker exited ${code}: ${stderr}`)); });
      });
      return { child, ready, result };
    });
    await Promise.all(workers.map(worker => worker.ready)); workers.forEach(worker => worker.child.send('go'));
    return await Promise.all(workers.map(worker => worker.result));
  } finally { children.forEach(child => { if (child.exitCode === null) child.kill(); }); }
}

describe('durable living-world authority', () => {
  it('is additive, starts undiscovered, keeps keeper state private and does not change main chapters', () => {
    const f = fixture(), version = f.store.db.prepare('PRAGMA user_version').get();
    const s = f.read();
    expect(s.rescue).toMatchObject({ discovered: false, stage: 'endangered', summary: '' });
    expect(JSON.stringify(s)).not.toMatch(/culprit|private_json|confirmedFace|goblin-nib/);
    expect(f.store.db.prepare('PRAGMA user_version').get()).toEqual(version);
    f.act(f.offer('wizard-orin-vale', 'talk'));
    expect(f.read().rescue.discovered).toBe(true);
    expect(f.story.read(f.home, f.user).story.chapter).toBe('undiscovered');
  });
  it('spends canonical apples and grants a potion in one revision, then replays across reopen', () => {
    const f = fixture(true); f.apples();
    const initial = f.read(), offer = f.offer('wizard-orin-vale', 'trade', 'strength');
    const request = { commandId: 'buy-once', actionId: offer.actionId, expectedInventoryRevision: initial.personal.inventory.revision, potionSlotAvailable: true };
    const bought = f.world.act(f.home, f.user, request);
    expect(bought.snapshot.personal.inventory).toEqual({ apples: 3, revision: initial.personal.inventory.revision + 1, potions: { strength: 1, speed: 0 } });
    expect(f.story.read(f.home, f.user).personal.inventory).toEqual({ apples: 3, revision: initial.personal.inventory.revision + 1 });
    stores.splice(stores.indexOf(f.store), 1); f.store.close();
    const reopened = new LocalStore({ path: f.path }); stores.push(reopened);
    const world = new LivingWorldStore(reopened.db, { canAccess: (h, u) => reopened.canAccess(h, u), now: () => 2_000_000 });
    const replayed = world.act(f.home, f.user, request);
    expect(replayed.replayed).toBe(true); expect(replayed.receipt).toEqual(bought.receipt);
    expect(replayed.snapshot.personal.inventory).toEqual(bought.snapshot.personal.inventory);
    expect(() => world.act(f.home, f.user, { ...request, actionId: 'other' })).toThrowError(expect.objectContaining({ code: 'EVENT_CONFLICT' }));
  });
  it('rolls the apple payment back if the durable potion write fails', () => {
    const f = fixture(); f.apples(); const before = f.read();
    const offer = f.offer('wizard-orin-vale', 'trade', 'strength');
    f.store.db.exec("CREATE TRIGGER fail_potion BEFORE UPDATE ON living_world_personal BEGIN SELECT RAISE(ABORT,'forced potion failure'); END");
    expect(() => f.act(offer)).toThrow('forced potion failure');
    expect(f.read().personal.inventory).toEqual(before.personal.inventory);
    expect(f.store.db.prepare('SELECT count(*) AS n FROM living_world_receipts').get()!.n).toBe(0);
    f.store.db.exec('DROP TRIGGER fail_potion');
    expect(f.act(offer).receipt.status).toBe('updated');
  });
  it('rejects stale inventory, full slots, exhausted dose capacity and reused offers', () => {
    const f = fixture(); f.apples();
    const offer = f.offer('wizard-orin-vale', 'trade', 'strength'), before = f.read().personal.inventory;
    expect(f.act(offer, { expectedInventoryRevision: before.revision - 1 }).receipt.status).toBe('inventory-conflict');
    expect(f.act(offer).receipt.status).toBe('unchanged');
    expect(f.act(f.offer('wizard-orin-vale', 'trade', 'strength'), { potionSlotAvailable: false }).receipt.status).toBe('inventory-full');
    expect(f.read().personal.inventory).toEqual(before);
    f.buy('strength'); f.buy('strength'); f.apples();
    expect(f.buy('strength').receipt.status).toBe('blocked');
    expect(f.read().personal.inventory.potions.strength).toBe(2);
    expect(f.read().personal.inventory.apples).toBe(5);
  });
  it('binds a supplied nearby NPC to the offer and its durable replay identity', () => {
    const f = fixture(); f.apples();
    const offer = f.offer('wizard-orin-vale', 'trade', 'strength'), revision = f.read().personal.inventory.revision;
    const request = { commandId: 'bound-offer', actionId: offer.actionId, expectedInventoryRevision: revision, potionSlotAvailable: true, npcId: 'wizard-orin-vale' };
    const rejected = f.world.act(f.home, f.user, { ...request, commandId: 'wrong-neighbour', npcId: 'innkeeper-nessa' });
    expect(rejected.receipt.status).toBe('blocked'); expect(f.read().personal.inventory.apples).toBe(5);
    expect(f.world.act(f.home, f.user, request).receipt.status).toBe('updated');
    expect(() => f.world.act(f.home, f.user, { ...request, npcId: 'innkeeper-nessa' })).toThrowError(expect.objectContaining({ code: 'EVENT_CONFLICT' }));
    expect(f.world.act(f.home, f.user, request).replayed).toBe(true);
  });
  it('atomically resolves real concurrent trade offers with one stale revision', async () => {
    const f = fixture(true); f.apples(2); const revision = f.read().personal.inventory.revision;
    const a = f.offer('wizard-orin-vale', 'trade', 'strength'), b = f.offer('innkeeper-nessa', 'trade', 'speed');
    const results = await race(f.path, f.home, f.user, [a, b].map((offer, n) => `return world.act(home,user,${JSON.stringify({ commandId: `race-${n}`, actionId: offer.actionId, expectedInventoryRevision: revision, potionSlotAvailable: true })});`));
    expect(results.filter(result => result.receipt.status === 'updated')).toHaveLength(1);
    const inventory = f.read().personal.inventory;
    expect(inventory.apples).toBe(0); expect(inventory.revision).toBe(revision + 1);
    expect(inventory.potions.speed + inventory.potions.strength).toBe(1);
  });
  it('returns one original receipt when the same command races across connections', async () => {
    const f = fixture(true); f.apples();
    const offer = f.offer('wizard-orin-vale', 'trade', 'strength');
    const request = { commandId: 'same-network-retry', actionId: offer.actionId, expectedInventoryRevision: f.read().personal.inventory.revision, potionSlotAvailable: true };
    const body = `return world.act(home,user,${JSON.stringify(request)});`;
    const results = await race(f.path, f.home, f.user, [body, body]);
    expect(results.map(result => result.replayed).sort()).toEqual([false, true]);
    expect(results[0].receipt).toEqual(results[1].receipt);
    expect(f.read().personal.inventory).toMatchObject({ apples: 3, potions: { strength: 1, speed: 0 } });
    expect(f.world.act(f.home, f.user, { ...request, potionSlotAvailable: false }).replayed).toBe(true);
  });
  it('does not refresh active effects or reset shared cooldown when reopened', () => {
    const f = fixture(true); f.apples(); f.buy('strength'); f.buy('strength'); f.apples(); f.buy('speed');
    const use = (potion: PotionKind, commandId = f.command()) => f.world.usePotion(f.home, f.user, { commandId, potion, expectedInventoryRevision: f.read().personal.inventory.revision });
    const used = use('strength'); const deadline = used.snapshot.personal.effects[0]!.expiresAt;
    expect(use('strength').receipt.status).toBe('blocked'); expect(use('speed').receipt.status).toBe('blocked');
    const secondConnection = new LocalStore({ path: f.path }); stores.push(secondConnection);
    const world = new LivingWorldStore(secondConnection.db, { canAccess: (h, u) => secondConnection.canAccess(h, u), now: f.clock });
    expect(world.read(f.home, f.user).personal.effects[0]!.expiresAt).toBe(deadline);
    f.advance(3_000); expect(use('speed').receipt.status).toBe('updated');
    expect(f.read().personal.effects.find(effect => effect.kind === 'strength')!.expiresAt).toBe(deadline);
    f.advance(17_000); expect(f.read().personal.effects.map(effect => effect.kind)).toEqual(['speed']);
    f.advance(3_000); expect(world.read(f.home, f.user).personal.effects).toEqual([]);
    expect(f.read().personal.inventory.potions).toEqual({ strength: 1, speed: 0 });
  });
  it('requires room-derived equipment for new uses while replay survives automatic unequip', () => {
    const f = fixture(); f.apples(); f.buy('speed');
    const request = { commandId: 'equipped-use', potion: 'speed' as const, expectedInventoryRevision: f.read().personal.inventory.revision, equipped: true };
    expect(f.world.usePotion(f.home, f.user, { ...request, commandId: 'unequipped', equipped: false }).receipt.status).toBe('blocked');
    const first = f.world.usePotion(f.home, f.user, request);
    expect(first.snapshot.personal.inventory.potions.speed).toBe(0);
    f.advance(10_000);
    const replay = f.world.usePotion(f.home, f.user, { ...request, equipped: false });
    expect(replay.replayed).toBe(true); expect(replay.receipt).toEqual(first.receipt);
    expect(replay.snapshot.personal.effects).toEqual(first.snapshot.personal.effects);
  });
  it('persists witnessed fear, penalizes trust once and repairs kindness without spam farming', () => {
    const f = fixture(); f.apples();
    const attack = { commandId: 'one-physical-hit', targetNpcId: 'orchard-worker-mara', witnessNpcIds: ['wizard-orin-vale', 'guard-iona'] };
    const harmed = f.world.witnessAttack(f.home, f.user, attack);
    expect(harmed.snapshot.personal.trust).toBe(-24);
    expect(harmed.snapshot.personal.relationships).toHaveLength(3);
    expect(f.world.witnessAttack(f.home, f.user, attack).replayed).toBe(true);
    expect(f.read().personal.trust).toBe(-24);
    expect(f.offer('wizard-orin-vale', 'trade', 'strength').disabledReason).toBeTruthy();
    expect(f.offer('wizard-orin-vale', 'talk').disabledReason).toBeUndefined();
    f.act(f.offer('orchard-worker-mara', 'give'));
    const once = f.read();
    expect(once.personal.trust).toBe(-19);
    expect(f.act(f.offer('orchard-worker-mara', 'give')).receipt.status).toBe('blocked');
    expect(f.read().personal.inventory).toEqual(once.personal.inventory);
    f.advance(60_000);
    expect(f.read().personal.relationships.find(r => r.npcId === 'guard-iona')?.fear).toBe(0);
    expect(f.read().personal.relationships.find(r => r.npcId === 'orchard-worker-mara')!.fear).toBeGreaterThan(0);
  });
  it('does not change either member’s reputation when no NPC witnessed a verified PvP hit', () => {
    const f = fixture(), target = f.member();
    const before = f.read(), victimBefore = f.world.read(f.home, target);
    const request = { commandId: 'unseen-player-hit', targetUserId: target, witnessNpcIds: [] };
    const result = f.world.witnessPlayerAttack(f.home, f.user, request);
    expect(result.receipt.status).toBe('unchanged'); expect(result.snapshot.personal).toEqual(before.personal);
    expect(f.world.read(f.home, target).personal).toEqual(victimBefore.personal);
    expect(f.world.witnessPlayerAttack(f.home, f.user, request).replayed).toBe(true);
  });
  it('persists witnessed PvP betrayal once across reopen without penalizing its victim', () => {
    const f = fixture(true), target = f.member();
    const victimBefore = f.world.read(f.home, target);
    const request = { commandId: 'seen-player-hit', targetUserId: target, witnessNpcIds: ['guard-iona', 'orchard-worker-mara'] };
    const result = f.world.witnessPlayerAttack(f.home, f.user, request);
    expect(result.snapshot.personal.trust).toBe(-24);
    expect(result.snapshot.personal.relationships.map(memory => [memory.npcId, memory.trust, memory.fear])).toEqual([['guard-iona', -10, 38], ['orchard-worker-mara', -10, 38]]);
    expect(f.world.read(f.home, target).personal).toEqual(victimBefore.personal);
    stores.splice(stores.indexOf(f.store), 1); f.store.close();
    const reopened = new LocalStore({ path: f.path }); stores.push(reopened);
    const world = new LivingWorldStore(reopened.db, { canAccess: (h, u) => reopened.canAccess(h, u), now: f.clock });
    const replay = world.witnessPlayerAttack(f.home, f.user, { ...request, witnessNpcIds: [...request.witnessNpcIds].reverse() });
    expect(replay.replayed).toBe(true); expect(replay.receipt).toEqual(result.receipt);
    expect(replay.snapshot.personal.trust).toBe(-24);
    expect(world.read(f.home, target).personal).toEqual(victimBefore.personal);
    f.advance(60_000);
    const memories = world.read(f.home, f.user).personal.relationships;
    expect(memories.find(memory => memory.npcId === 'guard-iona')).toMatchObject({ trust: 0, fear: 0 });
    expect(memories.find(memory => memory.npcId === 'orchard-worker-mara')).toMatchObject({ trust: -8, fear: 31 });
  });
  it('rejects unknown, cross-home and self PvP targets and malformed witnesses without side effects', () => {
    const f = fixture(), other = f.store.createIdentity({ name: 'Elsewhere' }).profile.id;
    f.store.createHome(other, { name: 'Other home', pin: '654321' });
    const before = f.read();
    for (const targetUserId of ['unknown-user', other]) expect(() => f.world.witnessPlayerAttack(f.home, f.user, { commandId: `target-${targetUserId}`, targetUserId, witnessNpcIds: ['guard-iona'] })).toThrowError(expect.objectContaining({ code: 'ACCESS_DENIED' }));
    expect(() => f.world.witnessPlayerAttack(f.home, f.user, { commandId: 'self', targetUserId: f.user, witnessNpcIds: [] })).toThrowError(expect.objectContaining({ code: 'INVALID_EVENT' }));
    const target = f.member();
    for (const witnessNpcIds of [['unknown-npc'], ['guard-iona', 'guard-iona'], Array.from({ length: 33 }, () => 'guard-iona')]) expect(() => f.world.witnessPlayerAttack(f.home, f.user, { commandId: 'bad-witnesses', targetUserId: target, witnessNpcIds })).toThrowError(expect.objectContaining({ code: 'INVALID_EVENT' }));
    expect(f.read().personal).toEqual(before.personal);
    const request = { commandId: 'admitted-player-hit', targetUserId: target, witnessNpcIds: ['guard-iona'] };
    f.world.witnessPlayerAttack(f.home, f.user, request);
    const revoked = new LivingWorldStore(f.store.db, { canAccess: (h, u) => u !== target && f.store.canAccess(h, u), now: f.clock });
    expect(() => revoked.witnessPlayerAttack(f.home, f.user, request)).toThrowError(expect.objectContaining({ code: 'ACCESS_DENIED' }));
    expect(() => f.world.witnessPlayerAttack(f.home, f.user, { ...request, witnessNpcIds: [] })).toThrowError(expect.objectContaining({ code: 'EVENT_CONFLICT' }));
  });
  it('keeps positive gift trust bounded and trade goodwill cannot farm positive reputation', () => {
    const f = fixture();
    for (let n = 0; n < 5; n++) { f.apples(); f.act(f.offer('cheesemonger-merrit', 'give')); f.advance(60_000); }
    expect(f.read().personal.trust).toBe(10);
    f.apples(); f.buy('strength'); f.buy('speed');
    expect(f.read().personal.trust).toBe(10);
  });
  it('persists distinct NPC trust across real reopen, recovers negative memories and keeps positive bonds', () => {
    const f = fixture(true); f.apples(); f.act(f.offer('innkeeper-nessa', 'give'));
    f.world.witnessAttack(f.home, f.user, { commandId: 'local-trust-hit', targetNpcId: 'orchard-worker-mara', witnessNpcIds: ['guard-iona', 'wizard-orin-vale'] });
    const trust = (snapshot: ReturnType<typeof f.read>, npcId: string) => snapshot.personal.relationships.find(memory => memory.npcId === npcId)!.trust;
    expect(trust(f.read(), 'orchard-worker-mara')).toBe(-18); expect(trust(f.read(), 'guard-iona')).toBe(-10); expect(trust(f.read(), 'innkeeper-nessa')).toBe(5);
    stores.splice(stores.indexOf(f.store), 1); f.store.close();
    const reopened = new LocalStore({ path: f.path }); stores.push(reopened);
    const world = new LivingWorldStore(reopened.db, { canAccess: (h, u) => reopened.canAccess(h, u), now: f.clock });
    const read = () => world.read(f.home, f.user);
    expect(trust(read(), 'orchard-worker-mara')).toBe(-18);
    f.advance(60_000);
    expect(trust(read(), 'guard-iona')).toBe(0); expect(trust(read(), 'wizard-orin-vale')).toBe(-7); expect(trust(read(), 'orchard-worker-mara')).toBe(-15);
    f.advance(240_000);
    expect(trust(read(), 'wizard-orin-vale')).toBe(0); expect(trust(read(), 'orchard-worker-mara')).toBe(0); expect(trust(read(), 'innkeeper-nessa')).toBe(5);
    const replayed = world.witnessAttack(f.home, f.user, { commandId: 'local-trust-hit', targetNpcId: 'orchard-worker-mara', witnessNpcIds: ['wizard-orin-vale', 'guard-iona'] });
    expect(replayed.replayed).toBe(true); expect(trust(read(), 'orchard-worker-mara')).toBe(0);
  });
  it('bounds local gift goodwill, limits trade recovery and awards Mara’s gratitude once per verified stage', () => {
    const f = fixture(); f.apples();
    f.world.witnessAttack(f.home, f.user, { commandId: 'local-trade-hit', targetNpcId: 'orchard-worker-mara', witnessNpcIds: ['wizard-orin-vale'] });
    f.act(f.offer('wizard-orin-vale', 'give'));
    const trust = (npc: string) => f.read().personal.relationships.find(memory => memory.npcId === npc)!.trust;
    expect(trust('wizard-orin-vale')).toBe(-5);
    f.buy('strength'); expect(trust('wizard-orin-vale')).toBe(-3);
    f.buy('strength'); expect(trust('wizard-orin-vale')).toBe(-3);
    for (let n = 0; n < 8; n++) { f.apples(); f.act(f.offer('innkeeper-nessa', 'give')); f.advance(60_000); }
    expect(trust('innkeeper-nessa')).toBe(30);
    f.rescue('protected'); expect(trust('orchard-worker-mara')).toBe(8);
    f.rescue('escort-arrived'); expect(trust('orchard-worker-mara')).toBe(16);
    f.rescue('setback'); f.advance(10_000); f.rescue('protected');
    expect(trust('orchard-worker-mara')).toBe(16);
  });
  it('restores legacy fear-only memories with neutral local trust without resetting fear', () => {
    const f = fixture();
    f.world.witnessAttack(f.home, f.user, { commandId: 'legacy-hit', targetNpcId: 'wizard-orin-vale', witnessNpcIds: [] });
    const row = f.store.db.prepare('SELECT state_json FROM living_world_personal WHERE home_id=? AND user_id=?').get(f.home, f.user)!;
    const state = JSON.parse(String(row.state_json));
    for (const memory of state.relationships) { delete memory.trust; delete memory.trustAt; delete memory.trustRecoverAt; }
    f.store.db.prepare('UPDATE living_world_personal SET state_json=? WHERE home_id=? AND user_id=?').run(JSON.stringify(state), f.home, f.user);
    expect(f.read().personal.relationships[0]).toMatchObject({ trust: 0, fear: 60, afraid: true });
    f.world.witnessAttack(f.home, f.user, { commandId: 'new-hit', targetNpcId: 'wizard-orin-vale', witnessNpcIds: [] });
    expect(f.read().personal.relationships[0]).toMatchObject({ trust: -18, fear: 100 });
  });
  it('shares rescue progress, grants offline member entitlements once, and leaves a full-pocket reward pending', () => {
    const f = fixture(), offline = f.member();
    expect(f.rescue('escort-arrived').receipt.status).toBe('blocked');
    f.rescue('protected'); f.rescue('escort-arrived');
    f.apples(); f.act(f.offer('orchard-worker-mara', 'give'));
    expect(f.read().rescue.stage).toBe('complete');
    expect(f.world.read(f.home, offline).personal.rewards[0]?.status).toBe('pending');
    const after = f.member(); expect(f.world.read(f.home, after).personal.rewards).toEqual([]);
    expect(f.rescue('setback').receipt.status).toBe('unchanged');
    let revision = f.read().personal.inventory.revision;
    const full = f.world.claimReward(f.home, f.user, { commandId: 'full', expectedInventoryRevision: revision, potionSlotAvailable: false });
    expect(full.receipt.status).toBe('inventory-full'); expect(full.snapshot.personal.rewards[0]?.status).toBe('pending');
    const request = { commandId: 'reward', expectedInventoryRevision: revision, potionSlotAvailable: true };
    const claimed = f.world.claimReward(f.home, f.user, request);
    expect(claimed.snapshot.personal.inventory.potions.speed).toBe(1);
    expect(f.world.claimReward(f.home, f.user, request).replayed).toBe(true);
    revision = f.read().personal.inventory.revision;
    expect(f.world.claimReward(f.home, f.user, { ...request, commandId: 'new-claim', expectedInventoryRevision: revision }).receipt.status).toBe('unchanged');
    expect(f.read().personal.inventory.potions.speed).toBe(1);
    expect(f.read().personal.badges).toEqual(['lantern-road-neighbour']);
  });
  it('supports an apple-free recovery after reopen and prevents repeat rescue goodwill', () => {
    const f = fixture(true); f.rescue('protected'); const trust = f.read().personal.trust;
    f.rescue('setback'); f.advance(10_000); f.rescue('protected');
    expect(f.read().personal.trust).toBe(trust);
    f.rescue('escort-arrived');
    expect(f.read().personal.inventory.apples).toBe(0);
    stores.splice(stores.indexOf(f.store), 1); f.store.close();
    const reopened = new LocalStore({ path: f.path }); stores.push(reopened);
    const world = new LivingWorldStore(reopened.db, { canAccess: (h, u) => reopened.canAccess(h, u), now: () => 9_000_000 });
    const s = world.read(f.home, f.user);
    expect(s.rescue.stage).toBe('complete'); expect(s.personal.rewards).toHaveLength(1);
    expect(world.read(f.home, f.user).personal.rewards).toHaveLength(1);
  });
  it('commits a delayed setback followed by verified protection without restarting the runtime retry delay', () => {
    const f = fixture();
    // Both outcomes waited through a storage outage; runtime order is preserved,
    // but their database commit timestamps are now identical.
    const setback = f.rescue('setback', 'queued-old-setback');
    expect(setback.snapshot.rescue.retryAt).toBeGreaterThan(f.clock());
    const offer = f.offer('orchard-worker-mara', 'protect');
    expect(offer.disabledReason).toBeTruthy();
    expect(f.act(offer).receipt.status).toBe('blocked');
    expect(f.read().rescue.stage).toBe('endangered');
    const protectedResult = f.rescue('protected', 'queued-verified-protection');
    expect(protectedResult.receipt.status).toBe('updated');
    expect(protectedResult.snapshot.rescue).toMatchObject({ stage: 'escorting', retryAt: 0 });
    expect(f.rescue('protected', 'queued-verified-protection').replayed).toBe(true);
    expect(f.read().personal.trust).toBe(10);
    expect(f.rescue('escort-arrived', 'queued-verified-arrival').snapshot.rescue.stage).toBe('recovering');
  });
  it('credits all verified helpers once, checks every helper admission and excludes observers from goodwill', () => {
    const f = fixture(), helper = f.member(), observer = f.member();
    const request = { commandId: 'team-protected', event: 'protected' as const, participantIds: [f.user, helper] };
    f.world.advanceRescue(f.home, f.user, request);
    expect(f.world.read(f.home, helper).personal.trust).toBe(10);
    expect(f.world.read(f.home, observer).personal.trust).toBe(0);
    expect(f.world.advanceRescue(f.home, f.user, { ...request, participantIds: [helper, f.user] }).replayed).toBe(true);
    const inaccessible = new LivingWorldStore(f.store.db, { canAccess: (home, user) => user !== helper && f.store.canAccess(home, user), now: f.clock });
    expect(() => inaccessible.advanceRescue(f.home, f.user, request)).toThrowError(expect.objectContaining({ code: 'ACCESS_DENIED' }));
    expect(() => f.world.advanceRescue(f.home, f.user, { commandId: 'bad-team', event: 'escort-arrived', participantIds: [helper] })).toThrowError(expect.objectContaining({ code: 'INVALID_EVENT' }));
    expect(f.read().rescue.stage).toBe('escorting');
  });
  it('serializes concurrent potion reward claims from separate SQLite connections', async () => {
    const f = fixture(true); f.rescue('protected'); f.rescue('escort-arrived'); f.apples(); f.act(f.offer('orchard-worker-mara', 'give'));
    const revision = f.read().personal.inventory.revision;
    const results = await race(f.path, f.home, f.user, [0, 1].map(n => `return world.claimReward(home,user,${JSON.stringify({ commandId: `claim-${n}`, expectedInventoryRevision: revision, potionSlotAvailable: true })});`));
    expect(results.map(result => result.receipt.status).sort()).toEqual(['unchanged', 'updated']);
    expect(f.read().personal.inventory.potions.speed).toBe(1);
    expect(f.read().personal.inventory.revision).toBe(revision + 1);
  });
  it('checks current access for every entrypoint including receipts and reads', () => {
    const f = fixture(); f.apples(); const offer = f.offer('wizard-orin-vale', 'trade', 'strength');
    const request = { commandId: 'buy', actionId: offer.actionId, expectedInventoryRevision: f.read().personal.inventory.revision, potionSlotAvailable: true };
    f.world.act(f.home, f.user, request);
    const world = new LivingWorldStore(f.store.db, { canAccess: () => false });
    const calls = [() => world.read(f.home, f.user), () => world.offers(f.home, f.user, 'wizard-orin-vale'), () => world.act(f.home, f.user, request), () => world.usePotion(f.home, f.user, { commandId: 'use', potion: 'strength', expectedInventoryRevision: 1 }), () => world.witnessAttack(f.home, f.user, { commandId: 'hit', targetNpcId: 'wizard-orin-vale', witnessNpcIds: [] }), () => world.advanceRescue(f.home, f.user, { commandId: 'help', event: 'protected' }), () => world.claimReward(f.home, f.user, { commandId: 'claim', expectedInventoryRevision: 1, potionSlotAvailable: true })];
    calls.forEach(call => expect(call).toThrowError(expect.objectContaining({ code: 'ACCESS_DENIED' })));
  });
  it('fails closed on unknown commands, corrupted bounds and unsupported versions', () => {
    const f = fixture(); f.read();
    expect(() => f.world.witnessAttack(f.home, f.user, { commandId: 'hit', targetNpcId: 'fake', witnessNpcIds: [] })).toThrowError(expect.objectContaining({ code: 'INVALID_EVENT' }));
    expect(() => f.world.usePotion(f.home, f.user, { commandId: 'use', potion: 'speed', expectedInventoryRevision: Number.NaN })).toThrowError(expect.objectContaining({ code: 'INVALID_EVENT' }));
    const row = f.store.db.prepare('SELECT state_json FROM living_world_personal').get()!;
    const state = JSON.parse(String(row.state_json)); state.potions.speed = 3;
    f.store.db.prepare('UPDATE living_world_personal SET state_json=?').run(JSON.stringify(state));
    expect(() => f.read()).toThrowError(expect.objectContaining({ code: 'CORRUPT_STATE' }));
    f.store.db.prepare('UPDATE living_world_personal SET state_json=?,version=99').run(String(row.state_json));
    expect(() => f.read()).toThrowError(expect.objectContaining({ code: 'UNSUPPORTED_VERSION' }));
  });
});
