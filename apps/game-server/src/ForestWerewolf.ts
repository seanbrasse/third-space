import type { WorldDefinition } from '@third-space/config';
import type { PlayerState, WorldSoundEvent } from '@third-space/contracts';
import { ForestEncounter, type EncounterBehavior } from './ForestStalker';

/** Five times the clown check interval; 26% faster than its peak stride. */
export const WEREWOLF_DEFAULTS: Readonly<EncounterBehavior> = {
    kind: 'werewolf', intervalMs: 150000, speedMultiplier: 1.7,
    minTargetDistance: 12, maxTargetDistance: 14, hiddenMargin: 2,
};
/** Live room-owned cues, never reconstructed from snapshots or reconnects. */
export class ForestWerewolf extends ForestEncounter {
    private sounds: WorldSoundEvent[] = [];
    private growlAt = 0;
    private growlSerial = 0;
    constructor(world: WorldDefinition, random: () => number = Math.random,
        overrides: Partial<EncounterBehavior> = {}) {
        super(world, random, { ...WEREWOLF_DEFAULTS, ...overrides, kind: 'werewolf' });
    }
    override reset(now: number) {
        super.reset(now); this.sounds = []; this.growlAt = 0;
    }
    override update(now: number, players: readonly PlayerState[]) {
        const previous = this.state?.id, caught = super.update(now, players), s = this.state;
        if (s && s.id !== previous) {
            this.sounds.push({ id: `werewolf:${s.id}:howl`, kind: 'howl', x: s.x, y: s.y, createdAt: now, expiresAt: now + 1800 });
            this.growlAt = now + 3500;
        } else if (s?.phase === 'chase' && now >= this.growlAt) {
            this.sounds.push({ id: `werewolf:${s.id}:growl:${++this.growlSerial}`, kind: 'growl', x: s.x, y: s.y, createdAt: now, expiresAt: now + 1000 });
            this.growlAt = now + 2600;
        }
        return caught;
    }
    drainSounds() { return this.sounds.splice(0); }
}
