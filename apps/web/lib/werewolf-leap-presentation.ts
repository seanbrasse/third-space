import type { ForestStalker } from '@third-space/contracts';
/** Presentation only: the authoritative feet, collision and damage never change here. */
export function werewolfLeapPresentation(leap: ForestStalker['leap'], serverTime: number, reducedMotion: boolean) {
    if (!leap) return { tell: null, elevation: 0, scaleX: 1, scaleY: 1, frame: null };
    const duration = Math.max(1, leap.until - leap.startedAt);
    const progress = Math.max(0, Math.min(1, (serverTime - leap.startedAt) / duration));
    const windup = leap.phase === 'windup';
    return {
        tell: { fromX: leap.fromX, fromY: leap.fromY, toX: leap.toX, toY: leap.toY },
        elevation: windup || reducedMotion ? 0 : Math.sin(progress * Math.PI) * 18,
        scaleX: windup ? 1.12 : 1,
        scaleY: windup ? .76 : 1,
        frame: windup || reducedMotion ? 0 : 3,
    };
}
