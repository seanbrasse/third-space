import type { ForestMimicState } from '@third-space/contracts';
/** Pure snapshot presentation; repeated renders and reconnects never emit a cue or decide damage. */
export function mimicPresentation(state: ForestMimicState, now: number, reducedMotion: boolean) {
    const morph = state.phase === 'morph';
    const progress = morph ? Math.max(0, Math.min(1, (now - (state.phaseUntil - 1600)) / 1600)) : state.transformed ? 1 : 0;
    const monster = state.transformed || morph;
    return {
        monster, progress,
        avatarAlpha: monster ? 1 - progress : 1,
        monsterAlpha: monster ? progress * (state.phase === 'retreat' ? Math.max(0, (state.phaseUntil - now) / 900) : 1) : 0,
        frame: reducedMotion || state.phase !== 'chase' ? 0 : Math.floor((now - state.startedAt) / 110) % 4,
        rotation: reducedMotion || !monster ? 0 : Math.sin((now - state.startedAt) / 95) * .055,
    };
}
