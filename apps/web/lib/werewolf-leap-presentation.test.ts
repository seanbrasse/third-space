import { describe, expect, it } from 'vitest';
import { werewolfLeapPresentation } from './werewolf-leap-presentation';
import type { ForestStalker } from '@third-space/contracts';
const windup: NonNullable<ForestStalker['leap']> = { phase: 'windup', startedAt: 1000, until: 1800, fromX: 40, fromY: 45, toX: 43.5, toY: 45 };
describe('werewolf leap visual tell', () => {
    it('shows a locked visible landing tell and crouch for the whole windup without moving feet', () => {
        for (const now of [1000, 1400, 1799]) {
            const visual = werewolfLeapPresentation(windup, now, false);
            expect(visual.tell).toEqual({ fromX: 40, fromY: 45, toX: 43.5, toY: 45 });
            expect(visual.elevation).toBe(0); expect(visual.scaleY).toBeLessThan(1); expect(visual.frame).toBe(0);
        }
    });
    it('hops at mid-flight but returns to the same ground reference at landing', () => {
        const air = { ...windup, phase: 'air' as const, startedAt: 1800, until: 2250 };
        expect(werewolfLeapPresentation(air, 1800, false).elevation).toBe(0);
        expect(werewolfLeapPresentation(air, 2025, false).elevation).toBe(18);
        expect(werewolfLeapPresentation(air, 2250, false).elevation).toBeCloseTo(0);
        expect(werewolfLeapPresentation(air, 99999, false).elevation).toBeCloseTo(0);
        expect(air).toEqual({ ...windup, phase: 'air', startedAt: 1800, until: 2250 });
    });
    it('retains the static warning in reduced motion and suppresses flight elevation', () => {
        const crouch = werewolfLeapPresentation(windup, 1400, true);
        expect(crouch.tell).not.toBeNull(); expect(crouch.scaleY).toBe(.76);
        const air = werewolfLeapPresentation({ ...windup, phase: 'air', startedAt: 1800, until: 2250 }, 2025, true);
        expect(air.tell).toEqual(crouch.tell); expect(air.elevation).toBe(0); expect(air.frame).toBe(0);
    });
    it('clears all presentation changes when leap is absent or the actor is hidden', () => {
        expect(werewolfLeapPresentation(undefined, 1000, false)).toEqual({ tell: null, elevation: 0, scaleX: 1, scaleY: 1, frame: null });
    });
    it('clamps out-of-order clocks and tolerates zero-duration snapshot fields', () => {
        expect(werewolfLeapPresentation({ ...windup, phase: 'air' }, 900, false).elevation).toBe(0);
        expect(Number.isFinite(werewolfLeapPresentation({ ...windup, phase: 'air', until: 1000 }, 1000, false).elevation)).toBe(true);
    });
});
