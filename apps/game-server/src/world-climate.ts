import type { WorldClimateSnapshot, WorldWeather } from '../../../packages/contracts/src/world-climate';

export const WORLD_CLIMATE_RULES = Object.freeze({
    epochMs: Date.UTC(2026, 0, 1),
    cycleMs: 32 * 60_000,
    weatherMs: 6 * 60_000,
    transitionMs: 20_000,
});

/** Tiny deterministic mixer: not security-sensitive randomness. */
function mix(value: number): number {
    value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
    value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
    return (value ^ (value >>> 16)) >>> 0;
}
function roomSeed(homeId: string): number {
    let seed = 2166136261;
    for (let i = 0; i < homeId.length; i++) seed = Math.imul(seed ^ homeId.charCodeAt(i), 16777619);
    return seed >>> 0;
}
const WEATHER: readonly WorldWeather[] = ['clear', 'clear', 'drizzle', 'clear', 'mist', 'breeze', 'drizzle', 'clear'];
function weatherSeed(seed: number, window: number): number { return mix(seed ^ Math.imul(window, 0x9e3779b1)); }
function weatherFor(seed: number, window: number): WorldWeather { return WEATHER[weatherSeed(seed, window) % WEATHER.length]!; }

/**
 * O(1), no timers, mutation, per-player simulation, or stored history. A room
 * restart/late join resolves the same conditions from the same home id/time.
 * Compute once per sendSnapshots(), outside the recipient loop.
 */
export function worldClimateAt(serverTime: number, homeId: string): WorldClimateSnapshot {
    if (!Number.isSafeInteger(serverTime) || Math.abs(serverTime) > 8_640_000_000_000_000) throw new RangeError('Climate time must be a safe integer timestamp.');
    const { epochMs, cycleMs, weatherMs, transitionMs } = WORLD_CLIMATE_RULES;
    const elapsed = serverTime - epochMs;
    if (!Number.isSafeInteger(elapsed)) throw new RangeError('Climate time is outside the supported timestamp range.');
    const day = Math.floor(elapsed / cycleMs);
    const window = Math.floor(elapsed / weatherMs);
    const seed = roomSeed(homeId);
    const weatherStartedAt = epochMs + window * weatherMs;
    return {
        version: 1,
        cycleStartedAt: epochMs + day * cycleMs,
        cycleDurationMs: cycleMs,
        day,
        weather: weatherFor(seed, window),
        previousWeather: weatherFor(seed, window - 1),
        weatherStartedAt,
        weatherEndsAt: weatherStartedAt + weatherMs,
        transitionMs,
        seed,
        wind: seed % 2 ? 1 : -1,
    };
}
