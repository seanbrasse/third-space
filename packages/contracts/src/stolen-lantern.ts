export type StolenLanternStage = 'quiet' | 'ask-pip' | 'find-cave' | 'return-lantern' | 'complete';
export type StolenLanternAction = 'begin' | 'ask-pip' | 'recover' | 'return' | 'ward' | 'restitute' | 'claim';
export interface StolenLanternIncident { npcId:string; reason:string; at:number; resolvedAt:number }
export interface StolenLanternSnapshot {
  serverTime:number;
  quest:{revision:number;stage:StolenLanternStage;title:string;objective:string;location:string;custody:'missing'|'home'|'returned';recoveredBy?:string;returnedAt?:number};
  personal:{revision:number;inventory:{apples:number;revision:number};wardUntil:number;wardReadyAt:number;snareUntil:number;incidents:StolenLanternIncident[];reward:'unavailable'|'pending'|'claimed'};
}
export interface StolenLanternReceipt { commandId:string;status:'updated'|'unchanged'|'blocked'|'inventory-conflict'|'inventory-full';message:string;at:number;inventoryRevision:number }
export interface StolenLanternMutation {snapshot:StolenLanternSnapshot;receipt:StolenLanternReceipt;replayed:boolean}
export interface StolenLanternActionRequest {
  commandId:string;
  action:StolenLanternAction;
  /** Canonical recipient, validated by the room for reach and by the store for role. */
  npcId?:string;
  expectedInventoryRevision?:number;
  /** Room-derived slot capacity; required for a new reward claim. */
  appleSlotAvailable?:boolean;
}
