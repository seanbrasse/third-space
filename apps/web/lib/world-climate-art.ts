import type { WorldClimateSnapshot } from '../../../packages/contracts/src/world-climate';
import { CLIMATE_VISUAL_LIMITS as LIMITS, climateNoise, climateVisualState } from './world-climate-model';

export interface ClimateView { x: number; y: number; width: number; height: number }
export interface ClimateSanctuary { x: number; y: number; radius: number }
const wrap = (value: number, size: number) => ((value % size) + size) % size;

/** Original pixel-weather artwork. One fixed canvas, <=62 moving marks, no audio. */
export function drawWorldClimate(
    ctx: CanvasRenderingContext2D,
    snapshot: WorldClimateSnapshot,
    serverTime: number,
    view: ClimateView,
    sanctuary?: ClimateSanctuary,
    reducedMotion = false,
): void {
    const width = ctx.canvas.width, height = ctx.canvas.height;
    ctx.clearRect(0, 0, width, height);
    if (view.width <= 0 || view.height <= 0 || !Number.isFinite(view.width + view.height + view.x + view.y)) return;
    const state = climateVisualState(snapshot, serverTime, reducedMotion);
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = state.washColor;
    ctx.globalAlpha = state.washAlpha;
    ctx.fillRect(0, 0, width, height);
    // Layout stays fixed across adjacent weather windows. Only the mix changes,
    // so a transition cannot jump from one rain/mist pattern to another.
    const patternSeed = snapshot.seed;
    const elapsed = Number.isFinite(serverTime) ? serverTime / 1000 : 0;
    if (state.animated && state.weights.drizzle > .001) {
        ctx.fillStyle = '#b7d6d8';
        ctx.globalAlpha = .19 * state.weights.drizzle;
        for (let i = 0; i < LIMITS.rainDrops; i++) {
            const speed = 36 + climateNoise(patternSeed, i, 2) * 28;
            const x = Math.floor(wrap(climateNoise(patternSeed, i, 0) * width + elapsed * 9 * snapshot.wind, width));
            const y = Math.floor(wrap(climateNoise(patternSeed, i, 1) * height + elapsed * speed, height + 8)) - 8;
            ctx.fillRect(x, y, 1, 4);
            ctx.fillRect(x - 1, y - 2, 1, 2);
        }
    }
    if (state.weights.mist > .001) {
        for (let i = 0; i < LIMITS.mistBanks; i++) {
            const drift = state.animated ? Math.sin(elapsed / 30 + i) * width * .07 : 0;
            const x = climateNoise(patternSeed, i, 3) * width + drift;
            const y = height * (.25 + climateNoise(patternSeed, i, 4) * .6);
            ctx.save();
            ctx.translate(x, y);
            ctx.scale(1, .22);
            const radius = width * .42;
            const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
            gradient.addColorStop(0, '#c5d7ce'); gradient.addColorStop(1, 'rgba(197,215,206,0)');
            ctx.fillStyle = gradient;
            ctx.globalAlpha = LIMITS.maximumMistAlpha * state.weights.mist;
            ctx.fillRect(-radius, -radius, radius * 2, radius * 2);
            ctx.restore();
        }
    }
    if (state.animated && state.weights.breeze > .001) {
        ctx.fillStyle = '#b9ae73';
        ctx.globalAlpha = .32 * state.weights.breeze;
        for (let i = 0; i < LIMITS.leaves; i++) {
            const x = Math.floor(wrap(climateNoise(patternSeed, i, 5) * width + elapsed * 13 * snapshot.wind, width + 8)) - 4;
            const y = Math.floor(wrap(climateNoise(patternSeed, i, 6) * height + elapsed * 4 + Math.sin(elapsed + i) * 5, height));
            ctx.fillRect(x, y, 3, 1); ctx.fillRect(x + 1, y + 1, 2, 1);
        }
    }
    ctx.globalAlpha = 1;
    // Feather every weather mark away from the shared fire/watch sanctuary.
    // x/y/radius are world pixels, matching Phaser's worldView units.
    if (sanctuary && sanctuary.radius > 0) {
        const sx = width / view.width, sy = height / view.height;
        ctx.save();
        ctx.translate((sanctuary.x - view.x) * sx, (sanctuary.y - view.y) * sy);
        ctx.scale(sx, sy);
        const fade = ctx.createRadialGradient(0, 0, sanctuary.radius * .72, 0, 0, sanctuary.radius);
        fade.addColorStop(0, 'rgba(0,0,0,1)'); fade.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.globalCompositeOperation = 'destination-out'; ctx.fillStyle = fade;
        ctx.fillRect(-sanctuary.radius, -sanctuary.radius, sanctuary.radius * 2, sanctuary.radius * 2);
        ctx.restore();
    }
    ctx.restore();
}
