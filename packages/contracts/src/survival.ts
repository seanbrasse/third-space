/** Public room-local survival snapshot; no secret item contents or private user data. */
export type SurvivalItem = 'flashlight' | 'apple' | 'knife';
export interface SurvivalPlayer {
    id: string;
    health: number;
    hunger: number;
    equipped: SurvivalItem | null;
    /** Stable acquisition order; empty slots can be selected to put an item away. */
    slots: (SurvivalItem | null)[];
    selectedSlot: number;
    apples: number;
    knifeId?: string;
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
export interface SurvivalSnapshot {
    pvpEnabled: boolean;
    players: SurvivalPlayer[];
    backpacks: Backpack[];
    appleTrees: AppleTree[];
    events: SurvivalEvent[];
}
