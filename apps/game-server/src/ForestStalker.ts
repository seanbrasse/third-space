import { type WorldDefinition, type Point, GAME_CONFIG } from '@third-space/config';
import { type PlayerState, type ForestStalker, type WorldSoundEvent } from '@third-space/contracts';
import { distance, findHomePath, isHomeSegmentWalkable, isHomeWalkable } from '@third-space/simulation';
import { chooseClownGreeting } from "./clown-greeting";
import { ENCOUNTER_TUNING as T, encounterSegmentSafe } from './encounter-tuning';
export interface EncounterBehavior {
    kind: 'werewolf';
    intervalMs: number;
    speedMultiplier: number;
    minTargetDistance: number;
    maxTargetDistance: number;
    hiddenMargin: number;
}
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
    private lingerUntil = 0;
    private retreatUntil = 0;
    private caughtIds = new Set<string>();
    private encounterSounds: WorldSoundEvent[] = [];
    private acquisitionAt = -Infinity;
    private acquisitionSerial = 0;
    private retargetAt = 0;
    private leapAt = 0;
    private leapRecoverUntil = 0;
    private cover: {
        point: Point;
        id: string;
    }[] = [];
    constructor(private world: WorldDefinition, private random: () => number = Math.random, private behavior?: EncounterBehavior) {
        for (const item of world.map.furniture) {
            if (!['tree', 'camper', 'structure'].includes(item.kind))
                continue;
            const f = item.footprint;
            for (const point of [{ x: f.x - .4, y: f.y + f.height - .5 }, { x: f.x + f.width + .4, y: f.y + f.height - .5 }, { x: f.x + f.width / 2, y: f.y + f.height + .4 }])
                if (isHomeWalkable(point, world.map) && distance(point, world.fire!) > world.stalker!.safeRadius + .5)
                    this.cover.push({ point, id: item.id });
        }
    }
    reset(now: number) { this.state = null; this.path = []; this.pathGoal = null; this.nextAt = now + this.interval(); this.lastMove = now; this.allSafe = false; this.campAt = 0; this.lingerUntil = 0; this.retreatUntil = 0; this.caughtIds.clear(); this.retargetAt = 0; this.leapAt = 0; this.leapRecoverUntil = 0; this.encounterSounds = []; this.acquisitionAt = -Infinity; }
    private interval() { return (this.behavior?.intervalMs ?? this.world.stalker!.intervalMs) * (.85 + this.random() * .3); }
    visibleTo(player: PlayerState) { return player.connected && !player.zone && player.mode === 'home' && this.state && !(this.state.phase === "retreat" && this.lastMove >= this.retreatUntil) && distance(player, this.state) <= this.world.stalker!.viewRadius ? { ...this.state } : null; }
    private retreat(now: number) {
        if (this.state) {
            this.state.phase = 'retreat';
            delete this.state.leap;
            this.retreatUntil = now + 900;
            this.lingerUntil = now + 15000;
            // Preserve the existing client fade clock; the hidden linger stays server-owned.
            this.state.phaseUntil = this.retreatUntil;
        }
        this.path = [];
        this.pathGoal = null;
    }
    private eligible(player: PlayerState, now: number) {
        return player.connected && !player.zone && player.mode === 'home' && !player.respawnAt
            && (player.haloUntil ?? 0) <= now && !this.caughtIds.has(player.id)
            && distance(player, this.world.fire!) > this.world.stalker!.safeRadius + .5;
    }
    private nearest(players: readonly PlayerState[], now: number) {
        const state = this.state!;
        return players.filter(p => this.eligible(p, now) && distance(p, state) <= 16)
            .sort((a, b) => distance(a, state) - distance(b, state) || a.id.localeCompare(b.id))[0];
    }
    drainSounds() { return this.encounterSounds.splice(0); }
    private acquisition(now: number) {
        if (this.behavior || !this.state || now - this.acquisitionAt < 5000) return;
        this.acquisitionAt = now;
        this.encounterSounds.push({ id: `clown:${this.state.id}:acquire:${++this.acquisitionSerial}`, kind: 'giggle', x: this.state.x, y: this.state.y, createdAt: now, expiresAt: now + 1200 });
    }
    private pursue(player: PlayerState, now: number, warningMs = this.world.stalker!.peekMs) {
        const state = this.state!;
        const changed = state.targetId !== player.id || state.phase === 'retreat';
        state.targetId = player.id;
        if (changed) this.acquisition(now);
        state.intent = 'hunt';
        // Reacquisition and close retargets give a fresh, visible warning before a catch.
        state.phase = 'peek';
        state.phaseUntil = now + warningMs;
        delete state.leap;
        this.retargetAt = now + T.retargetCooldownMs;
        this.leapAt = now + warningMs + T.leapCooldownMs;
        this.leapRecoverUntil = 0;
        this.path = [];
        this.pathGoal = null;
        this.lastMove = now;
        this.lastPath = 0;
    }
    private spawn(point: Point, coverId: string, targetId: string, intent: "hunt" | "perimeter", now: number) {
        this.state = { id: String(++this.serial), x: point.x, y: point.y, originX: point.x, originY: point.y, targetId, coverId, intent, phase: "peek", startedAt: now, phaseUntil: now + this.world.stalker!.peekMs, ...(this.behavior ? { kind: this.behavior.kind } : this.random() < .45 ? { giggleAt: now } : {}) };
        if (!this.behavior) {
            this.state.greeting = chooseClownGreeting(this.state.id, coverId, now);
            this.state.giggleAt = now; // every initial greeting has one positional cue
        }
        this.lastMove = now;
        this.lastPath = 0;
        this.caughtIds.clear();
        this.lingerUntil = 0;
        this.retargetAt = now + this.world.stalker!.peekMs + T.retargetCooldownMs;
        this.leapAt = now + this.world.stalker!.peekMs + 1800;
        this.leapRecoverUntil = 0;
        if (intent === "hunt") this.acquisition(now);
        else if (this.state.giggleAt) this.encounterSounds.push({ id: `clown:${this.state.id}:perimeter`, kind: "giggle", x: point.x, y: point.y, createdAt: now, expiresAt: now + 1200 });
    }
    /** Returns a caught identity once. PartyRoom alone performs the respawn. */
    update(now: number, players: readonly PlayerState[]): string | null {
        const rules = this.world.stalker!, fire = this.world.fire!, map = this.world.map;
        if (!this.nextAt)
            this.reset(now);
        const home = players.filter(p => p.connected && !p.zone && p.mode === "home");
        const allSafe = home.length > 0 && home.every(p => distance(p, fire) <= rules.safeRadius);
        if (allSafe && !this.allSafe)
            this.campAt = now + (rules.campMinMs + this.random() * (rules.campMaxMs - rules.campMinMs)) * (this.behavior ? this.behavior.intervalMs / rules.intervalMs : 1);
        if (!allSafe && this.allSafe) {
            this.nextAt = now + this.interval();
            this.campAt = 0;
        }
        this.allSafe = allSafe;
        if (!this.state) {
            if (allSafe) {
                if (now < this.campAt)
                    return null;
                this.campAt = now + (rules.campMinMs + this.random() * (rules.campMaxMs - rules.campMinMs)) * (this.behavior ? this.behavior.intervalMs / rules.intervalMs : 1);
                const candidates = this.cover.filter(c => distance(c.point, fire) <= rules.safeRadius + 4 && (this.behavior ? home.every(p => distance(p, c.point) > rules.viewRadius + this.behavior!.hiddenMargin) : home.some(p => distance(p, c.point) <= rules.viewRadius)));
                if (!candidates.length) {
                    if (this.behavior) this.campAt = now + 5000;
                    return null;
                }
                const c = candidates[Math.min(candidates.length - 1, Math.floor(this.random() * candidates.length))]!;
                const viewer = home.reduce((a, b) => distance(a, c.point) < distance(b, c.point) ? a : b);
                this.spawn(c.point, c.id, viewer.id, "perimeter", now);
                return null;
            }
            if (now < this.nextAt)
                return null;
            this.nextAt = now + this.interval();
            const candidates = home.filter(p => this.eligible(p, now)).map(p => ({ p, covers: this.cover.filter(c => {
                const d = distance(p, c.point);
                return d >= (this.behavior?.minTargetDistance ?? 2.5) && d <= (this.behavior?.maxTargetDistance ?? 7)
                    // All active observers, including protected campers, count for hidden wolf spawning.
                    && (!this.behavior || home.every(viewer => distance(viewer, c.point) > rules.viewRadius + this.behavior!.hiddenMargin));
            }) })).filter(candidate => candidate.covers.length > 0);
            if (!candidates.length) {
                this.nextAt = now + 5000;
                return null;
            }
            // Choose a player uniformly, then their cover: nearby tree count must not bias the victim lottery.
            const { p, covers } = candidates[Math.min(candidates.length - 1, Math.floor(this.random() * candidates.length))]!;
            const c = covers[Math.min(covers.length - 1, Math.floor(this.random() * covers.length))]!;
            this.spawn(c.point, c.id, p.id, "hunt", now);
            return null;
        }
        const s = this.state;
        if (s.phase === 'retreat') {
            this.lastMove = now;
            if (now >= this.lingerUntil) {
                this.state = null;
                this.caughtIds.clear();
                return null;
            }
            if (now >= this.retreatUntil) {
                s.x = s.originX!;
                s.y = s.originY!;
                const emerging = this.nearest(players, now);
                if (emerging) this.pursue(emerging, now);
                return null;
            }
            const remaining = Math.max(0, (this.retreatUntil - now) / 900);
            s.x = s.originX! + (s.x - s.originX!) * remaining;
            s.y = s.originY! + (s.y - s.originY!) * remaining;
            return null;
        }
        const target = players.find(p => p.id === s.targetId);
        if (s.intent === "perimeter") {
            if (s.phase === "peek") {
                const p = target ?? home[0];
                if (p) {
                    const d = distance({ x: s.originX!, y: s.originY! }, p) || 1, amount = (this.behavior ? 3 : .5) * Math.min(1, (now - s.startedAt) / 900), next = { x: s.originX! + (p.x - s.originX!) / d * amount, y: s.originY! + (p.y - s.originY!) / d * amount };
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
        if (!target || !this.eligible(target, now)) {
            const replacement = this.nearest(players, now);
            if (replacement) this.pursue(replacement, now);
            else this.retreat(now);
            return null;
        }
        if (s.phase === 'peek') {
            // Hidden initial wolf spawn gradually peeks into sight; keep at least 7.5 tiles of warning distance.
            if (this.behavior && s.startedAt + rules.peekMs === s.phaseUntil && s.originX !== undefined && s.originY !== undefined) {
                const origin = { x: s.originX, y: s.originY }, d = distance(origin, target) || 1;
                const amount = Math.min(T.wolfPeekAdvance, Math.max(0, d - 7.5)) * Math.min(1, (now - s.startedAt) / T.wolfPeekAdvanceMs);
                const point = { x: origin.x + (target.x - origin.x) / d * amount, y: origin.y + (target.y - origin.y) / d * amount };
                if (encounterSegmentSafe(origin, point, this.world)) { s.x = point.x; s.y = point.y; }
            }
            if (now >= s.phaseUntil) {
                // Cover/walls can block the peek. Do not start an unseen wolf attack.
                if (this.behavior && distance(s, target) > rules.viewRadius - .5) { this.retreat(now); return null; }
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
        if (now >= this.retargetAt && !s.leap) {
            const closer = this.nearest(players, now), currentDistance = distance(s, target);
            if (closer && closer.id !== target.id && distance(s, closer) + T.retargetAdvantage < currentDistance
                && distance(s, closer) < currentDistance * T.retargetRatio) {
                this.pursue(closer, now, T.retargetWarningMs);
                return null;
            }
        }
        // A committed leap aims at a fixed point. It never tracks a dodging player or teleports a catch.
        if (s.leap) {
            const leap = s.leap;
            if (leap.phase === 'windup') {
                if (now < leap.until) return null;
                const end = { x: leap.toX, y: leap.toY };
                if (!encounterSegmentSafe(s, end, this.world)) { delete s.leap; this.leapRecoverUntil = now + T.leapRecoveryMs; return null; }
                leap.phase = 'air'; leap.startedAt = now; leap.until = now + T.leapFlightMs;
            }
            const progress = Math.min(1, Math.max(0, (now - leap.startedAt) / T.leapFlightMs));
            const point = { x: leap.fromX + (leap.toX - leap.fromX) * progress, y: leap.fromY + (leap.toY - leap.fromY) * progress };
            if (!encounterSegmentSafe(s, point, this.world)) { delete s.leap; this.leapRecoverUntil = now + T.leapRecoveryMs; return null; }
            s.x = point.x; s.y = point.y; this.lastMove = now;
            if (progress >= 1) { delete s.leap; this.leapRecoverUntil = now + T.leapRecoveryMs; }
            return null;
        }
        if (now < this.leapRecoverUntil) return null;
        const targetDistance = distance(s, target);
        if (this.behavior && now >= this.leapAt && targetDistance >= T.leapMinDistance && targetDistance <= T.leapMaxDistance) {
            const length = Math.min(T.leapLength, targetDistance);
            const end = { x: s.x + (target.x - s.x) / targetDistance * length, y: s.y + (target.y - s.y) / targetDistance * length };
            if (encounterSegmentSafe(s, end, this.world)) {
                s.leap = { phase: 'windup', startedAt: now, until: now + T.leapWindupMs, fromX: s.x, fromY: s.y, toX: end.x, toY: end.y };
                this.leapAt = now + T.leapCooldownMs;
                return null;
            }
        }
        if (distance(s, target) < .65 && isHomeSegmentWalkable(s, target, map)) {
            this.caughtIds.add(target.id);
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
        // Clown lurches or a continuous quadruped gallop; both use swept collision geometry.
        const speed = GAME_CONFIG.homeSpeed * (this.behavior?.speedMultiplier ?? (Math.sin((now - s.startedAt) / 340) > -.65 ? T.clownStride : T.clownLurch)), step = Math.min(d, speed * dt);
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
            this.caughtIds.add(target.id);
            this.retreat(now);
            return target.id;
        }
        return null;
    }
}
