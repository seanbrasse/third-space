/** Shared outdoor clock. All timestamps are authoritative server milliseconds. */
export type WorldWeather = 'clear' | 'drizzle' | 'mist' | 'breeze';
export type WorldDayPhase = 'dawn' | 'day' | 'dusk' | 'night';
export interface WorldClimateSnapshot {
    version: 1;
    /** Stable across room disposal/recreation; never the transport epoch. */
    cycleStartedAt: number;
    cycleDurationMs: number;
    day: number;
    weather: WorldWeather;
    previousWeather: WorldWeather;
    weatherStartedAt: number;
    weatherEndsAt: number;
    transitionMs: number;
    /** Cosmetic particle layout only. Never used for loot, combat or rewards. */
    seed: number;
    wind: -1 | 1;
}

/** Shared phase projection for server NPC routines and client ambience. */
export function worldDayAt(clock: Pick<WorldClimateSnapshot, 'cycleStartedAt' | 'cycleDurationMs'>, serverTime: number): { phase: WorldDayPhase; daylight: number; progress: number } {
    const safeTime = Number.isFinite(serverTime) ? serverTime : clock.cycleStartedAt;
    const cycleMs = Math.max(1, clock.cycleDurationMs);
    const progress = ((safeTime - clock.cycleStartedAt) % cycleMs + cycleMs) % cycleMs / cycleMs;
    const phase: WorldDayPhase = progress < .125 ? 'dawn' : progress < .625 ? 'day' : progress < .75 ? 'dusk' : 'night';
    const smooth = (v: number) => { const t = Math.min(1, Math.max(0, v)); return t * t * (3 - 2 * t); };
    const daylight = phase === 'dawn' ? smooth(progress / .125) : phase === 'day' ? 1 : phase === 'dusk' ? 1 - smooth((progress - .625) / .125) : 0;
    return { phase, daylight, progress };
}
