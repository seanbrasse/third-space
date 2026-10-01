import type { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import type { LivingWorldMutation, LivingWorldReceipt, LivingWorldSnapshot, LivingWorldStatus, NPCActionOffer, NPCActionRequest, PotionEffect, PotionKind, PotionUseRequest } from '../../contracts/src/living-world.js';
import { LIVING_WORLD_CONFIG as C } from '../../config/src/living-world.js';
import { activePotionEffects, boundedTrust, isLivingWorldNpc, isPotionKind, lanternRoadView, livingWorldOfferDefinitions, newLanternRoad, newNpcMemory, offerMatches, relationshipView, rememberGoodwill, rememberHarm, rememberKindness, reputationForTrust, type LanternRoadState, type NPCFearMemory } from '../../simulation/src/living-world-rules.js';

type Row = Record<string, unknown>;
interface PersonalState { version: 1; trust: number; potions: Record<PotionKind, number>; effects: PotionEffect[]; useReadyAt: number; relationships: NPCFearMemory[] }
interface Personal { revision: number; state: PersonalState }
interface Outcome { status: LivingWorldStatus; message: string }
export interface RescueEventRequest { commandId: string; event: 'discovered' | 'protected' | 'escort-arrived' | 'setback'; incidentId?: string; participantIds?: string[] }
export interface WitnessedAttackRequest { commandId: string; targetNpcId: string; witnessNpcIds: string[] }
export interface WitnessedPlayerAttackRequest { commandId: string; targetUserId: string; witnessNpcIds: string[] }
export interface LivingWorldRewardRequest { commandId: string; expectedInventoryRevision: number; potionSlotAvailable: boolean }
export class LivingWorldStoreError extends Error {
  constructor(public readonly code: 'ACCESS_DENIED' | 'INVALID_EVENT' | 'EVENT_CONFLICT' | 'UNSUPPORTED_VERSION' | 'CORRUPT_STATE', message: string) { super(message); }
}
const integer = (n: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= min && n <= max;
const key = (value: unknown, max = 200): value is string => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
const invalid = (message = 'Invalid living-world command.'): never => { throw new LivingWorldStoreError('INVALID_EVENT', message); };
const corrupt = (): never => { throw new LivingWorldStoreError('CORRUPT_STATE', 'Invalid durable living-world state.'); };
const outcome = (status: LivingWorldStatus, message: string): Outcome => ({ status, message });

/** All commands must first pass room world/life/range/LOS gates. This store owns
 * membership, prices, capacity bounds, clocks, receipts, and atomic pocket writes. */
export class LivingWorldStore {
  constructor(private readonly db: DatabaseSync, private readonly options: { canAccess: (homeId: string, userId: string) => boolean; now?: () => number }) {
    this.transaction(() => {
      this.db.exec('CREATE TABLE IF NOT EXISTS forest_adventure_schema(component TEXT PRIMARY KEY,version INTEGER NOT NULL)');
      const version = this.one('SELECT version FROM forest_adventure_schema WHERE component=?', 'living-world');
      if (version && version.version !== C.version) throw new LivingWorldStoreError('UNSUPPORTED_VERSION', 'Living-world storage needs an explicit migration.');
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS forest_adventure_inventory(
          home_id TEXT NOT NULL REFERENCES homes(id),user_id TEXT NOT NULL REFERENCES profiles(id),
          version INTEGER NOT NULL,revision INTEGER NOT NULL CHECK(revision>=1),
          apples INTEGER NOT NULL CHECK(apples BETWEEN 0 AND 5),PRIMARY KEY(home_id,user_id)
        );
        CREATE TABLE IF NOT EXISTS living_world_personal(
          home_id TEXT NOT NULL REFERENCES homes(id),user_id TEXT NOT NULL REFERENCES profiles(id),
          version INTEGER NOT NULL,revision INTEGER NOT NULL CHECK(revision>=1),state_json TEXT NOT NULL,PRIMARY KEY(home_id,user_id)
        );
        CREATE TABLE IF NOT EXISTS living_world_rescue(
          home_id TEXT PRIMARY KEY REFERENCES homes(id),version INTEGER NOT NULL,state_json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS living_world_receipts(
          home_id TEXT NOT NULL REFERENCES homes(id),user_id TEXT NOT NULL REFERENCES profiles(id),
          command_id TEXT NOT NULL,payload_hash TEXT NOT NULL,receipt_json TEXT NOT NULL,
          PRIMARY KEY(home_id,user_id,command_id)
        );
        CREATE TABLE IF NOT EXISTS living_world_offers(
          home_id TEXT NOT NULL REFERENCES homes(id),user_id TEXT NOT NULL REFERENCES profiles(id),
          action_id TEXT NOT NULL,npc_id TEXT NOT NULL,offer_json TEXT NOT NULL,expires_at INTEGER NOT NULL,
          consumed INTEGER NOT NULL DEFAULT 0 CHECK(consumed IN (0,1)),PRIMARY KEY(home_id,user_id,action_id)
        );
        CREATE INDEX IF NOT EXISTS living_world_offer_npc ON living_world_offers(home_id,user_id,npc_id);
        CREATE TABLE IF NOT EXISTS living_world_deeds(
          home_id TEXT NOT NULL REFERENCES homes(id),user_id TEXT NOT NULL REFERENCES profiles(id),
          deed_id TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(home_id,user_id,deed_id)
        );
        CREATE TABLE IF NOT EXISTS living_world_rewards(
          home_id TEXT NOT NULL REFERENCES homes(id),user_id TEXT NOT NULL REFERENCES profiles(id),
          reward_id TEXT NOT NULL,created_at INTEGER NOT NULL,claimed_at INTEGER,
          PRIMARY KEY(home_id,user_id,reward_id)
        );
      `);
      this.db.prepare('INSERT OR IGNORE INTO forest_adventure_schema VALUES(?,?)').run('living-world', C.version);
    });
  }

  read(homeId: string, userId: string): LivingWorldSnapshot {
    return this.transaction(() => { this.requireAccess(homeId, userId); this.ensure(homeId, userId); return this.snapshot(homeId, userId, this.now()); });
  }

  /** Stable unconsumed offers are reused until expiry; every execution revalidates. */
  offers(homeId: string, userId: string, npcId: string): NPCActionOffer[] {
    return this.transaction(() => {
      this.requireAccess(homeId, userId);
      if (!isLivingWorldNpc(npcId)) return invalid('Unknown resident.');
      this.ensure(homeId, userId);
      const now = this.now(), snapshot = this.snapshot(homeId, userId, now);
      // Receipts remain durable. Expired unused capabilities do not accumulate.
      this.db.prepare('DELETE FROM living_world_offers WHERE home_id=? AND user_id=? AND expires_at<=?').run(homeId, userId, now);
      const existing = (this.db.prepare('SELECT offer_json,consumed FROM living_world_offers WHERE home_id=? AND user_id=? AND npc_id=?').all(homeId, userId, npcId) as Row[]);
      return livingWorldOfferDefinitions(snapshot, npcId).map(definition => {
        const prior = existing.find(row => {
          const offer = this.parse(row.offer_json) as NPCActionOffer;
          return row.consumed === 0 && offerMatches(offer, definition) && offer.disabledReason === definition.disabledReason;
        });
        if (prior) return this.parse(prior.offer_json) as NPCActionOffer;
        const offer: NPCActionOffer = { ...definition, actionId: randomUUID(), npcId, expiresAt: now + C.offerDurationMs };
        this.db.prepare('INSERT INTO living_world_offers VALUES(?,?,?,?,?,?,0)').run(homeId, userId, offer.actionId, npcId, JSON.stringify(offer), offer.expiresAt);
        return offer;
      });
    });
  }

  act(homeId: string, userId: string, request: NPCActionRequest): LivingWorldMutation {
    if (!request || !key(request.actionId, 160) || !integer(request.expectedInventoryRevision, 1) || (request.npcId !== undefined && !isLivingWorldNpc(request.npcId)) || (request.potionSlotAvailable !== undefined && typeof request.potionSlotAvailable !== 'boolean')) return invalid();
    return this.execute(homeId, userId, request.commandId, ['action', request.actionId, request.expectedInventoryRevision, request.npcId ?? null], request.actionId, now => {
      const row = this.one('SELECT * FROM living_world_offers WHERE home_id=? AND user_id=? AND action_id=?', homeId, userId, request.actionId);
      if (!row || Number(row.expires_at) <= now) return outcome('blocked', 'That offer expired. Speak to the neighbour again.');
      if (request.npcId !== undefined && request.npcId !== row.npc_id) return outcome('blocked', 'That offer belongs to a different neighbour.');
      if (row.consumed === 1) return outcome('unchanged', 'That action already has a receipt.');
      const offer = this.parse(row.offer_json) as NPCActionOffer;
      this.db.prepare('UPDATE living_world_offers SET consumed=1 WHERE home_id=? AND user_id=? AND action_id=?').run(homeId, userId, request.actionId);
      const snapshot = this.snapshot(homeId, userId, now);
      const current = livingWorldOfferDefinitions(snapshot, offer.npcId).find(definition => offerMatches(offer, definition));
      if (!current) return outcome('blocked', 'That neighbour has a different need now.');
      if (current.disabledReason) return outcome('blocked', current.disabledReason);
      if (['trade', 'give', 'claim-reward'].includes(offer.kind) && snapshot.personal.inventory.revision !== request.expectedInventoryRevision)
        return outcome('inventory-conflict', 'Your pockets changed. Refresh before trying again.');
      if (offer.kind === 'claim-reward') return this.claim(homeId, userId, request.expectedInventoryRevision, request.potionSlotAvailable === true, now);
      if (offer.kind === 'talk') {
        if ([C.rescueNpcId, 'wizard-orin-vale', 'innkeeper-nessa'].includes(offer.npcId)) this.discover(homeId);
        return outcome('updated', 'The neighbour is ready to talk.');
      }
      if (offer.kind === 'protect' || offer.kind === 'escort') {
        this.discover(homeId);
        return outcome('updated', offer.kind === 'protect' ? 'Stay near Mara and protect her from the roadside threat.' : 'Keep Mara company until she reaches Bramblewick.');
      }
      const personal = this.loadPersonal(homeId, userId), memory = this.memory(personal.state, offer.npcId);
      if (offer.kind === 'trade' && current.potion) {
        if (request.potionSlotAvailable !== true) return outcome('inventory-full', 'Make room in your five pockets for this bottle.');
        personal.state.potions[current.potion] += 1;
        if (memory.tradeGoodwillReadyAt <= now) {
          if (personal.state.trust < 0) personal.state.trust = Math.min(0, personal.state.trust + 2);
          Object.assign(memory, rememberGoodwill(memory, now, 2, 0));
          memory.tradeGoodwillReadyAt = now + C.tradeGoodwillCooldownMs;
        }
        this.changeInventory(homeId, userId, -C.potionPrice);
        this.savePersonal(homeId, userId, personal);
        return outcome('updated', `Traded two apples for one ${current.potion} potion.`);
      }
      if (offer.kind === 'give') {
        const rescue = this.loadRescue(homeId), healing = offer.npcId === C.rescueNpcId && rescue.stage === 'recovering';
        Object.assign(memory, rememberKindness(memory, now, 25), { giftReadyAt: now + C.giftCooldownMs });
        Object.assign(memory, rememberGoodwill(memory, now, 5, 30));
        if (personal.state.trust < 10) personal.state.trust = Math.min(10, personal.state.trust + 5);
        this.changeInventory(homeId, userId, -1);
        this.savePersonal(homeId, userId, personal);
        if (healing) this.completeRescue(homeId, rescue, now);
        return outcome('updated', healing ? 'Mara recovered. Lantern Road is safe, and her thank-you tonic is waiting.' : 'The apple is received. A small kindness makes room for trust.');
      }
      return outcome('blocked', 'That action needs an authoritative world event.');
    });
  }

  usePotion(homeId: string, userId: string, request: PotionUseRequest): LivingWorldMutation {
    if (!request || !isPotionKind(request.potion) || !integer(request.expectedInventoryRevision, 1) || (request.equipped !== undefined && typeof request.equipped !== 'boolean')) return invalid();
    return this.execute(homeId, userId, request.commandId, ['use-potion', request.potion, request.expectedInventoryRevision], undefined, now => {
      if (request.equipped === false) return outcome('blocked', 'Equip that potion first.');
      const inventory = this.inventory(homeId, userId), personal = this.loadPersonal(homeId, userId);
      if (inventory.revision !== request.expectedInventoryRevision) return outcome('inventory-conflict', 'Your pockets changed. Refresh before using that potion.');
      if (personal.state.effects.some(effect => effect.kind === request.potion && effect.expiresAt > now)) return outcome('blocked', 'That potion is still active; another dose cannot extend it.');
      if (personal.state.useReadyAt > now) return outcome('blocked', 'Wait a moment before drinking another potion.');
      if (personal.state.potions[request.potion] < 1) return outcome('blocked', 'There is no dose of that potion in your pockets.');
      personal.state.potions[request.potion] -= 1;
      personal.state.effects = [...activePotionEffects(personal.state.effects, now), { kind: request.potion, startedAt: now, expiresAt: now + C.potionDurationMs }];
      personal.state.useReadyAt = now + C.potionUseCooldownMs;
      this.changeInventory(homeId, userId, 0);
      this.savePersonal(homeId, userId, personal);
      return outcome('updated', `${request.potion === 'strength' ? 'Strength' : 'Speed'} lasts twenty seconds.`);
    });
  }

  /** Room invokes this only for one verified physical hit, with visible witnesses. */
  witnessAttack(homeId: string, userId: string, request: WitnessedAttackRequest, persistIncident?: () => void): LivingWorldMutation {
    if (!request || !isLivingWorldNpc(request.targetNpcId) || !Array.isArray(request.witnessNpcIds) || request.witnessNpcIds.length > 32 || request.witnessNpcIds.some(id => !isLivingWorldNpc(id)) || new Set(request.witnessNpcIds).size !== request.witnessNpcIds.length) return invalid();
    return this.execute(homeId, userId, request.commandId, ['attack', request.targetNpcId, [...request.witnessNpcIds].sort()], undefined, now => {
      const personal = this.loadPersonal(homeId, userId);
      const witnesses = request.witnessNpcIds.filter(id => id !== request.targetNpcId);
      personal.state.trust = boundedTrust(personal.state.trust - 18 - Math.min(12, witnesses.length * 3));
      for (const npcId of new Set([request.targetNpcId, ...witnesses])) {
        const memory = this.memory(personal.state, npcId);
        Object.assign(memory, rememberHarm(memory, now, npcId === request.targetNpcId));
      }
      this.savePersonal(homeId, userId, personal);
      // Trusted room hook joins this transaction; failure rolls back both memories before any physical hit.
      persistIncident?.();
      return outcome('updated', witnesses.length ? 'The neighbours saw that violence. Trust has fallen.' : 'The neighbour remembers being hurt. Trust has fallen.');
    });
  }

  /** Called after one verified PvP hit with server-observed line-of-sight witnesses.
   * The victim's personal state is never changed by the attacker's reputation. */
  witnessPlayerAttack(homeId: string, userId: string, request: WitnessedPlayerAttackRequest): LivingWorldMutation {
    if (!request || !key(request.targetUserId) || request.targetUserId === userId || !Array.isArray(request.witnessNpcIds) || request.witnessNpcIds.length > 32 || request.witnessNpcIds.some(id => !isLivingWorldNpc(id)) || new Set(request.witnessNpcIds).size !== request.witnessNpcIds.length) return invalid();
    return this.execute(homeId, userId, request.commandId, ['player-attack', request.targetUserId, [...request.witnessNpcIds].sort()], undefined, now => {
      if (!request.witnessNpcIds.length) return outcome('unchanged', 'No neighbour witnessed that fight.');
      const personal = this.loadPersonal(homeId, userId);
      personal.state.trust = boundedTrust(personal.state.trust - 18 - Math.min(12, request.witnessNpcIds.length * 3));
      for (const npcId of request.witnessNpcIds) {
        const memory = this.memory(personal.state, npcId);
        Object.assign(memory, rememberHarm(memory, now, false));
      }
      this.savePersonal(homeId, userId, personal);
      return outcome('updated', 'The neighbours saw you hurt another member. Trust has fallen.');
    }, [request.targetUserId]);
  }

  /** Event IDs come from the room's physical rescue attempt, never from clients. */
  advanceRescue(homeId: string, userId: string, request: RescueEventRequest): LivingWorldMutation {
    if (!request || !['discovered', 'protected', 'escort-arrived', 'setback'].includes(request.event) || (request.incidentId !== undefined && request.incidentId !== C.rescueIncidentId)) return invalid();
    const participants = request.participantIds ?? [userId];
    if (!Array.isArray(participants) || participants.length > 8 || participants.some(id => !key(id)) || new Set(participants).size !== participants.length || (['protected', 'escort-arrived'].includes(request.event) && !participants.includes(userId))) return invalid('Invalid rescue participants.');
    return this.execute(homeId, userId, request.commandId, ['rescue', request.event, C.rescueIncidentId, [...participants].sort()], undefined, now => {
      const rescue = this.loadRescue(homeId);
      if (request.event === 'discovered') { const changed = this.discover(homeId); return outcome(changed ? 'updated' : 'unchanged', 'Mara needs help on Lantern Road.'); }
      if (rescue.stage === 'complete') return outcome('unchanged', 'Lantern Road is already safe.');
      if (request.event === 'setback') {
        rescue.stage = 'endangered'; rescue.discovered = true; rescue.recoveryAt = 0; rescue.retryAt = now + C.rescueRetryMs; rescue.setbacks = Math.min(1_000_000, rescue.setbacks + 1);
        this.saveRescue(homeId, rescue);
        return outcome('updated', 'Mara found shelter and will try again. The home can still bring her back.');
      }
      // The runtime already observed the completed protection after its physical
      // retry delay. A delayed queue commit must not restart that delay here.
      if (request.event === 'protected' && rescue.stage === 'endangered') {
        rescue.stage = 'escorting'; rescue.discovered = true; rescue.retryAt = 0;
        this.saveRescue(homeId, rescue);
        for (const participant of participants) { this.ensure(homeId, participant); this.rescueGoodwill(homeId, participant, 'lantern-road-protected', now); }
        return outcome('updated', 'The threat is clear. Walk with Mara to Bramblewick.');
      }
      if (request.event === 'escort-arrived' && rescue.stage === 'escorting') {
        rescue.stage = 'recovering'; rescue.recoveryAt = now + C.rescueRecoveryMs;
        this.saveRescue(homeId, rescue);
        for (const participant of participants) { this.ensure(homeId, participant); this.rescueGoodwill(homeId, participant, 'lantern-road-escorted', now); }
        return outcome('updated', 'Mara reached Bramblewick. An apple or a safe rest will help her recover.');
      }
      return outcome('blocked', 'The road has not reached that part of the rescue.');
    }, participants);
  }

  claimReward(homeId: string, userId: string, request: LivingWorldRewardRequest): LivingWorldMutation {
    if (!request || !integer(request.expectedInventoryRevision, 1) || typeof request.potionSlotAvailable !== 'boolean') return invalid();
    return this.execute(homeId, userId, request.commandId, ['reward', request.expectedInventoryRevision], undefined, now => this.claim(homeId, userId, request.expectedInventoryRevision, request.potionSlotAvailable, now));
  }

  private claim(homeId: string, userId: string, expectedRevision: number, hasRoom: boolean, now: number): Outcome {
    const reward = this.one('SELECT * FROM living_world_rewards WHERE home_id=? AND user_id=? AND reward_id=?', homeId, userId, 'lantern-road-safe');
    if (!reward) return outcome('blocked', 'There is no rescue reward waiting.');
    if (reward.claimed_at !== null) return outcome('unchanged', 'Mara’s thank-you tonic is already in your ledger.');
    const personal = this.loadPersonal(homeId, userId), inventory = this.inventory(homeId, userId);
    if (inventory.revision !== expectedRevision) return outcome('inventory-conflict', 'Your pockets changed. The tonic will wait.');
    if (!hasRoom || personal.state.potions.speed >= C.potionCapacity) return outcome('inventory-full', 'Make room for a speed tonic; Mara will keep it safe.');
    personal.state.potions.speed += 1;
    this.changeInventory(homeId, userId, 0);
    this.savePersonal(homeId, userId, personal);
    this.db.prepare('UPDATE living_world_rewards SET claimed_at=? WHERE home_id=? AND user_id=? AND reward_id=?').run(now, homeId, userId, 'lantern-road-safe');
    return outcome('updated', 'Mara’s speed tonic is in your pocket. Lantern Road remembers your home’s help.');
  }

  private execute(homeId: string, userId: string, commandId: string, detail: unknown[], actionId: string | undefined, action: (now: number) => Outcome, participants: readonly string[] = []): LivingWorldMutation {
    if (!key(commandId, 160)) return invalid();
    return this.transaction(() => {
      this.requireAccess(homeId, userId);
      for (const participant of participants) this.requireAccess(homeId, participant);
      this.ensure(homeId, userId);
      const now = this.now(), hash = createHash('sha256').update(JSON.stringify(detail)).digest('hex');
      const prior = this.one('SELECT * FROM living_world_receipts WHERE home_id=? AND user_id=? AND command_id=?', homeId, userId, commandId);
      if (prior) {
        if (prior.payload_hash !== hash) throw new LivingWorldStoreError('EVENT_CONFLICT', 'The command ID already identifies a different action.');
        return { receipt: this.parse(prior.receipt_json) as LivingWorldReceipt, replayed: true, snapshot: this.snapshot(homeId, userId, now) };
      }
      this.settleRecovery(homeId, now);
      const result = action(now), snapshot = this.snapshot(homeId, userId, now);
      const receipt: LivingWorldReceipt = { commandId, ...(actionId ? { actionId } : {}), ...result, at: now, inventoryRevision: snapshot.personal.inventory.revision };
      this.db.prepare('INSERT INTO living_world_receipts VALUES(?,?,?,?,?)').run(homeId, userId, commandId, hash, JSON.stringify(receipt));
      return { receipt, replayed: false, snapshot };
    });
  }

  private snapshot(homeId: string, userId: string, now: number): LivingWorldSnapshot {
    this.settleRecovery(homeId, now);
    const personal = this.loadPersonal(homeId, userId), inventory = this.inventory(homeId, userId);
    const rewards = this.db.prepare('SELECT * FROM living_world_rewards WHERE home_id=? AND user_id=?').all(homeId, userId) as Row[];
    if (rewards.some(reward => reward.reward_id !== 'lantern-road-safe' || !integer(reward.created_at) || (reward.claimed_at !== null && !integer(reward.claimed_at)))) return corrupt();
    return { revision: personal.revision, serverTime: now, personal: {
      trust: personal.state.trust, reputation: reputationForTrust(personal.state.trust),
      inventory: { ...inventory, potions: { ...personal.state.potions } },
      effects: activePotionEffects(personal.state.effects, now), useReadyAt: personal.state.useReadyAt,
      relationships: personal.state.relationships.map(memory => relationshipView(memory, now)),
      badges: rewards.length ? ['lantern-road-neighbour'] : [],
      rewards: rewards.map(reward => ({ id: 'lantern-road-safe', potion: 'speed', doses: 1, status: reward.claimed_at === null ? 'pending' : 'claimed' })),
    }, rescue: lanternRoadView(this.loadRescue(homeId)) };
  }
  private ensure(homeId: string, userId: string) {
    this.db.prepare('INSERT OR IGNORE INTO forest_adventure_inventory VALUES(?,?,1,1,0)').run(homeId, userId);
    const initial: PersonalState = { version: 1, trust: 0, potions: { strength: 0, speed: 0 }, effects: [], useReadyAt: 0, relationships: [] };
    this.db.prepare('INSERT OR IGNORE INTO living_world_personal VALUES(?,?,1,1,?)').run(homeId, userId, JSON.stringify(initial));
    this.db.prepare('INSERT OR IGNORE INTO living_world_rescue VALUES(?,1,?)').run(homeId, JSON.stringify(newLanternRoad()));
  }
  private inventory(homeId: string, userId: string): { apples: number; revision: number } {
    const row = this.one('SELECT * FROM forest_adventure_inventory WHERE home_id=? AND user_id=?', homeId, userId)!;
    if (row.version !== 1) throw new LivingWorldStoreError('UNSUPPORTED_VERSION', 'Inventory storage needs an explicit migration.');
    if (!integer(row.apples, 0, 5) || !integer(row.revision, 1)) return corrupt();
    return { apples: row.apples, revision: row.revision };
  }
  private loadPersonal(homeId: string, userId: string): Personal {
    const row = this.one('SELECT * FROM living_world_personal WHERE home_id=? AND user_id=?', homeId, userId)!;
    const state = this.parse(row.state_json) as PersonalState;
    if (row.version !== 1 || state?.version !== 1) throw new LivingWorldStoreError('UNSUPPORTED_VERSION', 'Personal living-world storage needs an explicit migration.');
    // Additive compatibility for memories saved before individual trust existed.
    if (Array.isArray(state.relationships)) for (const memory of state.relationships) {
      if (memory && memory.trust === undefined) { memory.trust = 0; memory.trustAt = 0; memory.trustRecoverAt = 0; }
    }
    if (!integer(row.revision, 1) || !integer(state.trust, -100, 100) || !state.potions || !integer(state.potions.strength, 0, C.potionCapacity) || !integer(state.potions.speed, 0, C.potionCapacity) || !integer(state.useReadyAt) || !Array.isArray(state.effects) || state.effects.length > 2 || new Set(state.effects.map(effect => effect?.kind)).size !== state.effects.length || state.effects.some(effect => !effect || !isPotionKind(effect.kind) || !integer(effect.startedAt) || !integer(effect.expiresAt) || effect.expiresAt - effect.startedAt !== C.potionDurationMs) || !Array.isArray(state.relationships) || state.relationships.length > 64 || new Set(state.relationships.map(memory => memory?.npcId)).size !== state.relationships.length || state.relationships.some(memory => !memory || !isLivingWorldNpc(memory.npcId) || !integer(memory.trust, -100, 100) || !integer(memory.trustAt) || !integer(memory.trustRecoverAt) || (memory.trust < 0 && memory.trustRecoverAt <= memory.trustAt) || !integer(memory.fear, 0, 100) || !integer(memory.fearAt) || !integer(memory.fearExpiresAt) || !integer(memory.giftReadyAt) || !integer(memory.tradeGoodwillReadyAt) || (memory.fear > 0 && memory.fearExpiresAt <= memory.fearAt))) return corrupt();
    return { revision: row.revision, state };
  }
  private loadRescue(homeId: string): LanternRoadState {
    const row = this.one('SELECT * FROM living_world_rescue WHERE home_id=?', homeId)!;
    const state = this.parse(row.state_json) as LanternRoadState;
    if (row.version !== 1 || state?.version !== 1) throw new LivingWorldStoreError('UNSUPPORTED_VERSION', 'Lantern Road storage needs an explicit migration.');
    if (!['endangered', 'escorting', 'recovering', 'complete'].includes(state.stage) || typeof state.discovered !== 'boolean' || !integer(state.revision, 1) || !integer(state.recoveryAt) || !integer(state.retryAt) || !integer(state.setbacks, 0, 1_000_000) || (state.stage !== 'endangered' && !state.discovered) || (state.stage === 'recovering' && !state.recoveryAt)) return corrupt();
    return state;
  }
  private savePersonal(homeId: string, userId: string, personal: Personal) {
    this.db.prepare('UPDATE living_world_personal SET revision=revision+1,state_json=? WHERE home_id=? AND user_id=?').run(JSON.stringify(personal.state), homeId, userId);
  }
  private changeInventory(homeId: string, userId: string, appleDelta: number) {
    this.db.prepare('UPDATE forest_adventure_inventory SET apples=apples+?,revision=revision+1 WHERE home_id=? AND user_id=?').run(appleDelta, homeId, userId);
  }
  private memory(state: PersonalState, npcId: string): NPCFearMemory {
    let memory = state.relationships.find(row => row.npcId === npcId);
    if (!memory) { memory = newNpcMemory(npcId); state.relationships.push(memory); }
    return memory;
  }
  private discover(homeId: string): boolean {
    const state = this.loadRescue(homeId);
    if (state.discovered) return false;
    state.discovered = true; this.saveRescue(homeId, state); return true;
  }
  private saveRescue(homeId: string, state: LanternRoadState) {
    state.revision += 1;
    this.db.prepare('UPDATE living_world_rescue SET state_json=? WHERE home_id=?').run(JSON.stringify(state), homeId);
  }
  private settleRecovery(homeId: string, now: number) {
    const state = this.loadRescue(homeId);
    if (state.stage === 'recovering' && state.recoveryAt <= now) this.completeRescue(homeId, state, now);
  }
  private completeRescue(homeId: string, state: LanternRoadState, now: number) {
    if (state.stage === 'complete') return;
    state.stage = 'complete'; state.discovered = true; state.recoveryAt = 0; state.retryAt = 0;
    this.saveRescue(homeId, state);
    const members = this.db.prepare("SELECT user_id FROM members WHERE home_id=? AND status='active'").all(homeId) as Row[];
    for (const member of members) {
      const userId = String(member.user_id);
      if (this.options.canAccess(homeId, userId)) this.db.prepare('INSERT OR IGNORE INTO living_world_rewards VALUES(?,?,?,?,NULL)').run(homeId, userId, 'lantern-road-safe', now);
    }
  }
  private rescueGoodwill(homeId: string, userId: string, deed: string, now: number) {
    const inserted = this.db.prepare('INSERT OR IGNORE INTO living_world_deeds VALUES(?,?,?,?)').run(homeId, userId, deed, now);
    if (!inserted.changes) return;
    const personal = this.loadPersonal(homeId, userId), memory = this.memory(personal.state, C.rescueNpcId);
    personal.state.trust = boundedTrust(personal.state.trust + 10);
    Object.assign(memory, rememberKindness(memory, now, 40));
    Object.assign(memory, rememberGoodwill(memory, now, 8, 100));
    this.savePersonal(homeId, userId, personal);
  }
  private requireAccess(homeId: string, userId: string) {
    if (!key(homeId) || !key(userId) || !this.options.canAccess(homeId, userId)) throw new LivingWorldStoreError('ACCESS_DENIED', 'Current canonical home membership is required.');
  }
  private now(): number { const now = (this.options.now ?? Date.now)(); if (!integer(now, 0, Number.MAX_SAFE_INTEGER - 1_000_000)) return invalid('Invalid authoritative clock.'); return now; }
  private parse(raw: unknown): unknown { try { return JSON.parse(String(raw)); } catch { return corrupt(); } }
  private one(sql: string, ...params: (string | number)[]): Row | undefined { return this.db.prepare(sql).get(...params) as Row | undefined; }
  private transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
}
