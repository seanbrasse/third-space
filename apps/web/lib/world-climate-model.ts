import { worldDayAt, type WorldClimateSnapshot, type WorldDayPhase, type WorldWeather } from '../../../packages/contracts/src/world-climate';

export const CLIMATE_VISUAL_LIMITS = Object.freeze({
    canvasWidth: 512,
    canvasHeight: 320,
    frameMs: 50,
    rainDrops: 48,
    leaves: 10,
    mistBanks: 4,
    maximumWashAlpha: .09,
    maximumMistAlpha: .05,
    transitionMs: 20_000,
});
const clamp = (v: number, min = 0, max = 1) => Math.min(max, Math.max(min, v));
const smooth = (v: number) => { const t = clamp(v); return t * t * (3 - 2 * t); };
export interface ClimateVisualState {
    phase: WorldDayPhase;
    daylight: number;
    /** Atmospheric base mask only; does not grant gameplay light protection. */
    darknessAlpha: number;
    weights: Record<WorldWeather, number>;
    weatherLabel: string;
    animated: boolean;
    washAlpha: number;
    washColor: string;
}
const LABELS: Record<WorldWeather, string> = { clear: 'Clear skies', drizzle: 'Light rain', mist: 'Low mist', breeze: 'A rustling breeze' };

/** Pure rendering projection. ServerTime must come from the snapshot clock. */
export function climateVisualState(snapshot: WorldClimateSnapshot, serverTime: number, reducedMotion = false): ClimateVisualState {
    // A stalled connection freezes at this weather window rather than inventing
    // future weather. Rejoin resumes from a fresh authoritative snapshot.
    const safeTime = Number.isFinite(serverTime) ? serverTime : snapshot.cycleStartedAt;
    const { phase, daylight } = worldDayAt(snapshot, safeTime);
    const transition = smooth((safeTime - snapshot.weatherStartedAt) / Math.max(CLIMATE_VISUAL_LIMITS.transitionMs, snapshot.transitionMs));
    const weights: Record<WorldWeather, number> = { clear: 0, drizzle: 0, mist: 0, breeze: 0 };
    weights[snapshot.previousWeather] += 1 - transition;
    weights[snapshot.weather] += transition;
    const washAlpha = .025 + weights.mist * .035 + weights.drizzle * .025 + (1 - daylight) * .02;
    return {
        phase, daylight, darknessAlpha: clamp(.96 - daylight * .53, .43, .96), weights,
        weatherLabel: LABELS[transition < .5 ? snapshot.previousWeather : snapshot.weather],
        animated: !reducedMotion,
        washAlpha: clamp(washAlpha, 0, CLIMATE_VISUAL_LIMITS.maximumWashAlpha),
        washColor: phase === 'dawn' || phase === 'dusk' ? '#d39d72' : daylight > .5 ? '#c5d5b3' : '#728caa',
    };
}
/** Never clears a sanctuary's existing light field or changes monster logic. */
export function climateDarknessFill(snapshot: WorldClimateSnapshot | undefined, serverTime: number): string {
    return snapshot ? `rgba(5,10,14,${climateVisualState(snapshot, serverTime).darknessAlpha.toFixed(4)})` : 'rgba(5,10,14,.96)';
}
export function climateLabel(snapshot: WorldClimateSnapshot, serverTime: number): string {
    const state = climateVisualState(snapshot, serverTime);
    return `${state.phase[0]!.toUpperCase()}${state.phase.slice(1)} · ${state.weatherLabel}`;
}
/** Independent deterministic coordinates; no growing particle lists. */
export function climateNoise(seed: number, index: number, axis: number): number {
    let value = (seed ^ Math.imul(index + 1, 0x9e3779b1) ^ Math.imul(axis + 1, 0x85ebca6b)) >>> 0;
    value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
    value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
    return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}
