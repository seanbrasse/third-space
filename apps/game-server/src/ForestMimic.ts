import { outsideForestView } from '../../../packages/config/src/forest-view';
import { GAME_CONFIG, type Point, type WorldDefinition } from '@third-space/config';
import type { ForestMimicState, PlayerState, WorldSoundEvent } from '@third-space/contracts';
import { distance, findHomePath, isHomeWalkable } from '@third-space/simulation';
import { encounterSegmentSafe } from './encounter-tuning';

export const MIMIC_TUNING = {
    intervalMs: 120000, approachStride: .65, chaseStride: 1.9,
    morphDistance: 3.2, closeLingerMs: 2200, morphMs: 360, chaseMs: 18000,
    approachMs: 60000, lingerMs: 15000, retreatMs: 900,
    retargetCooldownMs: 2500, retargetWarningMs: 900,
} as const;
/** A captured appearance is cosmetic only: never a player/session/chat identity. */
export class ForestMimic {
    state: ForestMimicState | null = null;
    private nextAt = 0;
    private serial = 0;
    private lastMove = 0;
    private lastPath = 0;
    private path: Point[] = [];
    private retreatUntil = 0;
    private lingerUntil = 0;
    private retargetAt = 0;
    private warningUntil = 0;
    private caught = new Set<string>();
    private sounds: WorldSoundEvent[] = [];
    private cover: { point: Point; id: string }[] = [];
    constructor(private world: WorldDefinition, private random: () => number = Math.random) {
        for (const object of world.map.furniture) {
            if (!['tree', 'camper', 'structure'].includes(object.kind)) continue;
            const f = object.footprint;
            for (const point of [{ x: f.x - .4, y: f.y + f.height - .5 }, { x: f.x + f.width + .4, y: f.y + f.height - .5 }])
                if (isHomeWalkable(point, world.map) && distance(point, world.fire!) > world.stalker!.safeRadius + .5)
                    this.cover.push({ point, id: object.id });
        }
    }
    reset(now: number) {
        this.state = null; this.nextAt = now + this.interval(); this.lastMove = now;
        this.path = []; this.lastPath = 0; this.sounds = []; this.caught.clear(); this.warningUntil = 0;
    }
    private interval() { return MIMIC_TUNING.intervalMs * (.85 + this.random() * .3); }
    private eligible(p: PlayerState, now: number) {
        return p.connected && p.mode === 'home' && !p.zone && !p.respawnAt && (p.haloUntil ?? 0) <= now
            && !this.caught.has(p.id) && distance(p, this.world.fire!) > this.world.stalker!.safeRadius + .5;
    }
    private nearest(players: readonly PlayerState[], now: number) {
        return players.filter(p => this.eligible(p, now) && distance(p, this.state!) <= 48)
            .sort((a, b) => distance(a, this.state!) - distance(b, this.state!) || a.id.localeCompare(b.id))[0];
    }
    drainSounds() { return this.sounds.splice(0); }
    visibleTo(p: PlayerState) {
        const s = this.state;
        if (!s || !p.connected || p.mode !== 'home' || p.zone || distance(p, s) > 56
            || (s.phase === 'retreat' && this.lastMove >= this.retreatUntil)) return null;
        return { ...s, disguise: { ...s.disguise } };
    }
    private retreat(now: number) {
        const s = this.state!; s.phase = 'retreat'; s.phaseUntil = now + MIMIC_TUNING.retreatMs;
        this.retreatUntil = s.phaseUntil; this.lingerUntil = now + MIMIC_TUNING.lingerMs; this.path = [];
    }
    private roar(now: number) {
        const s = this.state!;
        this.sounds.push({ id: `mimic:${s.id}:morph`, kind: 'mimic-roar', x: s.x, y: s.y, createdAt: now, expiresAt: now + 1300 });
    }
    update(now: number, players: readonly PlayerState[], humanObservers: readonly PlayerState[] = players): string | null {
        const observers = humanObservers.filter(p => !p.id.startsWith('npc:') && p.connected && p.mode === 'home' && !p.zone);
        const unseen = (point: Point) => observers.every(p => outsideForestView(point, p, this.world.map));
        if (!this.nextAt) this.reset(now);
        if (!this.state) {
            if (now < this.nextAt) return null;
            this.nextAt = now + this.interval();
            const candidates = players.filter(p => this.eligible(p, now)).map(p => ({ p, covers: this.cover.filter(c => {
                const d = distance(p, c.point); return d >= 20 && d <= 48 && unseen(c.point);
            }) })).filter(c => c.covers.length);
            if (!candidates.length) { this.nextAt = now + 5000; return null; }
            const candidate = candidates[Math.min(candidates.length - 1, Math.floor(this.random() * candidates.length))]!;
            const c = candidate.covers[Math.min(candidate.covers.length - 1, Math.floor(this.random() * candidate.covers.length))]!;
            // Player or NPC appearance only. No copied name/chat/account identity; appearance stays stable.
            const avatars = players.filter(p => p.connected && p.mode === 'home' && !p.zone);
            const disguise = avatars[Math.min(avatars.length - 1, Math.floor(this.random() * avatars.length))] ?? candidate.p;
            this.state = { kind: 'mimic', id: String(++this.serial), ...c.point, originX: c.point.x, originY: c.point.y,
                coverId: c.id, targetId: candidate.p.id, disguisePlayerId: disguise.id, disguise: { ...disguise.avatar }, disguiseKind: disguise.id.startsWith("npc:") ? "npc" : "player", disguiseArt: (disguise as PlayerState & {npcArt?:ForestMimicState["disguiseArt"]}).npcArt,
                phase: 'approach', startedAt: now, phaseUntil: now + MIMIC_TUNING.approachMs, transformed: false };
            this.caught.clear(); this.path = []; this.lastPath = 0; this.lastMove = now; this.retargetAt = now + 2500;
            return null;
        }
        const s = this.state;
        if (s.phase === 'retreat') {
            this.lastMove = now;
            if (now >= this.lingerUntil) { this.state = null; return null; }
            if (now >= this.retreatUntil && unseen({x:s.originX,y:s.originY})) {
                s.x = s.originX; s.y = s.originY;
                const target = this.nearest(players, now);
                if (target) {
                    s.targetId = target.id; s.phase = s.transformed ? 'chase' : 'approach'; s.chaseStartedAt = now;
                    s.phaseUntil = now + (s.transformed ? MIMIC_TUNING.chaseMs : MIMIC_TUNING.approachMs);
                    this.warningUntil = now + MIMIC_TUNING.retargetWarningMs; this.lastMove = now; this.retargetAt = now + 2500;
                }
            }
            return null;
        }
        let target = players.find(p => p.id === s.targetId);
        if (!target || !this.eligible(target, now)) {
            const replacement = this.nearest(players, now);
            if (!replacement) { this.retreat(now); return null; }
            target = replacement; s.targetId = target.id; this.warningUntil = now + MIMIC_TUNING.retargetWarningMs;
            this.path = []; this.lastPath = 0; this.retargetAt = now + MIMIC_TUNING.retargetCooldownMs;
        }
        if (s.phase === 'linger') {
            this.lastMove = now;
            if (now >= s.phaseUntil) {
                s.phase = 'morph'; s.morphStartedAt = now; s.transformed = true;
                s.phaseUntil = now + MIMIC_TUNING.morphMs; this.roar(now);
            }
            return null;
        }
        if (s.phase === 'morph') {
            this.lastMove = now;
            if (now >= s.phaseUntil) { s.phase = 'chase'; s.chaseStartedAt = now; s.transformed = true; s.phaseUntil = now + MIMIC_TUNING.chaseMs; }
            return null;
        }
        if (now >= s.phaseUntil || distance(s, target) > 48) { this.retreat(now); return null; }
        if (now >= this.retargetAt) {
            const closer = this.nearest(s.phase === 'chase' ? players.filter(p => p.sprinting || Math.hypot(p.vx,p.vy) > GAME_CONFIG.homeSpeed * 1.05) : players, now), d = distance(s, target);
            if (closer && closer.id !== target.id && distance(s, closer) + 1.5 < d && distance(s, closer) < d * .7) {
                target = closer; s.targetId = target.id; this.warningUntil = now + MIMIC_TUNING.retargetWarningMs;
                this.path = []; this.lastPath = 0; this.retargetAt = now + MIMIC_TUNING.retargetCooldownMs;
            }
        }
        if (s.phase === 'approach' && distance(s, target) <= MIMIC_TUNING.morphDistance) {
            s.phase = 'linger'; s.phaseUntil = now + MIMIC_TUNING.closeLingerMs; this.lastMove = now; return null;
        }
        if (now < this.warningUntil) { this.lastMove = now; return null; }
        if (s.phase === 'chase' && distance(s, target) < .65 && encounterSegmentSafe(s, target, this.world)) {
            this.caught.add(target.id); this.retreat(now); return target.id;
        }
        if (now - this.lastMove < 100) return null;
        const dt = Math.min(.15, (now - this.lastMove) / 1000); this.lastMove = now;
        let goal: Point = target;
        if (!encounterSegmentSafe(s, target, this.world)) {
            if (now - this.lastPath >= 1200) { this.lastPath = now; this.path = findHomePath(s, target, this.world.map)?.slice(1) ?? []; }
            while (this.path.length && distance(s, this.path[0]!) < .15) this.path.shift();
            if (!this.path.length) { this.retreat(now); return null; }
            goal = this.path[0]!;
        } else this.path = [];
        const d = distance(s, goal); if (!d) return null;
        // Jagged acceleration is bounded; no teleport or larger collision/catch radius for the tall silhouette.
        const stride = s.phase === 'approach' ? MIMIC_TUNING.approachStride
            : (1.3 + (MIMIC_TUNING.chaseStride - 1.3) * Math.min(1, Math.max(0, now - (s.chaseStartedAt ?? now)) / 900)) * (Math.sin((now - s.startedAt) / 130) > -.45 ? 1 : .9);
        const step = Math.min(d, GAME_CONFIG.homeSpeed * stride * dt);
        const next = { x: s.x + (goal.x - s.x) / d * step, y: s.y + (goal.y - s.y) / d * step };
        if (encounterSegmentSafe(s, next, this.world)) { s.x = next.x; s.y = next.y; }
        else { this.path = []; this.lastPath = 0; if (distance(next, this.world.fire!) <= this.world.stalker!.safeRadius + .5) this.retreat(now); }
        return null;
    }
}
