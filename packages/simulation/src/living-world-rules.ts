import type { LanternRoadStage, LanternRoadView, LivingWorldSnapshot, NPCActionKind, NPCActionOffer, NPCRelationshipView, PotionEffect, PotionKind } from '../../contracts/src/living-world';
import { AUTHORED_FOREST_NPCS } from '../../config/src/forest-cast';
import { LIVING_WORLD_CONFIG as C, LIVING_WORLD_MERCHANTS, npcFearProfile } from '../../config/src/living-world';

export const LIVING_WORLD_NPCS: readonly string[] = [...AUTHORED_FOREST_NPCS.map(n => n.id), 'keeper-ada', 'orchard-worker-mara', 'washer-elsie', 'woodworker-bram', 'spirit-lumen', 'spirit-morrow', 'forest:0', 'forest:1', 'forest:2'];
export const isLivingWorldNpc = (id: string): boolean => LIVING_WORLD_NPCS.includes(id);
export const isPotionKind = (value: unknown): value is PotionKind => value === 'strength' || value === 'speed';
export const boundedTrust = (value: number): number => Math.max(-100, Math.min(100, Math.round(value)));
export const reputationForTrust = (trust: number): LivingWorldSnapshot['personal']['reputation'] => trust < -25 ? 'distrusted' : trust < 0 ? 'unsettled' : trust >= 20 ? 'trusted' : 'neighbour';

export interface NPCFearMemory {
  npcId: string;
  trust: number;
  trustAt: number;
  trustRecoverAt: number;
  fear: number;
  fearAt: number;
  fearExpiresAt: number;
  giftReadyAt: number;
  tradeGoodwillReadyAt: number;
}
export function newNpcMemory(npcId: string): NPCFearMemory {
  return { npcId, trust: 0, trustAt: 0, trustRecoverAt: 0, fear: 0, fearAt: 0, fearExpiresAt: 0, giftReadyAt: 0, tradeGoodwillReadyAt: 0 };
}
/** Positive relationships last; negative trust gradually heals on this NPC's
 * own memory clock, independently from temporary fear and the home's reputation. */
export function npcTrustAt(memory: NPCFearMemory, now: number): number {
  if (memory.trust >= 0) return memory.trust;
  if (now >= memory.trustRecoverAt) return 0;
  const duration = memory.trustRecoverAt - memory.trustAt;
  return duration <= 0 ? 0 : -Math.ceil(-memory.trust * Math.min(1, Math.max(0, (memory.trustRecoverAt - now) / duration)));
}
export function fearAt(memory: NPCFearMemory, now: number): number {
  if (now >= memory.fearExpiresAt || memory.fear === 0) return 0;
  const duration = memory.fearExpiresAt - memory.fearAt;
  return duration <= 0 ? 0 : Math.ceil(memory.fear * Math.min(1, Math.max(0, (memory.fearExpiresAt - now) / duration)));
}
export function relationshipView(memory: NPCFearMemory, now: number): NPCRelationshipView {
  const fear = fearAt(memory, now), { threshold } = npcFearProfile(memory.npcId);
  return { npcId: memory.npcId, trust: npcTrustAt(memory, now), fear, fearThreshold: threshold, afraid: fear >= threshold, fearExpiresAt: memory.fearExpiresAt, giftReadyAt: memory.giftReadyAt };
}
export function rememberHarm(memory: NPCFearMemory, now: number, direct: boolean): NPCFearMemory {
  const trust = boundedTrust(npcTrustAt(memory, now) - (direct ? 18 : 10)), memoryMs = npcFearProfile(memory.npcId).memoryMs;
  return { ...memory, trust, trustAt: now, trustRecoverAt: trust < 0 ? now + memoryMs : 0, fear: Math.min(100, fearAt(memory, now) + (direct ? 60 : 38)), fearAt: now, fearExpiresAt: now + memoryMs };
}
export function rememberGoodwill(memory: NPCFearMemory, now: number, amount: number, ceiling: number): NPCFearMemory {
  const current = npcTrustAt(memory, now), trust = current < ceiling ? Math.min(ceiling, current + amount) : current;
  return { ...memory, trust: boundedTrust(trust), trustAt: now, trustRecoverAt: trust < 0 ? memory.trustRecoverAt : 0 };
}
export function rememberKindness(memory: NPCFearMemory, now: number, amount: number): NPCFearMemory {
  const fear = Math.max(0, fearAt(memory, now) - amount);
  return { ...memory, fear, fearAt: now, fearExpiresAt: fear ? memory.fearExpiresAt : 0 };
}
export function activePotionEffects(effects: readonly PotionEffect[], now: number): PotionEffect[] {
  return effects.filter(effect => effect.expiresAt > now).map(effect => ({ ...effect }));
}
export function potionMultipliers(effects: readonly PotionEffect[], now: number): { damage: number; body: number; speed: number } {
  const active = new Set(activePotionEffects(effects, now).map(effect => effect.kind));
  return { damage: active.has('strength') ? C.strengthDamageMultiplier : 1, body: active.has('strength') ? C.strengthBodyMultiplier : 1, speed: active.has('speed') ? C.speedMultiplier : 1 };
}
export interface LanternRoadState { version: 1; stage: LanternRoadStage; discovered: boolean; revision: number; recoveryAt: number; retryAt: number; setbacks: number }
export function newLanternRoad(): LanternRoadState { return { version: 1, stage: 'endangered', discovered: false, revision: 1, recoveryAt: 0, retryAt: 0, setbacks: 0 }; }
export function lanternRoadView(state: LanternRoadState): LanternRoadView {
  const descriptions = {
    endangered: ['Mara’s lantern cart is stranded between the orchard and the pond. The ward roads need neighbours who look after one another.', 'Protect Mara and clear the roadside threat.'],
    escorting: ['The roadside threat has scattered. Mara needs company on the walk back to Bramblewick.', 'Escort Mara to the village.'],
    recovering: ['Mara reached shelter. An apple and a quiet moment will help her recover.', 'Give Mara an apple, or let her rest safely.'],
    complete: ['Mara and the lantern cart are safe. A light stays on for the next traveller, just as Ada taught the village.', 'Lantern Road is safe.'],
  } as const;
  return { id: 'lantern-road', incidentId: C.rescueIncidentId, title: 'Lantern Road', npcId: C.rescueNpcId, revision: state.revision, stage: state.stage, discovered: state.discovered, summary: state.discovered ? descriptions[state.stage][0] : '', objective: state.discovered ? descriptions[state.stage][1] : '', recoveryAt: state.recoveryAt, retryAt: state.retryAt, setbacks: state.setbacks };
}
export interface OfferDefinition { kind: NPCActionKind; label: string; disabledReason?: string; potion?: PotionKind; appleCost?: number }
/** Pure server-side offer building; durable opaque IDs are assigned by the store. */
export function livingWorldOfferDefinitions(snapshot: LivingWorldSnapshot, npcId: string): OfferDefinition[] {
  if (!isLivingWorldNpc(npcId)) return [];
  const { personal, rescue, serverTime } = snapshot;
  const memory = personal.relationships.find(r => r.npcId === npcId);
  const offers: OfferDefinition[] = [{ kind: 'talk', label: memory?.afraid ? 'Speak gently' : 'Talk' }];
  const stock = LIVING_WORLD_MERCHANTS[npcId as keyof typeof LIVING_WORLD_MERCHANTS] as readonly PotionKind[] | undefined;
  for (const potion of stock ?? []) {
    const disabledReason = memory?.afraid ? 'Give me a little space; I remember that violence.' : memory && memory.trust < -15 ? 'I need time and kindness before I can trust a trade.' : personal.trust < -25 ? 'Help your neighbours before asking to trade.' : personal.inventory.potions[potion] >= C.potionCapacity ? 'Your pocket already holds two doses.' : personal.inventory.apples < C.potionPrice ? 'This bottle costs two apples.' : undefined;
    offers.push({ kind: 'trade', label: `${potion === 'strength' ? 'Strength' : 'Speed'} potion · ${C.potionPrice} apples`, potion, appleCost: C.potionPrice, ...(disabledReason ? { disabledReason } : {}) });
  }
  const canHealRescue = npcId === C.rescueNpcId && rescue.stage === 'recovering';
  const giftBlocked = personal.inventory.apples < 1 ? 'You need an apple to give.' : !canHealRescue && memory && memory.giftReadyAt > serverTime ? 'Let the last kindness settle before giving again.' : undefined;
  offers.push({ kind: 'give', label: canHealRescue ? 'Give an apple to help Mara recover' : 'Give an apple', appleCost: 1, ...(giftBlocked ? { disabledReason: giftBlocked } : {}) });
  if (npcId === C.rescueNpcId && rescue.stage === 'endangered') offers.push({ kind: 'protect', label: 'Protect Mara', ...(rescue.retryAt > serverTime ? { disabledReason: 'Mara is finding her footing. Try again shortly.' } : {}) });
  if (npcId === C.rescueNpcId && rescue.stage === 'escorting') offers.push({ kind: 'escort', label: 'Walk Mara to Bramblewick' });
  if (npcId === C.rescueNpcId && personal.rewards.some(reward => reward.status === 'pending')) offers.push({ kind: 'claim-reward', label: 'Collect Mara’s speed tonic', potion: 'speed' });
  return offers;
}
export function offerMatches(a: Pick<NPCActionOffer, 'kind' | 'potion'>, b: OfferDefinition): boolean { return a.kind === b.kind && a.potion === b.potion; }
