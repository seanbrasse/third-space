import type { DatabaseSync } from 'node:sqlite';
import { createHash, randomInt } from 'node:crypto';
import type { ForestStorySnapshot, StoryRecap, StoryRewardView } from '../../contracts/src/forest-story.js';
import {
  FOREST_STORY_VERSION, STORY_GUARDIAN, STORY_RAIDERS, STORY_REWARDS, STORY_SUSPECTS, STORY_TALK_NPCS, STORY_SEALS, STORY_EVIDENCE,
  newSharedForestStory, restoreForestMystery, restoreSharedForestStory, stepSharedForestStory, forestStoryView,
  type ForestStoryEvent, type PrivateForestMystery, type SharedForestStoryState, type StoryMilestone, type StoryStep,
} from '../../simulation/src/forest-story.js';
import type { AppleMutation, RewardCapacity } from './forest-inventory-store-types.js';

export class ForestStoryStoreError extends Error {
  constructor(public readonly code: 'ACCESS_DENIED' | 'UNSUPPORTED_VERSION' | 'CORRUPT_STATE' | 'INVALID_EVENT' | 'EVENT_CONFLICT' | 'REWARD_UNAVAILABLE', message: string) { super(message); }
}
export interface ForestStoryMutation {
  status: StoryStep['status'] | 'replayed' | 'inventory-full' | 'inventory-conflict' | 'reward-claimed';
  message: string;
  snapshot: ForestStorySnapshot;
}
type Row = Record<string, unknown>;
interface Authority { state: SharedForestStoryState; mystery: PrivateForestMystery; revision: number }
const integer = (n: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= min && n <= max;
const key = (n: unknown, max = 200): n is string => typeof n === 'string' && n.length > 0 && n.length <= max && !/[\u0000-\u001f\u007f]/.test(n);
const milestoneIds = Object.keys(STORY_REWARDS) as StoryMilestone[];

/** Home-wide story authority. Inventory and reward claims remain personal. */
export class SharedForestStoryStore {
  constructor(private db: DatabaseSync, private options: {
    canAccess: (homeId: string, userId: string) => boolean;
    now?: () => number;
    /** Server/test dependency only. Never take a mystery seed or culprit from clients. */
    chooseCulprit?: () => string;
  }) {
    this.transaction(() => {
      this.db.exec('CREATE TABLE IF NOT EXISTS forest_adventure_schema(component TEXT PRIMARY KEY,version INTEGER NOT NULL)');
      const version = this.one('SELECT version FROM forest_adventure_schema WHERE component=?', 'shared-keeper-story');
      if (version && version.version !== FOREST_STORY_VERSION) throw new ForestStoryStoreError('UNSUPPORTED_VERSION', 'Shared story storage needs an explicit migration.');
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS forest_adventure_inventory(
          home_id TEXT NOT NULL REFERENCES homes(id),user_id TEXT NOT NULL REFERENCES profiles(id),
          version INTEGER NOT NULL,revision INTEGER NOT NULL CHECK(revision>=1),
          apples INTEGER NOT NULL CHECK(apples BETWEEN 0 AND 5),PRIMARY KEY(home_id,user_id)
        );
        CREATE TABLE IF NOT EXISTS forest_story_state(
          home_id TEXT PRIMARY KEY REFERENCES homes(id),version INTEGER NOT NULL,
          revision INTEGER NOT NULL CHECK(revision>=1),state_json TEXT NOT NULL,private_json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS forest_story_events(
          home_id TEXT NOT NULL REFERENCES homes(id),event_id TEXT NOT NULL,payload_hash TEXT NOT NULL,
          status TEXT NOT NULL,message TEXT NOT NULL,revision INTEGER NOT NULL,created_at INTEGER NOT NULL,
          recap TEXT,PRIMARY KEY(home_id,event_id)
        );
        CREATE INDEX IF NOT EXISTS forest_story_recap ON forest_story_events(home_id,revision);
        CREATE TABLE IF NOT EXISTS forest_story_defeats(
          home_id TEXT NOT NULL REFERENCES homes(id),encounter_id TEXT NOT NULL,defeat_id TEXT NOT NULL,
          event_id TEXT NOT NULL,status TEXT NOT NULL,PRIMARY KEY(home_id,encounter_id,defeat_id)
        );
        CREATE TABLE IF NOT EXISTS forest_story_milestones(
          home_id TEXT NOT NULL REFERENCES homes(id),milestone_id TEXT NOT NULL,version INTEGER NOT NULL,
          event_id TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(home_id,milestone_id,version)
        );
        CREATE TABLE IF NOT EXISTS forest_story_entitlements(
          home_id TEXT NOT NULL REFERENCES homes(id),user_id TEXT NOT NULL REFERENCES profiles(id),
          milestone_id TEXT NOT NULL,version INTEGER NOT NULL,created_at INTEGER NOT NULL,
          PRIMARY KEY(home_id,user_id,milestone_id,version)
        );
        CREATE TABLE IF NOT EXISTS forest_story_reward_claims(
          home_id TEXT NOT NULL REFERENCES homes(id),user_id TEXT NOT NULL REFERENCES profiles(id),
          milestone_id TEXT NOT NULL,version INTEGER NOT NULL,apples INTEGER NOT NULL,badge TEXT NOT NULL,
          created_at INTEGER NOT NULL,PRIMARY KEY(home_id,user_id,milestone_id,version)
        );
        CREATE TABLE IF NOT EXISTS forest_story_badges(
          home_id TEXT NOT NULL REFERENCES homes(id),user_id TEXT NOT NULL REFERENCES profiles(id),
          badge TEXT NOT NULL,milestone_id TEXT NOT NULL,PRIMARY KEY(home_id,user_id,badge)
        );
        CREATE TABLE IF NOT EXISTS forest_story_seen(
          home_id TEXT NOT NULL REFERENCES homes(id),user_id TEXT NOT NULL REFERENCES profiles(id),
          revision INTEGER NOT NULL,PRIMARY KEY(home_id,user_id)
        );
      `);
      this.db.prepare('INSERT OR IGNORE INTO forest_adventure_schema VALUES(?,?)').run('shared-keeper-story', FOREST_STORY_VERSION);
    });
  }

  read(homeId: string, userId: string): ForestStorySnapshot {
    return this.transaction(() => { this.requireAccess(homeId, userId); this.ensure(homeId, userId); return this.snapshot(homeId, userId); });
  }

  /** Internal encounter/actor gating only; this return value must never enter a broadcast. */
  readAuthority(homeId: string): Authority | undefined {
    if (!key(homeId)) throw new ForestStoryStoreError('INVALID_EVENT', 'Invalid canonical home.');
    if (!this.one('SELECT 1 AS present FROM forest_story_state WHERE home_id=?', homeId)) return undefined;
    return this.load(homeId);
  }

  /** Only trusted room events, after socket, world/life/zone, anchor/range/LOS checks. */
  apply(homeId: string, event: ForestStoryEvent): ForestStoryMutation {
    this.validateEvent(event);
    return this.transaction(() => {
      this.requireAccess(homeId, event.actorId); this.ensure(homeId, event.actorId);
      if (event.kind === 'encounter-defeated' && event.participantIds.some(id => !this.options.canAccess(homeId, id)))
        throw new ForestStoryStoreError('ACCESS_DENIED', 'An encounter participant is not admitted to this home.');
      // Retries may arrive with a fresh arrival time or object key order. Identity
      // and semantic payload, rather than receipt time, define the same event.
      const detail = event.kind === 'talk' ? [event.npcId] : event.kind === 'recover' ? [event.supplyId] :
        event.kind === 'inspect' ? [event.evidenceId] : event.kind === 'accuse' ? [event.suspectId] :
        event.kind === 'rescue' ? [event.npcId] : [event.encounterId, event.defeatId, [...event.participantIds].sort()];
      const fingerprint = createHash('sha256').update(JSON.stringify([event.actorId, event.kind, detail])).digest('hex');
      const prior = this.one('SELECT * FROM forest_story_events WHERE home_id=? AND event_id=?', homeId, event.eventId);
      if (prior) {
        if (prior.payload_hash !== fingerprint) throw new ForestStoryStoreError('EVENT_CONFLICT', 'The event ID was reused for a different event.');
        return { status: 'replayed', message: String(prior.message), snapshot: this.snapshot(homeId, event.actorId) };
      }
      if (event.kind === 'encounter-defeated' && this.one('SELECT 1 AS found FROM forest_story_defeats WHERE home_id=? AND encounter_id=? AND defeat_id=?', homeId, event.encounterId, event.defeatId))
        return { status: 'replayed', message: 'That encounter result is already recorded.', snapshot: this.snapshot(homeId, event.actorId) };
      const current = this.load(homeId), step = stepSharedForestStory(current.state, current.mystery, event);
      const changed = step.status === 'updated' || step.status === 'wrong-accusation';
      const revision = current.revision + (changed ? 1 : 0);
      if (changed) this.db.prepare('UPDATE forest_story_state SET revision=?,state_json=? WHERE home_id=?').run(revision, JSON.stringify(step.state), homeId);
      // Record attempts that could become meaningful in a later phase as well:
      // replaying an old early return must not advance newly-unlocked progress.
      // Completed encounters are monotonic and never farm new rows or rewards.
      const recordDefeat = event.kind === 'encounter-defeated' && step.status !== 'unchanged';
      const relevantTalk = event.kind !== 'talk' || (STORY_TALK_NPCS as readonly string[]).includes(event.npcId);
      const recordEvent = event.kind === 'encounter-defeated' ? recordDefeat : relevantTalk;
      if (recordEvent) {
        const profile = this.one('SELECT name FROM profiles WHERE id=?', event.actorId);
        const attribution = event.kind === 'encounter-defeated' && event.participantIds.length > 1 ? `${String(profile?.name ?? 'A member')} and companions` : String(profile?.name ?? 'A member');
        this.db.prepare('INSERT INTO forest_story_events VALUES(?,?,?,?,?,?,?,?)').run(homeId, event.eventId, fingerprint, step.status, step.message, revision, event.occurredAt, step.recap ? `${attribution}: ${step.recap}` : null);
      }
      if (event.kind === 'encounter-defeated' && recordDefeat) this.db.prepare('INSERT INTO forest_story_defeats VALUES(?,?,?,?,?)').run(homeId, event.encounterId, event.defeatId, event.eventId, step.status);
      for (const milestone of step.milestones) this.awardMilestone(homeId, milestone, event);
      return { status: step.status, message: step.message, snapshot: this.snapshot(homeId, event.actorId) };
    });
  }

  /** Receipt + badge + apple grant commit together; full pockets leave an entitlement waiting. */
  claimReward(homeId: string, userId: string, rewardId: string, capacity: RewardCapacity): ForestStoryMutation {
    if (!milestoneIds.includes(rewardId as StoryMilestone) || !integer(capacity.inventoryRevision, 1) || typeof capacity.appleSlotAvailable !== 'boolean')
      throw new ForestStoryStoreError('INVALID_EVENT', 'Invalid reward request.');
    return this.transaction(() => {
      this.requireAccess(homeId, userId); this.ensure(homeId, userId);
      const current = this.snapshot(homeId, userId);
      const entitlement = current.personal.rewards.find(r => r.id === rewardId);
      if (!entitlement) throw new ForestStoryStoreError('REWARD_UNAVAILABLE', 'This member did not earn that milestone reward.');
      if (entitlement.status === 'claimed') return { status: 'replayed', message: 'That reward is already in your story ledger.', snapshot: current };
      if (current.personal.inventory.revision !== capacity.inventoryRevision) return { status: 'inventory-conflict', message: 'Your inventory changed. Try again after it refreshes.', snapshot: current };
      if (!capacity.appleSlotAvailable || current.personal.inventory.apples + entitlement.apples > 5)
        return { status: 'inventory-full', message: `Make room for ${entitlement.apples} apple${entitlement.apples === 1 ? '' : 's'}; this reward will wait.`, snapshot: current };
      this.db.prepare('UPDATE forest_adventure_inventory SET apples=apples+?,revision=revision+1 WHERE home_id=? AND user_id=?').run(entitlement.apples, homeId, userId);
      this.db.prepare('INSERT INTO forest_story_reward_claims VALUES(?,?,?,?,?,?,?)').run(homeId, userId, rewardId, 1, entitlement.apples, entitlement.badge, this.now());
      this.db.prepare('INSERT INTO forest_story_badges VALUES(?,?,?,?)').run(homeId, userId, entitlement.badge, rewardId);
      return { status: 'reward-claimed', message: `${entitlement.title}: reward received.`, snapshot: this.snapshot(homeId, userId) };
    });
  }

  /** Same write-before-mutation hook as the earlier inventory module; no personal quest progress is involved. */
  changeApples(homeId: string, userId: string, mutation: AppleMutation): ForestStoryMutation {
    const { before, after, expectedRevision, cause } = mutation;
    if (!integer(before, 0, 5) || !integer(after, 0, 5) || !integer(expectedRevision, 1) || !(
      (cause === 'harvest' && after === before + 1) || (cause === 'eat' && after === before - 1) || (cause === 'death' && after === 0)
    )) throw new ForestStoryStoreError('INVALID_EVENT', 'Invalid apple mutation.');
    return this.transaction(() => {
      this.requireAccess(homeId, userId); this.ensure(homeId, userId);
      const current = this.snapshot(homeId, userId);
      if (current.personal.inventory.revision !== expectedRevision || current.personal.inventory.apples !== before)
        return { status: 'inventory-conflict', message: 'Your inventory changed. Refresh before using an apple.', snapshot: current };
      if (before === after) return { status: 'unchanged', message: 'Inventory unchanged.', snapshot: current };
      this.db.prepare('UPDATE forest_adventure_inventory SET apples=?,revision=revision+1 WHERE home_id=? AND user_id=?').run(after, homeId, userId);
      return { status: 'updated', message: 'Inventory saved.', snapshot: this.snapshot(homeId, userId) };
    });
  }

  markSeen(homeId: string, userId: string, revision: number): ForestStorySnapshot {
    return this.transaction(() => {
      this.requireAccess(homeId, userId); this.ensure(homeId, userId);
      const current = this.load(homeId);
      if (!integer(revision, 0, current.revision)) throw new ForestStoryStoreError('INVALID_EVENT', 'Invalid story acknowledgement.');
      this.db.prepare('INSERT INTO forest_story_seen VALUES(?,?,?) ON CONFLICT(home_id,user_id) DO UPDATE SET revision=max(revision,excluded.revision)').run(homeId, userId, revision);
      return this.snapshot(homeId, userId);
    });
  }

  private awardMilestone(homeId: string, milestone: StoryMilestone, event: ForestStoryEvent) {
    this.db.prepare('INSERT INTO forest_story_milestones VALUES(?,?,?,?,?)').run(homeId, milestone, 1, event.eventId, event.occurredAt);
    // Includes members who are offline. New members joining after this moment
    // inherit story progress and recap, but not already-earned personal rewards.
    const members = this.db.prepare("SELECT user_id FROM members WHERE home_id=? AND status='active'").all(homeId) as Row[];
    for (const member of members) {
      const id = String(member.user_id);
      if (this.options.canAccess(homeId, id)) this.db.prepare('INSERT INTO forest_story_entitlements VALUES(?,?,?,?,?)').run(homeId, id, milestone, 1, event.occurredAt);
    }
  }
  private snapshot(homeId: string, userId: string): ForestStorySnapshot {
    const a = this.load(homeId);
    const inventory = this.one('SELECT * FROM forest_adventure_inventory WHERE home_id=? AND user_id=?', homeId, userId)!;
    if (inventory.version !== 1) throw new ForestStoryStoreError('UNSUPPORTED_VERSION', 'Inventory needs an explicit migration.');
    if (!integer(inventory.apples, 0, 5) || !integer(inventory.revision, 1)) throw new ForestStoryStoreError('CORRUPT_STATE', 'Invalid durable inventory.');
    const recap = (this.db.prepare('SELECT event_id,created_at,recap,revision FROM forest_story_events WHERE home_id=? AND recap IS NOT NULL ORDER BY revision DESC LIMIT 64').all(homeId) as Row[]).reverse().map(r => ({ id: String(r.event_id), at: Number(r.created_at), text: String(r.recap), revision: Number(r.revision) } satisfies StoryRecap));
    const rewards: StoryRewardView[] = (this.db.prepare('SELECT * FROM forest_story_entitlements WHERE home_id=? AND user_id=? ORDER BY created_at,milestone_id').all(homeId, userId) as Row[]).map(row => {
      const id = String(row.milestone_id) as StoryMilestone, reward = STORY_REWARDS[id];
      if (row.version !== 1) throw new ForestStoryStoreError('UNSUPPORTED_VERSION', 'Story reward needs an explicit migration.');
      if (!reward || !this.one('SELECT 1 AS found FROM forest_story_milestones WHERE home_id=? AND milestone_id=? AND version=1', homeId, id)) throw new ForestStoryStoreError('CORRUPT_STATE', 'Unknown or unearned story reward.');
      const receipt = this.one('SELECT * FROM forest_story_reward_claims WHERE home_id=? AND user_id=? AND milestone_id=? AND version=1', homeId, userId, id);
      const badge = this.one('SELECT * FROM forest_story_badges WHERE home_id=? AND user_id=? AND badge=?', homeId, userId, reward.badge);
      if (!!receipt !== !!badge || (receipt && (receipt.apples !== reward.apples || receipt.badge !== reward.badge || badge?.milestone_id !== id))) throw new ForestStoryStoreError('CORRUPT_STATE', 'Story reward receipt and badge disagree.');
      return { id, ...reward, status: receipt ? 'claimed' : 'pending' };
    });
    const seen = Number(this.one('SELECT revision FROM forest_story_seen WHERE home_id=? AND user_id=?', homeId, userId)?.revision ?? 0);
    return { story: forestStoryView(a.state, a.mystery, a.revision, recap), personal: { inventory: { apples: inventory.apples, revision: inventory.revision }, badges: rewards.filter(r => r.status === 'claimed').map(r => r.badge), rewards, catchUp: recap.filter(r => r.revision > seen) } };
  }
  private ensure(homeId: string, userId: string) {
    this.db.prepare('INSERT OR IGNORE INTO forest_adventure_inventory VALUES(?,?,1,1,0)').run(homeId, userId);
    if (!this.one('SELECT 1 AS found FROM forest_story_state WHERE home_id=?', homeId)) {
      const culpritId = this.options.chooseCulprit?.() ?? STORY_SUSPECTS[randomInt(STORY_SUSPECTS.length)]!.id;
      const mystery = restoreForestMystery({ version: 1, culpritId });
      this.db.prepare('INSERT INTO forest_story_state VALUES(?,1,1,?,?)').run(homeId, JSON.stringify(newSharedForestStory()), JSON.stringify(mystery));
    }
  }
  private load(homeId: string): Authority {
    const row = this.one('SELECT * FROM forest_story_state WHERE home_id=?', homeId);
    if (!row) throw new ForestStoryStoreError('CORRUPT_STATE', 'Shared story is missing.');
    if (row.version !== 1) throw new ForestStoryStoreError('UNSUPPORTED_VERSION', 'Shared story needs an explicit migration.');
    if (!integer(row.revision, 1)) throw new ForestStoryStoreError('CORRUPT_STATE', 'Invalid shared story revision.');
    let raw: SharedForestStoryState, privateRaw: PrivateForestMystery;
    try { raw = JSON.parse(String(row.state_json)); privateRaw = JSON.parse(String(row.private_json)); }
    catch { throw new ForestStoryStoreError('CORRUPT_STATE', 'Stored shared story is invalid.'); }
    if (raw?.version !== 1 || privateRaw?.version !== 1) throw new ForestStoryStoreError('UNSUPPORTED_VERSION', 'Shared story needs an explicit migration.');
    let state: SharedForestStoryState, mystery: PrivateForestMystery;
    try { state = restoreSharedForestStory(raw); mystery = restoreForestMystery(privateRaw); }
    catch { throw new ForestStoryStoreError('CORRUPT_STATE', 'Stored shared story is inconsistent.'); }
    if (state.confirmedFace && state.confirmedFace !== mystery.culpritId) throw new ForestStoryStoreError('CORRUPT_STATE', 'Stored mystery does not match its resolution.');
    const required: StoryMilestone[] = [
      ...(['inquiry', 'rescue', 'complete'].includes(state.chapter) ? ['wards-restored' as const] : []),
      ...(state.chapter === 'complete' ? ['keeper-rescued' as const] : []),
      ...(state.sides.fairRind === 3 ? ['fair-rind' as const] : []), ...(state.sides.keptCup === 3 ? ['kept-cup' as const] : []),
    ];
    const earned = this.db.prepare('SELECT milestone_id,version FROM forest_story_milestones WHERE home_id=?').all(homeId) as Row[];
    if (earned.some(r => r.version !== 1)) throw new ForestStoryStoreError('UNSUPPORTED_VERSION', 'Story milestone needs an explicit migration.');
    if (earned.length !== required.length || earned.some(r => !required.includes(String(r.milestone_id) as StoryMilestone))) throw new ForestStoryStoreError('CORRUPT_STATE', 'Shared story and milestone ledger disagree.');
    return { state, mystery, revision: row.revision };
  }
  private validateEvent(event: ForestStoryEvent) {
    if (!event || !key(event.eventId, 160) || !key(event.actorId) || !integer(event.occurredAt)) throw new ForestStoryStoreError('INVALID_EVENT', 'Invalid authoritative story event.');
    const valid = event.kind === 'talk' ? key(event.npcId, 100) : event.kind === 'recover' ? (STORY_SEALS as readonly string[]).includes(event.supplyId) : event.kind === 'inspect' ? (STORY_EVIDENCE as readonly string[]).includes(event.evidenceId) : event.kind === 'accuse' ? STORY_SUSPECTS.some(s => s.id === event.suspectId) : event.kind === 'rescue' ? event.npcId === 'keeper-ada' : event.kind === 'encounter-defeated' ?
      [...STORY_RAIDERS, STORY_GUARDIAN].includes(event.encounterId) && key(event.defeatId, 160) && Array.isArray(event.participantIds) && event.participantIds.length >= 1 && event.participantIds.length <= 8 && event.participantIds.every(id => key(id)) && new Set(event.participantIds).size === event.participantIds.length && event.participantIds.includes(event.actorId) : false;
    if (!valid) throw new ForestStoryStoreError('INVALID_EVENT', 'Invalid authoritative story event details.');
  }
  private requireAccess(homeId: string, userId: string) {
    if (!key(homeId) || !key(userId) || !this.options.canAccess(homeId, userId)) throw new ForestStoryStoreError('ACCESS_DENIED', 'Current canonical home membership is required.');
  }
  private now() { return (this.options.now ?? Date.now)(); }
  private one(sql: string, ...params: (string | number)[]): Row | undefined { return this.db.prepare(sql).get(...params) as Row | undefined; }
  private transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
}
