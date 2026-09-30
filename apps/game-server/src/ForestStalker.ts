import { type WorldDefinition, type Point, GAME_CONFIG } from '@third-space/config';
import { type PlayerState, type ForestStalker } from '@third-space/contracts';
import { distance, findHomePath, isHomeSegmentWalkable, isHomeWalkable } from '@third-space/simulation';
/** One room-owned encounter. No timers, transport or client-random authority. */
export class ForestEncounter {
    state: ForestStalker | null = null;
    private nextAt = 0;
    private campAt = 0;
    private allSafe = false;
    private serial = 0;
    private lastMove = 0;
    private lastPath = 0;
    private path: Point[] = [];
    private pathGoal: Point | null = null;
    private cover: {
        point: Point;
        id: string;
    }[] = [];
    constructor(private world: WorldDefinition, private random: () => number = Math.random) {
        for (const item of world.map.furniture) {
            if (!['tree', 'camper', 'structure'].includes(item.kind))
                continue;
            const f = item.footprint;
            for (const point of [{ x: f.x - .4, y: f.y + f.height - .5 }, { x: f.x + f.width + .4, y: f.y + f.height - .5 }, { x: f.x + f.width / 2, y: f.y + f.height + .4 }])
                if (isHomeWalkable(point, world.map) && distance(point, world.fire!) > world.stalker!.safeRadius + .5)
                    this.cover.push({ point, id: item.id });
        }
    }
    reset(now: number) { this.state = null; this.path = []; this.pathGoal = null; this.nextAt = now + this.interval(); this.lastMove = now; this.allSafe = false; this.campAt = 0; }
    private interval() { return this.world.stalker!.intervalMs * (.85 + this.random() * .3); }
    visibleTo(player: PlayerState) { return player.mode === 'home' && this.state && distance(player, this.state) <= this.world.stalker!.viewRadius ? { ...this.state } : null; }
    private retreat(now: number) {
        if (this.state) {
            this.state.phase = 'retreat';
            this.state.phaseUntil = now + 900;
        }
        this.path = [];
    }
    private spawn(point: Point, coverId: string, targetId: string, intent: "hunt" | "perimeter", now: number) {
        this.state = { id: String(++this.serial), x: point.x, y: point.y, originX: point.x, originY: point.y, targetId, coverId, intent, phase: "peek", startedAt: now, phaseUntil: now + this.world.stalker!.peekMs, ...(this.random() < .45 ? { giggleAt: now } : {}) };
        this.lastMove = now;
        this.lastPath = 0;
    }
    /** Returns a caught identity once. PartyRoom alone performs the respawn. */
    update(now: number, players: readonly PlayerState[]): string | null {
        const rules = this.world.stalker!, fire = this.world.fire!, map = this.world.map;
        if (!this.nextAt)
            this.reset(now);
        const home = players.filter(p => p.connected && p.mode === "home");
        const allSafe = home.length > 0 && home.every(p => distance(p, fire) <= rules.safeRadius);
        if (allSafe && !this.allSafe)
            this.campAt = now + rules.campMinMs + this.random() * (rules.campMaxMs - rules.campMinMs);
        if (!allSafe && this.allSafe) {
            this.nextAt = now + this.interval();
            this.campAt = 0;
        }
        this.allSafe = allSafe;
        if (!this.state) {
            if (allSafe) {
                if (now < this.campAt)
                    return null;
                this.campAt = now + rules.campMinMs + this.random() * (rules.campMaxMs - rules.campMinMs);
                const candidates = this.cover.filter(c => distance(c.point, fire) <= rules.safeRadius + 4 && home.some(p => distance(p, c.point) <= rules.viewRadius));
                if (!candidates.length)
                    return null;
                const c = candidates[Math.min(candidates.length - 1, Math.floor(this.random() * candidates.length))]!;
                const viewer = home.reduce((a, b) => distance(a, c.point) < distance(b, c.point) ? a : b);
                this.spawn(c.point, c.id, viewer.id, "perimeter", now);
                return null;
            }
            if (now < this.nextAt)
                return null;
            this.nextAt = now + this.interval();
            const eligible = home.filter(p => distance(p, fire) > rules.safeRadius + .5 && (p.haloUntil ?? 0) <= now && !p.respawnAt);
            const candidates = eligible.flatMap(p => this.cover.filter(c => { const d = distance(p, c.point); return d >= 2.5 && d <= 7; }).map(c => ({ p, c })));
            if (!candidates.length) {
                this.nextAt = now + 5000;
                return null;
            }
            const { p, c } = candidates[Math.min(candidates.length - 1, Math.floor(this.random() * candidates.length))]!;
            this.spawn(c.point, c.id, p.id, "hunt", now);
            return null;
        }
        const s = this.state;
        if (s.phase === 'retreat') {
            const remaining = Math.max(0, (s.phaseUntil - now) / 900);
            s.x = s.originX! + (s.x - s.originX!) * remaining;
            s.y = s.originY! + (s.y - s.originY!) * remaining;
            if (now >= s.phaseUntil)
                this.state = null;
            return null;
        }
        const target = players.find(p => p.id === s.targetId);
        if (s.intent === "perimeter") {
            if (s.phase === "peek") {
                const p = target ?? home[0];
                if (p) {
                    const d = distance({ x: s.originX!, y: s.originY! }, p) || 1, amount = .5 * Math.min(1, (now - s.startedAt) / 900), next = { x: s.originX! + (p.x - s.originX!) / d * amount, y: s.originY! + (p.y - s.originY!) / d * amount };
                    if (distance(next, fire) > rules.safeRadius + .5 && isHomeSegmentWalkable({ x: s.originX!, y: s.originY! }, next, map)) {
                        s.x = next.x;
                        s.y = next.y;
                    }
                }
                if (now >= s.phaseUntil)
                    this.retreat(now);
            }
            return null;
        }
        if (!target?.connected || target.mode !== 'home' || distance(target, fire) <= rules.safeRadius || (target.haloUntil ?? 0) > now) {
            this.retreat(now);
            return null;
        }
        if (s.phase === 'peek') {
            if (now >= s.phaseUntil) {
                s.phase = 'chase';
                s.phaseUntil = now + rules.chaseMs;
                this.lastMove = now;
            }
            return null;
        }
        if (now >= s.phaseUntil || distance(s, target) > 16) {
            this.retreat(now);
            return null;
        }
        if (distance(s, target) < .65 && isHomeSegmentWalkable(s, target, map)) {
            this.retreat(now);
            return target.id;
        }
        if (now - this.lastMove < 100)
            return null;
        const dt = Math.min(.15, (now - this.lastMove) / 1000);
        this.lastMove = now;
        let goal: Point = target;
        if (!isHomeSegmentWalkable(s, target, map)) {
            if (now - this.lastPath >= 1200) {
                this.lastPath = now;
                this.path = findHomePath(s, target, map)?.slice(1) ?? [];
                this.pathGoal = { x: target.x, y: target.y };
            }
            while (this.path.length && distance(s, this.path[0]!) < .15)
                this.path.shift();
            if (!this.path.length) {
                if (!this.pathGoal || now - this.lastPath > 1100)
                    this.retreat(now);
                return null;
            }
            goal = this.path[0]!;
        }
        else {
            this.path = [];
            this.pathGoal = null;
        }
        const d = distance(s, goal);
        if (!d)
            return null;
        // Brief lurches, then quick strides; still obey the same swept collision geometry.
        const speed = GAME_CONFIG.homeSpeed * (Math.sin((now - s.startedAt) / 340) > -.65 ? 1.35 : .35), step = Math.min(d, speed * dt);
        const next = { x: s.x + (goal.x - s.x) / d * step, y: s.y + (goal.y - s.y) / d * step };
        if (distance(next, fire) <= rules.safeRadius + .25) {
            this.retreat(now);
            return null;
        }
        if (isHomeSegmentWalkable(s, next, map)) {
            s.x = next.x;
            s.y = next.y;
        }
        else {
            this.lastPath = 0;
            this.path = [];
        }
        if (distance(s, target) < .65 && isHomeSegmentWalkable(s, target, map)) {
            this.retreat(now);
            return target.id;
        }
        return null;
    }
}
