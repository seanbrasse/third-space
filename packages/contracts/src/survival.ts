/** Public room-local survival snapshot; no secret item contents or private user data. */
export type SurvivalItem = 'flashlight' | 'apple' | 'knife' | 'strength-potion' | 'speed-potion';
export interface SurvivalPlayer {
    id: string;
    health: number;
    hunger: number;
    equipped: SurvivalItem | null;
    /** Stable acquisition order; empty slots can be selected to put an item away. */
    slots: (SurvivalItem | null)[];
    selectedSlot: number;
    apples: number;
    potions?: {strength:number;speed:number};
    knifeId?: string;
    damageRevision?:number;
}
export interface Backpack {
    id: string;
    x: number;
    y: number;
}
export interface AppleTree {
    id: string;
    x: number;
    y: number;
    readyAt: number;
}
export interface SurvivalEvent {
    id: string;
    kind: 'harvest' | 'eat' | 'pickup' | 'swing' | 'hurt' | 'death';
    actorId: string;
    targetId?: string;
    at: number;
}
export interface KnifeFinisherTell {
    id:string;attackerId:string;targetId:string;point:{x:number;y:number};radius:number;startedAt:number;until:number;
    attackerLifeRevision:number;targetLifeRevision:number;worldRevision:number;
}
export interface SurvivalSnapshot {
    finishers?:KnifeFinisherTell[];
    pvpEnabled: boolean;
    players: SurvivalPlayer[];
    backpacks: Backpack[];
    appleTrees: AppleTree[];
    events: SurvivalEvent[];
}
