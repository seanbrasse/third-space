import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, type ChildProcess } from 'node:child_process';
import { LocalStore } from '../src/index';
import { SharedForestStoryStore } from '../src/forest-story-store';
import { STORY_SEALS, STORY_RAIDERS, STORY_GUARDIAN, STORY_SUSPECTS, type ForestStoryEvent } from '../../simulation/src/forest-story';
import type { ForestStorySnapshot } from '../../contracts/src/forest-story';

const stores: LocalStore[] = [], dirs: string[] = [];
afterEach(() => { for (const s of stores.splice(0)) s.close(); for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
function open(path = ':memory:') {
  const store = new LocalStore({ path }); stores.push(store);
  const story = new SharedForestStoryStore(store.db, { canAccess: (h, u) => store.canAccess(h, u), now: () => 5_000_000, chooseCulprit: () => 'goblin-nib' });
  return { store, story };
}
function fixture(disk = false, memberCount = 1) {
  const dir = disk ? mkdtempSync(join(tmpdir(), 'third-space-shared-story-')) : null; if (dir) dirs.push(dir);
  const path = dir ? join(dir, 'story.sqlite') : ':memory:', { store, story } = open(path);
  const user = store.createIdentity({ name: 'Story host' }).profile.id;
  const home = store.createHome(user, { name: 'Shared keeper story', pin: '123456' }).id;
  const members = [user];
  for (let n = 1; n < memberCount; n++) { const id = store.createIdentity({ name: `Neighbour ${n}` }).profile.id; store.joinHome(home, id, { pin: '123456' }); members.push(id); }
  let serial = 0;
  const emit = (detail: Record<string, unknown>, actorId = user) => story.apply(home, { eventId: `story-event-${++serial}`, actorId, occurredAt: serial * 20_000, ...detail } as ForestStoryEvent);
  const defeat = (encounterId: string, actorId = user, participantIds = [actorId]) => emit({ kind: 'encounter-defeated', encounterId, defeatId: `life:${encounterId}`, participantIds }, actorId);
  const wards = () => {
    emit({ kind: 'talk', npcId: 'wizard-orin-vale' });
    STORY_SEALS.forEach((supplyId, n) => emit({ kind: 'recover', supplyId }, members[n % members.length]));
    STORY_RAIDERS.forEach(encounterId => defeat(encounterId));
    return emit({ kind: 'talk', npcId: 'wizard-orin-vale' });
  };
  const inquiry = () => { for (const evidenceId of ['ada-journal', 'ward-rubbing']) emit({ kind: 'inspect', evidenceId }); for (const s of STORY_SUSPECTS) emit({ kind: 'talk', npcId: s.id }); return emit({ kind: 'accuse', suspectId: 'goblin-nib' }); };
  return { store, story, home, user, members, path, emit, defeat, wards, inquiry };
}
const capacity = (s: ForestStorySnapshot, appleSlotAvailable = true) => ({ inventoryRevision: s.personal.inventory.revision, appleSlotAvailable });
const count = (db: LocalStore['db'], table: string) => Number(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n);

async function concurrent(path: string, home: string, user: string, bodies: string[]): Promise<any[]> {
  const children: ChildProcess[] = [];
  try {
    const workers = bodies.map(body => {
      const code = `import { DatabaseSync } from 'node:sqlite';
        import { SharedForestStoryStore } from ${JSON.stringify(new URL('../src/forest-story-store.ts', import.meta.url).href)};
        const db=new DatabaseSync(process.env.STORY_TEST_DB); db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON');
        const story=new SharedForestStoryStore(db,{canAccess:()=>true}); const home=process.env.STORY_TEST_HOME,user=process.env.STORY_TEST_USER;
        process.send({ready:true});process.on('message',()=>{try{const result=(()=>{${body}})();process.send({result});db.close();process.exit(0);}catch(error){process.send({error:String(error)});process.exit(1);}});`;
      const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code], {
        cwd: fileURLToPath(new URL('../../../', import.meta.url)), stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
        env: { ...process.env, STORY_TEST_DB: path, STORY_TEST_HOME: home, STORY_TEST_USER: user },
      });
      children.push(child); let stderr = '', started = false, delivered = false;
      child.stderr!.on('data', data => { stderr += data.toString(); });
      const ready = new Promise<void>((resolve, reject) => {
        child.on('message', message => { if ((message as any).ready) { started = true; resolve(); } });
        child.on('error', reject); child.on('exit', code => { if (!started) reject(new Error(`Story worker exited ${code}: ${stderr}`)); });
      });
      const result = new Promise<any>((resolve, reject) => {
        child.on('message', message => { const m = message as any; if (m.error) reject(new Error(m.error)); if (m.result) { delivered = true; resolve(m.result); } });
        child.on('error', reject); child.on('exit', code => { if (!delivered) reject(new Error(`Story worker exited ${code}: ${stderr}`)); });
      });
      return { child, ready, result };
    });
    await Promise.all(workers.map(w => w.ready)); for (const worker of workers) worker.child.send('go');
    return await Promise.all(workers.map(w => w.result));
  } finally { for (const child of children) if (child.exitCode === null) child.kill(); }
}

describe('durable cooperative home story', () => {
  it('creates additive state without changing local schema version and keeps the culprit private/stable', () => {
    const f = fixture(); const version = f.store.db.prepare('PRAGMA user_version').get();
    const s = f.story.read(f.home, f.user);
    expect(s.story.chapter).toBe('undiscovered'); expect(s.story.leads).toEqual([]);
    expect(JSON.stringify(s)).not.toMatch(/culprit|confirmedFace|private_json|goblin-nib/);
    const otherHelper = new SharedForestStoryStore(f.store.db, { canAccess: () => true, chooseCulprit: () => 'flirt-fenn' });
    otherHelper.read(f.home, f.user);
    expect(otherHelper.readAuthority(f.home)?.mystery.culpritId).toBe('goblin-nib');
    expect(f.store.db.prepare('PRAGMA user_version').get()).toEqual(version);
  });
  it('shares every member contribution, gives absent members a recap and pending milestone entitlement', () => {
    const f = fixture(false, 8);
    const result = f.wards(); expect(result.snapshot.story.chapter).toBe('inquiry');
    for (const user of f.members) {
      const s = f.story.read(f.home, user);
      expect(s.story).toEqual(result.snapshot.story);
      expect(s.personal.rewards).toEqual([expect.objectContaining({ id: 'wards-restored', status: 'pending' })]);
      expect(s.personal.catchUp.length).toBe(7); expect(s.personal.inventory.apples).toBe(0);
    }
    expect(count(f.store.db, 'forest_story_entitlements')).toBe(8);
  });
  it('permits asynchronous sequential main progress through the real rescue ending', () => {
    const f = fixture(false, 2); f.wards(); f.inquiry();
    expect(f.emit({ kind: 'rescue', npcId: 'keeper-ada' }, f.members[1]).status).toBe('out-of-order');
    f.defeat(STORY_GUARDIAN, f.members[1], f.members);
    const done = f.emit({ kind: 'rescue', npcId: 'keeper-ada' }, f.members[1]);
    expect(done.snapshot.story.chapter).toBe('complete'); expect(done.snapshot.story.objectives.every(o => o.complete)).toBe(true);
    expect(f.story.read(f.home, f.user).personal.rewards.map(r => r.id).sort()).toEqual(['keeper-rescued', 'wards-restored']);
    expect(done.snapshot.story.recap.at(-1)?.text).toContain('Ada came home');
  });
  it('does not let premature encounters or duplicate physical defeat IDs complete later objectives', () => {
    const f = fixture();
    expect(f.defeat(STORY_GUARDIAN).status).toBe('out-of-order');
    f.wards(); f.inquiry();
    expect(f.defeat(STORY_GUARDIAN).status).toBe('replayed');
    expect(f.story.readAuthority(f.home)?.state.defeated).not.toContain(STORY_GUARDIAN);
    f.emit({ kind: 'encounter-defeated', encounterId: STORY_GUARDIAN, defeatId: 'proper-active-life', participantIds: [f.user] });
    expect(f.story.readAuthority(f.home)?.state.defeated).toContain(STORY_GUARDIAN);
    const before = count(f.store.db, 'forest_story_events');
    for (let n = 0; n < 10; n++) f.emit({ kind: 'encounter-defeated', encounterId: STORY_GUARDIAN, defeatId: `repeat-${n}`, participantIds: [f.user] });
    expect(count(f.store.db, 'forest_story_events')).toBe(before);
  });
  it('replays semantic events across new receipt times but rejects reusing an ID for another actor/payload', () => {
    const f = fixture(false, 2);
    const event = { kind: 'talk', npcId: 'wizard-orin-vale', eventId: 'one', actorId: f.user, occurredAt: 100 } as const;
    expect(f.story.apply(f.home, event).status).toBe('updated');
    expect(f.story.apply(f.home, { ...event, occurredAt: 900 }).status).toBe('replayed');
    expect(() => f.story.apply(f.home, { ...event, actorId: f.members[1] })).toThrowError(expect.objectContaining({ code: 'EVENT_CONFLICT' }));
    expect(() => f.story.apply(f.home, { ...event, npcId: 'witch-tansy-reed' })).toThrowError(expect.objectContaining({ code: 'EVENT_CONFLICT' }));
  });
  it('persists wrong accusations and evidence through reopen, then allows the correct face', () => {
    const f = fixture(true); f.wards();
    for (const evidenceId of ['ada-journal', 'ward-rubbing']) f.emit({ kind: 'inspect', evidenceId });
    for (const s of STORY_SUSPECTS) f.emit({ kind: 'talk', npcId: s.id });
    f.story.apply(f.home, { kind: 'accuse', suspectId: 'flirt-fenn', actorId: f.user, eventId: 'wrong', occurredAt: 1_000_000 });
    stores.splice(stores.indexOf(f.store), 1); f.store.close();
    const reopened = open(f.path);
    expect(reopened.story.readAuthority(f.home)?.mystery.culpritId).toBe('goblin-nib');
    const s = reopened.story.read(f.home, f.user); expect(s.story.evidence).toHaveLength(2);
    expect(s.story.suspects.find(n => n.id === 'flirt-fenn')?.accused).toBe(true);
    const correct = { kind: 'accuse', suspectId: 'goblin-nib', actorId: f.user, eventId: 'correct', occurredAt: 1_000_100 } as const;
    expect(reopened.story.apply(f.home, correct).status).toBe('cooldown');
    expect(reopened.story.apply(f.home, { ...correct, occurredAt: 1_010_000 }).status).toBe('replayed');
    expect(reopened.story.apply(f.home, { ...correct, eventId: 'correct-new-attempt', occurredAt: 1_010_000 }).snapshot.story.chapter).toBe('rescue');
  });
  it('never applies an old early-return event after new contributions unlock the next milestone', () => {
    const f = fixture(); f.emit({ kind: 'talk', npcId: 'wizard-orin-vale' });
    const early = { kind: 'talk', npcId: 'wizard-orin-vale', actorId: f.user, eventId: 'early-return', occurredAt: 100_000 } as const;
    expect(f.story.apply(f.home, early).status).toBe('out-of-order');
    for (const supplyId of STORY_SEALS) f.emit({ kind: 'recover', supplyId }); for (const id of STORY_RAIDERS) f.defeat(id);
    expect(f.story.apply(f.home, { ...early, occurredAt: 500_000 }).status).toBe('replayed');
    expect(f.story.read(f.home, f.user).story.chapter).toBe('wards');
    expect(f.emit({ kind: 'talk', npcId: 'wizard-orin-vale' }).snapshot.story.chapter).toBe('inquiry');
  });
  it('supports discovered-only flexible sideplots and rewards them once independently of the main story', () => {
    const f = fixture();
    f.emit({ kind: 'talk', npcId: 'witch-tansy-reed' });
    expect(f.story.read(f.home, f.user).story.leads.map(l => l.id)).toEqual(['reed-and-ash']);
    f.emit({ kind: 'talk', npcId: 'warlock-vesper' }); f.emit({ kind: 'talk', npcId: 'witch-tansy-reed' });
    f.emit({ kind: 'talk', npcId: 'cheesemonger-merrit' }); f.emit({ kind: 'talk', npcId: 'goblin-pip' }); f.emit({ kind: 'talk', npcId: 'cheesemonger-merrit' });
    const s = f.story.read(f.home, f.user); expect(s.story.chapter).toBe('undiscovered');
    expect(s.story.leads.every(l => l.status === 'complete')).toBe(true); expect(s.personal.rewards).toHaveLength(2);
    const before = count(f.store.db, 'forest_story_entitlements');
    f.emit({ kind: 'talk', npcId: 'witch-tansy-reed' }); expect(count(f.store.db, 'forest_story_entitlements')).toBe(before);
  });
  it('keeps completion independent of full pockets and commits personal claim+badge+apples exactly once', () => {
    const f = fixture(); const s = f.wards().snapshot;
    expect(f.story.claimReward(f.home, f.user, 'wards-restored', capacity(s, false)).status).toBe('inventory-full');
    expect(f.story.read(f.home, f.user).story.chapter).toBe('inquiry');
    const claimed = f.story.claimReward(f.home, f.user, 'wards-restored', capacity(s));
    expect(claimed.status).toBe('reward-claimed'); expect(claimed.snapshot.personal.inventory.apples).toBe(3);
    const consumed = f.story.changeApples(f.home, f.user, { before: 3, after: 2, expectedRevision: claimed.snapshot.personal.inventory.revision, cause: 'eat' });
    expect(f.story.claimReward(f.home, f.user, 'wards-restored', capacity(s)).snapshot.personal.inventory.apples).toBe(2);
    expect(f.story.changeApples(f.home, f.user, { before: 3, after: 2, expectedRevision: claimed.snapshot.personal.inventory.revision, cause: 'eat' }).status).toBe('inventory-conflict');
    expect(consumed.snapshot.personal.rewards[0].status).toBe('claimed');
  });
  it('rolls back story, event, milestone and every absent-member entitlement when the last entitlement fails', () => {
    const f = fixture(false, 3);
    f.emit({ kind: 'talk', npcId: 'wizard-orin-vale' }); for (const supplyId of STORY_SEALS) f.emit({ kind: 'recover', supplyId }); for (const id of STORY_RAIDERS) f.defeat(id);
    const before = f.story.read(f.home, f.user), eventCount = count(f.store.db, 'forest_story_events');
    f.store.db.exec("CREATE TRIGGER fail_entitlement BEFORE INSERT ON forest_story_entitlements WHEN (SELECT count(*) FROM forest_story_entitlements)>=1 BEGIN SELECT RAISE(ABORT,'entitlement failed'); END;");
    expect(() => f.emit({ kind: 'talk', npcId: 'wizard-orin-vale' })).toThrow('entitlement failed');
    expect(f.story.read(f.home, f.user)).toEqual(before); expect(count(f.store.db, 'forest_story_events')).toBe(eventCount);
    expect(count(f.store.db, 'forest_story_milestones')).toBe(0); expect(count(f.store.db, 'forest_story_entitlements')).toBe(0);
    f.store.db.exec('DROP TRIGGER fail_entitlement'); expect(f.emit({ kind: 'talk', npcId: 'wizard-orin-vale' }).snapshot.story.chapter).toBe('inquiry');
  });
  it('rolls back apples and receipt when the final badge insert fails', () => {
    const f = fixture(); const s = f.wards().snapshot;
    f.store.db.exec("CREATE TRIGGER fail_story_badge BEFORE INSERT ON forest_story_badges BEGIN SELECT RAISE(ABORT,'badge failed'); END;");
    expect(() => f.story.claimReward(f.home, f.user, 'wards-restored', capacity(s))).toThrow('badge failed');
    expect(f.story.read(f.home, f.user)).toEqual(s); expect(count(f.store.db, 'forest_story_reward_claims')).toBe(0);
    f.store.db.exec('DROP TRIGGER fail_story_badge'); expect(f.story.claimReward(f.home, f.user, 'wards-restored', capacity(s)).status).toBe('reward-claimed');
  });
  it('retains consumed rewards, seen revisions and absent catch-up across restart', () => {
    const f = fixture(true, 2); let s = f.wards().snapshot;
    f.story.markSeen(f.home, f.user, s.story.revision);
    s = f.story.claimReward(f.home, f.user, 'wards-restored', capacity(s)).snapshot;
    s = f.story.changeApples(f.home, f.user, { before: 3, after: 2, expectedRevision: s.personal.inventory.revision, cause: 'eat' }).snapshot;
    stores.splice(stores.indexOf(f.store), 1); f.store.close(); const reopened = open(f.path);
    expect(reopened.story.read(f.home, f.user).personal).toMatchObject({ inventory: { apples: 2 }, catchUp: [] });
    expect(reopened.story.read(f.home, f.members[1]).personal.catchUp.length).toBeGreaterThan(0);
    expect(reopened.story.claimReward(f.home, f.user, 'wards-restored', capacity(s)).snapshot.personal.inventory.apples).toBe(2);
  });
  it('does not acknowledge newer events with an older board revision or give late-new members retroactive apples', () => {
    const f = fixture(); const s = f.wards().snapshot;
    f.emit({ kind: 'inspect', evidenceId: 'ada-journal' });
    expect(f.story.markSeen(f.home, f.user, s.story.revision).personal.catchUp).toHaveLength(1);
    const newcomer = f.store.createIdentity({ name: 'New member' }).profile.id;
    f.store.joinHome(f.home, newcomer, { pin: '123456' }); const late = f.story.read(f.home, newcomer);
    expect(late.story.chapter).toBe('inquiry'); expect(late.personal.catchUp.length).toBeGreaterThan(0); expect(late.personal.rewards).toEqual([]);
    expect(() => f.story.claimReward(f.home, newcomer, 'wards-restored', capacity(late))).toThrowError(expect.objectContaining({ code: 'REWARD_UNAVAILABLE' }));
  });
  it('rechecks membership, denies forged participants and isolates canonical homes', () => {
    const f = fixture(false, 2); f.wards();
    const other = f.store.createHome(f.user, { name: 'Other' }).id;
    expect(f.story.read(other, f.user).story.chapter).toBe('undiscovered');
    const outsider = f.store.createIdentity({ name: 'Outsider' }).profile.id;
    expect(() => f.defeat(STORY_GUARDIAN, f.user, [f.user, outsider])).toThrowError(expect.objectContaining({ code: 'ACCESS_DENIED' }));
    f.store.banMember(f.home, f.user, f.members[1]);
    expect(() => f.story.read(f.home, f.members[1])).toThrowError(expect.objectContaining({ code: 'ACCESS_DENIED' }));
    expect(() => f.emit({ kind: 'talk', npcId: 'witch-tansy-reed' }, f.members[1])).toThrowError(expect.objectContaining({ code: 'ACCESS_DENIED' }));
  });
  it('does not consume a denied defeat ID before contributors are reconciled', () => {
    const f = fixture(false, 2); f.emit({ kind: 'talk', npcId: 'wizard-orin-vale' });
    const revoked = f.members[1]; f.store.banMember(f.home, f.user, revoked);
    const event = { kind: 'encounter-defeated', eventId: 'reconciled-defeat', actorId: revoked, occurredAt: 90_000,
      encounterId: STORY_RAIDERS[0], defeatId: 'same-physical-life', participantIds: [revoked, f.user] } as const;
    expect(() => f.story.apply(f.home, { ...event, participantIds: [...event.participantIds] })).toThrowError(expect.objectContaining({ code: 'ACCESS_DENIED' }));
    expect(count(f.store.db, 'forest_story_defeats')).toBe(0);
    expect(() => f.story.apply(f.home, { ...event, actorId: f.user, participantIds: [...event.participantIds] })).toThrowError(expect.objectContaining({ code: 'ACCESS_DENIED' }));
    expect(count(f.store.db, 'forest_story_defeats')).toBe(0);
    expect(f.story.apply(f.home, { ...event, actorId: f.user, participantIds: [f.user] }).status).toBe('updated');
    expect(count(f.store.db, 'forest_story_defeats')).toBe(1);
  });
  it('fails closed on future versions and corrupt state instead of resetting story or mystery', () => {
    const f = fixture(); f.story.read(f.home, f.user);
    f.store.db.exec("UPDATE forest_adventure_schema SET version=99 WHERE component='shared-keeper-story'");
    expect(() => new SharedForestStoryStore(f.store.db, { canAccess: () => true })).toThrowError(expect.objectContaining({ code: 'UNSUPPORTED_VERSION' }));
    f.store.db.exec("UPDATE forest_adventure_schema SET version=1; UPDATE forest_story_state SET version=99");
    expect(() => f.story.read(f.home, f.user)).toThrowError(expect.objectContaining({ code: 'UNSUPPORTED_VERSION' }));
    f.store.db.exec('UPDATE forest_story_state SET version=1');
    const original = f.store.db.prepare('SELECT state_json FROM forest_story_state').get()!.state_json;
    f.store.db.prepare('UPDATE forest_story_state SET state_json=?').run(JSON.stringify({ version: 2 }));
    expect(() => f.story.read(f.home, f.user)).toThrowError(expect.objectContaining({ code: 'UNSUPPORTED_VERSION' }));
    f.store.db.prepare('UPDATE forest_story_state SET state_json=?').run(String(original));
    f.store.db.prepare('UPDATE forest_story_state SET private_json=?').run(JSON.stringify({ version: 1, culpritId: 'forged' }));
    expect(() => f.story.read(f.home, f.user)).toThrowError(expect.objectContaining({ code: 'CORRUPT_STATE' }));
    expect(count(f.store.db, 'forest_story_state')).toBe(1);
  });
  it('serializes simultaneous clue recovery by separate processes without lost shared progress', async () => {
    const f = fixture(true); f.emit({ kind: 'talk', npcId: 'wizard-orin-vale' });
    await concurrent(f.path, f.home, f.user, STORY_SEALS.slice(0, 2).map((id, n) => `return story.apply(home,{kind:'recover',supplyId:${JSON.stringify(id)},actorId:user,eventId:'parallel-clue-${n}',occurredAt:50000});`));
    expect(f.story.readAuthority(f.home)?.state.seals.sort()).toEqual([...STORY_SEALS.slice(0, 2)].sort());
  });
  it('serializes simultaneous personal claims by separate processes with exactly one award', async () => {
    const f = fixture(true); const s = f.wards().snapshot;
    const body = `return story.claimReward(home,user,'wards-restored',{inventoryRevision:${s.personal.inventory.revision},appleSlotAvailable:true});`;
    const results = await concurrent(f.path, f.home, f.user, [body, body]);
    expect(results.map(r => r.status).sort()).toEqual(['replayed', 'reward-claimed']);
    expect(f.story.read(f.home, f.user).personal.inventory.apples).toBe(3); expect(count(f.store.db, 'forest_story_reward_claims')).toBe(1);
  });
});
