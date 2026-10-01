/** Public, personal living-world state. Never contains the keeper mystery. */
export type PotionKind = 'strength' | 'speed';
export type NPCActionKind = 'talk' | 'trade' | 'give' | 'protect' | 'escort' | 'attack' | 'claim-reward';
export interface NPCActionOffer {
  /** Opaque, server-issued capability scoped to one home, member and NPC. */
  actionId: string;
  npcId: string;
  kind: NPCActionKind;
  label: string;
  expiresAt: number;
  disabledReason?: string;
  potion?: PotionKind;
  appleCost?: number;
}
export interface PotionEffect {
  kind: PotionKind;
  startedAt: number;
  expiresAt: number;
}
export interface NPCRelationshipView {
  npcId: string;
  trust: number;
  fear: number;
  fearThreshold: number;
  afraid: boolean;
  /** The memory naturally ends at this server timestamp. */
  fearExpiresAt: number;
  giftReadyAt: number;
}
export type LanternRoadStage = 'endangered' | 'escorting' | 'recovering' | 'complete';
export interface LanternRoadView {
  id: 'lantern-road';
  incidentId: 'lantern-road-v1';
  title: 'Lantern Road';
  npcId: 'orchard-worker-mara';
  revision: number;
  stage: LanternRoadStage;
  discovered: boolean;
  summary: string;
  objective: string;
  recoveryAt: number;
  retryAt: number;
  setbacks: number;
}
export interface LivingWorldSnapshot {
  /** Personal revision; inventory and rescue also have their own revisions. */
  revision: number;
  serverTime: number;
  personal: {
    trust: number;
    reputation: 'distrusted' | 'unsettled' | 'neighbour' | 'trusted';
    inventory: { apples: number; revision: number; potions: Record<PotionKind, number> };
    effects: PotionEffect[];
    useReadyAt: number;
    relationships: NPCRelationshipView[];
    badges: string[];
    rewards: { id: 'lantern-road-safe'; potion: PotionKind; doses: number; status: 'pending' | 'claimed' }[];
  };
  rescue: LanternRoadView;
}
export type LivingWorldStatus = 'updated' | 'unchanged' | 'blocked' | 'inventory-conflict' | 'inventory-full';
export interface LivingWorldReceipt {
  commandId: string;
  actionId?: string;
  status: LivingWorldStatus;
  message: string;
  at: number;
  inventoryRevision: number;
}
export interface LivingWorldMutation {
  /** Original durable receipt, plus a fresh authoritative snapshot on replay. */
  receipt: LivingWorldReceipt;
  replayed: boolean;
  snapshot: LivingWorldSnapshot;
}
export interface NPCActionRequest {
  commandId: string;
  actionId: string;
  /** Room-validated nearby canonical NPC; binds retries to the same recipient. */
  npcId?: string;
  expectedInventoryRevision: number;
  /** Room-owned five-slot capacity check. Never trust the client's value. */
  potionSlotAvailable?: boolean;
}
export interface PotionUseRequest {
  commandId: string;
  potion: PotionKind;
  expectedInventoryRevision: number;
  /** Room-derived equipment check. Replays retain their original outcome. */
  equipped?: boolean;
}
