/** Room-local authority. No browser time, persistent offline debt, or item IDs supplied by clients. */
import type { SurvivalItem, SurvivalPlayer, Backpack, AppleTree, SurvivalEvent, SurvivalSnapshot } from '../../../packages/contracts/src/survival';
export type { SurvivalItem, SurvivalPlayer, Backpack, AppleTree, SurvivalEvent, SurvivalSnapshot } from '../../../packages/contracts/src/survival';
export interface SurvivalActor {
    id: string;
    x: number;
    y: number;
    connected: boolean;
    mode: 'home' | 'race';
    zone?: string;
    seatId?: string;
    haloUntil?: number;
    respawnAt?: number;
    vx: number;
    vy: number;
    watching?: boolean;
}
export interface SurvivalOptions {
    persistApples?: (id:string,before:number,after:number,cause:'harvest'|'eat'|'death')=>boolean;
    random: () => number;
    spawnPoints: readonly {
        x: number;
        y: number;
    }[];
    trees: readonly {
        id: string;
        x: number;
        y: number;
    }[];
    safe: (p: {
        x: number;
        y: number;
    }) => boolean;
    walkable: (p: {
        x: number;
        y: number;
    }) => boolean;
    lineOfSight: (a: {
        x: number;
        y: number;
    }, b: {
        x: number;
        y: number;
    }) => boolean;
}
export type SurvivalResult = {
    ok: true;
    deaths: string[];
} | {
    ok: false;
    reason: string;
};
export const SURVIVAL = { maxActiveBackpacks: 2, backpackReplacementMs: 30000, slotCapacity: 5, appleCapacity: 5, appleHunger: 25, harvestRange: 1.8, pickupRange: 1.5, attackRange: 1.4, attackDamage: 30, attackCooldownMs: 800, treeRecoveryMs: 45000, hungerPerSecond: 1 / 12, starvationPerSecond: 1, eventLifetimeMs: 3000 } as const;
const distance = (a: {
    x: number;
    y: number;
}, b: {
    x: number;
    y: number;
}) => Math.hypot(a.x - b.x, a.y - b.y);
export class SurvivalInventory {
    private players = new Map<string, SurvivalPlayer>();
    private backpacks: Backpack[] = [];
    private trees: AppleTree[];
    private events: SurvivalEvent[] = [];
    private attackAt = new Map<string, number>();
    private lastAt: number | undefined;
    private serial = 0;
    private pvpEnabled = true;
    private nextSpawnAt = 0;
    private rewardClaims = new Set<string>();
    private commandClaims = new Map<string, Map<string, number>>();
    constructor(private options: SurvivalOptions) { this.trees = options.trees.map(t => ({ ...t, readyAt: 0 })); }
    ensure(id: string) { let p = this.players.get(id); if (!p) {
        p = { id, health: 100, hunger: 75, equipped: 'flashlight', slots: ['flashlight', null, null, null, null], selectedSlot: 0, apples: 0 };
        this.players.set(id, p);
    } return { ...p, slots: [...p.slots], ...(p.potions?{potions:{...p.potions}}:{}) }; }
    /** Hydrate only from the durable server inventory. This never grants a reward. */
    restoreApples(id:string,count:number){
        if(!Number.isInteger(count)||count<0||count>SURVIVAL.appleCapacity)return false;
        this.ensure(id);const p=this.players.get(id)!;
        if(count&&!this.canStore(p,'apple'))return false;
        p.apples=count;if(count)this.store(p,'apple');else this.clearItem(p,'apple');return true;
    }
    canStoreItem(id:string,item:SurvivalItem){const p=this.players.get(id);return !!p&&this.canStore(p,item);}
    /** Counts come only from the durable living-world transaction. Never mint doses here. */
    restorePotions(id:string,counts:{strength:number;speed:number}){
        if(Object.values(counts).some(n=>!Number.isInteger(n)||n<0||n>2))return false;
        this.ensure(id);const p=this.players.get(id)!;
        const next=[...p.slots];
        for(const kind of ['strength','speed'] as const){const item=`${kind}-potion` as const;const slot=next.indexOf(item);if(!counts[kind]&&slot>=0)next[slot]=null;}
        for(const kind of ['strength','speed'] as const){const item=`${kind}-potion` as const;if(counts[kind]&&!next.includes(item)){const slot=next.indexOf(null);if(slot<0)return false;next[slot]=item;}}
        p.slots=next;p.potions={...counts};p.equipped=p.slots[p.selectedSlot]??null;return true;
    }
    /** Apply after life/zone/world validation. Deduplicates transport replay throughout reconnect grace. */
    acceptCommand(id: string, commandId: string, now: number): boolean {
        if (!this.players.has(id) || !commandId || commandId.length > 160) return false;
        const claims = this.commandClaims.get(id) ?? new Map<string, number>();
        for (const [key, at] of claims) if (now - at >= 300_000) claims.delete(key);
        if (claims.has(commandId) || claims.size >= 512) return false;
        claims.set(commandId, now); this.commandClaims.set(id, claims); return true;
    }
    isPvpEnabled(){return this.pvpEnabled;}
    setPvp(enabled: boolean) { this.pvpEnabled = enabled; }
    private event(kind: SurvivalEvent['kind'], actorId: string, at: number, targetId?: string) { this.events.push({ id: `survival-${++this.serial}`, kind, actorId, targetId, at }); this.events = this.events.slice(-64); }
    private active(a: SurvivalActor, now: number) { return a.connected && a.mode === 'home' && !a.zone && !a.respawnAt && !(a.haloUntil && a.haloUntil > now); }
    private replenish(now: number) { if (now < this.nextSpawnAt)
        return; const candidates = this.options.spawnPoints.filter(p => this.options.walkable(p) && !this.options.safe(p) && this.backpacks.every(b => distance(b, p) > 2)); for (let n = 0; this.backpacks.length < SURVIVAL.maxActiveBackpacks && candidates.length && n < 32; n++) {
        const index = Math.min(candidates.length - 1, Math.max(0, Math.floor(this.options.random() * candidates.length)));
        const p = candidates.splice(index, 1)[0]!;
        if (this.backpacks.some(b => distance(b, p) <= 2))
            continue;
        this.backpacks.push({ id: `knife-${++this.serial}`, x: p.x, y: p.y });
    } }
    /** Call once per authority tick. dt is capped; disconnect/reconnect never accumulates starvation debt. */
    tick(now: number, actors: readonly SurvivalActor[]): string[] { const dt = this.lastAt === undefined ? 0 : Math.max(0, Math.min(1, (now - this.lastAt) / 1000)); this.lastAt = now; const deaths: string[] = []; for (const a of actors) {
        this.ensure(a.id);
        const p = this.players.get(a.id)!;
        if (!this.active(a, now) || a.seatId || a.watching || this.options.safe(a) || Math.hypot(a.vx, a.vy) < .05 || p.health <= 0)
            continue;
        p.hunger = Math.max(0, p.hunger - dt * SURVIVAL.hungerPerSecond);
        if (p.hunger === 0) {
            p.health = Math.max(0, p.health - dt * SURVIVAL.starvationPerSecond);
            p.damageRevision=(p.damageRevision??0)+1;
            if (p.health === 0) {
                deaths.push(a.id);
                this.event('death', a.id, now);
            }
        }
    } this.events = this.events.filter(e => now - e.at < SURVIVAL.eventLifetimeMs); this.replenish(now); return deaths; }
    selectSlot(id: string, slot: number): SurvivalResult {
        const p = this.players.get(id);
        if (!p || !Number.isInteger(slot) || slot < 0 || slot >= SURVIVAL.slotCapacity)
            return { ok: false, reason: 'Slot unavailable' };
        p.selectedSlot = slot; p.equipped = p.slots[slot] ?? null;
        return { ok: true, deaths: [] };
    }
    equip(id: string, item: SurvivalItem): SurvivalResult {
        const p = this.players.get(id), slot = p?.slots.indexOf(item) ?? -1;
        if (slot < 0) return { ok: false, reason: 'Item unavailable' };
        return this.selectSlot(id, slot);
    }
    private canStore(p: SurvivalPlayer, item: SurvivalItem) { return p.slots.includes(item) || p.slots.includes(null); }
    private store(p: SurvivalPlayer, item: SurvivalItem) {
        if (!p.slots.includes(item)) p.slots[p.slots.indexOf(null)] = item;
        p.equipped = p.slots[p.selectedSlot] ?? null;
    }
    private clearItem(p: SurvivalPlayer, item: SurvivalItem) {
        const slot = p.slots.indexOf(item); if (slot >= 0) p.slots[slot] = null;
        p.equipped = p.slots[p.selectedSlot] ?? null;
    }
    harvest(a: SurvivalActor, treeId: string, now: number): SurvivalResult { const p = this.players.get(a.id), t = this.trees.find(t => t.id === treeId); if (!p || !t || !this.active(a, now) || distance(a, t) > SURVIVAL.harvestRange || !this.options.lineOfSight(a, t))
        return { ok: false, reason: 'Walk closer to the apple tree' }; if (!this.canStore(p, 'apple')) return { ok: false, reason: 'Inventory full' }; if (p.apples >= SURVIVAL.appleCapacity)
        return { ok: false, reason: 'Apple pocket full' }; if (t.readyAt > now)
        return { ok: false, reason: 'Apples are still growing' }; if(this.options.persistApples&&!this.options.persistApples(a.id,p.apples,p.apples+1,'harvest'))return {ok:false,reason:'Inventory could not be saved. Try again.'}; t.readyAt = now + SURVIVAL.treeRecoveryMs; p.apples++; this.store(p, 'apple'); this.event('harvest', a.id, now); return { ok: true, deaths: [] }; }
    eat(a: SurvivalActor, now: number): SurvivalResult { const p = this.players.get(a.id); if (!p || !a.connected || a.mode !== 'home' || a.respawnAt || !p.apples)
        return { ok: false, reason: 'No apple to eat' }; if (p.hunger >= 100)
        return { ok: false, reason: 'Already full' }; if(this.options.persistApples&&!this.options.persistApples(a.id,p.apples,p.apples-1,'eat'))return {ok:false,reason:'Inventory could not be saved. Try again.'}; p.apples--; p.hunger = Math.min(100, p.hunger + SURVIVAL.appleHunger); if (!p.apples) this.clearItem(p, 'apple'); this.event('eat', a.id, now); return { ok: true, deaths: [] }; }
    pickup(a: SurvivalActor, id: string, now: number): SurvivalResult { const p = this.players.get(a.id), i = this.backpacks.findIndex(b => b.id === id), b = this.backpacks[i]; if (!p || !b || p.knifeId || !this.active(a, now) || distance(a, b) > SURVIVAL.pickupRange || !this.options.lineOfSight(a, b))
        return { ok: false, reason: 'Backpack unavailable or too far away' }; if (!this.canStore(p, 'knife')) return { ok: false, reason: 'Inventory full' }; this.backpacks.splice(i, 1); this.nextSpawnAt = Math.max(this.nextSpawnAt, now + SURVIVAL.backpackReplacementMs); p.knifeId = b.id; this.store(p, 'knife'); this.event('pickup', a.id, now); return { ok: true, deaths: [] }; }
    strikeWorldTarget(a:SurvivalActor,target:{x:number;y:number},now:number):SurvivalResult{
        const p=this.players.get(a.id);
        if(!p||p.equipped!=='knife'||!p.knifeId||!this.active(a,now)||a.seatId||this.options.safe(a)||this.options.safe(target)||p.health<=0)return {ok:false,reason:'Equip your knife outside the safe areas'};
        if(now-(this.attackAt.get(a.id)??-Infinity)<SURVIVAL.attackCooldownMs)return {ok:false,reason:'Knife is recovering'};
        if(distance(a,target)>SURVIVAL.attackRange||!this.options.lineOfSight(a,target))return {ok:false,reason:'Out of reach'};
        this.attackAt.set(a.id,now);this.event('swing',a.id,now);return {ok:true,deaths:[]};
    }
    damageWorld(a:SurvivalActor,amount:number,now:number):SurvivalResult{
        const p=this.players.get(a.id);
        if(!p||!Number.isFinite(amount)||amount<=0||amount>1000||!this.active(a,now)||a.seatId||this.options.safe(a)||p.health<=0)return {ok:false,reason:'Safe from the threat'};
        p.health=Math.max(0,p.health-amount);p.damageRevision=(p.damageRevision??0)+1;this.event('hurt',a.id,now);if(!p.health)this.event('death',a.id,now);return {ok:true,deaths:p.health?[]:[a.id]};
    }
    attack(a: SurvivalActor, b: SurvivalActor, now: number, damage:number=SURVIVAL.attackDamage): SurvivalResult { const p = this.players.get(a.id), target = this.players.get(b.id); if (!Number.isFinite(damage)||damage<=0||damage>100||!this.pvpEnabled || !p || !target || a.id === b.id || !this.active(b, now) || b.seatId || this.options.safe(b) || target.health <= 0)
        return { ok: false, reason: 'Players are safe here' }; const swing=this.strikeWorldTarget(a,b,now);if(!swing.ok)return swing; target.health = Math.max(0, target.health - damage);target.damageRevision=(target.damageRevision??0)+1; this.event('hurt', b.id, now, a.id); if (target.health === 0)
        this.event('death', b.id, now, a.id); return { ok: true, deaths: target.health === 0 ? [b.id] : [] }; }
    /** Server-only reward bridge. Durable quest ledger must own cross-restart claims. Full pocket does not consume claim. */
    grantApples(id: string, amount: number, claimId: string): SurvivalResult { const p = this.players.get(id); if (!p || !Number.isInteger(amount) || amount < 1 || amount > SURVIVAL.appleCapacity || !claimId || claimId.length > 160)
        return { ok: false, reason: 'Invalid reward' }; if (this.rewardClaims.has(claimId))
        return { ok: false, reason: 'Reward already claimed' }; if (this.rewardClaims.size >= 4096)
        return { ok: false, reason: 'Reward ledger full' }; if (!this.canStore(p, 'apple')) return { ok: false, reason: 'Inventory full' }; if (p.apples + amount > SURVIVAL.appleCapacity)
        return { ok: false, reason: 'Apple pocket full' }; this.rewardClaims.add(claimId); p.apples += amount; this.store(p, 'apple'); return { ok: true, deaths: [] }; }
    private returnKnife(p: SurvivalPlayer) { if (!p.knifeId)
        return; const id = p.knifeId; delete p.knifeId; this.clearItem(p, 'knife'); if (this.backpacks.length >= SURVIVAL.maxActiveBackpacks)
        this.backpacks.shift(); const candidates = this.options.spawnPoints.filter(p => this.options.walkable(p) && !this.options.safe(p) && this.backpacks.every(b => distance(b, p) > 2)); if (!candidates.length)
        return; const index = Math.min(candidates.length - 1, Math.max(0, Math.floor(this.options.random() * candidates.length))); const point = candidates[index]!; this.backpacks.push({ id, x: point.x, y: point.y }); }
    respawn(id: string) { const p = this.players.get(id); if (!p)
        return; const saved=!p.apples||!this.options.persistApples||this.options.persistApples(id,p.apples,0,'death'); const retained=saved?0:p.apples; this.returnKnife(p); p.health = 100; p.hunger = 75; p.apples = 0; p.equipped = 'flashlight'; p.slots = ['flashlight', null, null, null, null]; p.selectedSlot = 0; if(retained)this.restoreApples(id,retained); if(p.potions)this.restorePotions(id,p.potions); /* cooldown deliberately survives respawn */ }
    remove(id: string) { const p = this.players.get(id); if (p)
        this.returnKnife(p); this.players.delete(id); this.attackAt.delete(id);
        this.commandClaims.delete(id); }
    snapshot(): SurvivalSnapshot { return { pvpEnabled: this.pvpEnabled, players: [...this.players.values()].map(p => ({ ...p, slots: [...p.slots], ...(p.potions?{potions:{...p.potions}}:{}) })), backpacks: this.backpacks.map(b => ({ ...b })), appleTrees: this.trees.map(t => ({ ...t })), events: this.events.map(e => ({ ...e })) }; }
}
