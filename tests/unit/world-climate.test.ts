import { describe, expect, it } from 'vitest';
import { worldClimateAt, WORLD_CLIMATE_RULES as RULES } from '../../apps/game-server/src/world-climate';
import { worldDayAt } from '../../packages/contracts/src/world-climate';
import { CLIMATE_VISUAL_LIMITS as LIMITS, climateVisualState, climateNoise, climateDarknessFill, climateLabel } from '../../apps/web/lib/world-climate-model';
import { drawWorldClimate } from '../../apps/web/lib/world-climate-art';

const at = (offset = 0, home = 'firelight') => worldClimateAt(RULES.epochMs + offset, home);
function drawingContext() {
    const calls: { operation: string; args: unknown[]; alpha: number; blend: string }[] = [];
    const context: Record<string, unknown> = {
        canvas: { width: LIMITS.canvasWidth, height: LIMITS.canvasHeight },
        globalAlpha: 1, globalCompositeOperation: 'source-over',
    };
    for (const method of ['clearRect', 'save', 'restore', 'fillRect', 'translate', 'scale']) {
        context[method] = (...args: unknown[]) => { calls.push({ operation: method, args, alpha: context.globalAlpha as number, blend: context.globalCompositeOperation as string }); };
    }
    context.createRadialGradient = (...args: number[]) => {
        calls.push({ operation: 'gradient', args, alpha: context.globalAlpha as number, blend: context.globalCompositeOperation as string });
        return { addColorStop() {} };
    };
    return { ctx: context as unknown as CanvasRenderingContext2D, calls };
}

describe('authoritative shared climate', () => {
    it('gives eight spread clients and a recreated room exactly the same compact state', () => {
        const now = RULES.epochMs + RULES.cycleMs * 172 + 832_125;
        const recipients = Array.from({ length: 8 }, () => worldClimateAt(now, 'private-home-123'));
        for (const snapshot of recipients) expect(snapshot).toEqual(recipients[0]);
        expect(JSON.parse(JSON.stringify(recipients[0]))).toEqual(worldClimateAt(now, 'private-home-123'));
        expect(JSON.stringify(recipients[0]).length).toBeLessThan(340);
    });
    it('rolls the day and weather at exact boundaries without accumulating simulation ticks', () => {
        expect(at(RULES.cycleMs - 1).day).toBe(0);
        expect(at(RULES.cycleMs).day).toBe(1);
        expect(at(RULES.cycleMs).cycleStartedAt).toBe(RULES.epochMs + RULES.cycleMs);
        const before = at(RULES.weatherMs - 1), after = at(RULES.weatherMs);
        expect(after.previousWeather).toBe(before.weather);
        expect(before.weatherEndsAt).toBe(after.weatherStartedAt);
        expect(after.seed).toBe(before.seed);
        expect(after.wind).toBe(before.wind);
    });
    it('supports rollback/pre-epoch timestamps deterministically and rejects malformed clocks', () => {
        expect(at(-1).day).toBe(-1);
        expect(at(-1).weatherEndsAt).toBe(RULES.epochMs);
        expect(at(-1)).toEqual(at(-1));
        for (const invalid of [NaN, Infinity, -Infinity, 1.5, Number.MAX_SAFE_INTEGER]) {
            expect(() => worldClimateAt(invalid, 'home')).toThrow(RangeError);
        }
    });
    it('produces all calm weather types, with shared day phase but room-specific conditions', () => {
        const seen = new Set<string>();
        let different = false;
        for (let i = 0; i < 200; i++) {
            const a = at(i * RULES.weatherMs), b = at(i * RULES.weatherMs, 'another-home');
            seen.add(a.weather); different ||= a.weather !== b.weather;
            expect(a.cycleStartedAt).toBe(b.cycleStartedAt);
            expect(a.weatherEndsAt - a.weatherStartedAt).toBe(RULES.weatherMs);
        }
        expect([...seen].sort()).toEqual(['breeze', 'clear', 'drizzle', 'mist']);
        expect(different).toBe(true);
    });
    it('does not retain mutable state from earlier recipients', () => {
        const first = at(23_000); first.weather = 'mist'; first.day = 999;
        expect(at(23_000)).not.toEqual(first);
    });
});

describe('bounded climate projection', () => {
    it('shares four exact phases with NPC routines and has continuous bounded daylight', () => {
        const snapshot = at();
        const checks = [[0, 'dawn'], [.1249, 'dawn'], [.125, 'day'], [.6249, 'day'], [.625, 'dusk'], [.75, 'night'], [.9999, 'night']] as const;
        for (const [progress, phase] of checks) expect(worldDayAt(snapshot, RULES.epochMs + progress * RULES.cycleMs).phase).toBe(phase);
        for (let i = 0; i < RULES.cycleMs; i += 997) {
            const now = RULES.epochMs + i, value = climateVisualState(snapshot, now);
            expect(value.daylight).toBeGreaterThanOrEqual(0); expect(value.daylight).toBeLessThanOrEqual(1);
            expect(value.darknessAlpha).toBeGreaterThanOrEqual(.43); expect(value.darknessAlpha).toBeLessThanOrEqual(.96);
            expect(Math.abs(value.daylight - worldDayAt(snapshot, now + 1).daylight)).toBeLessThan(.0001);
        }
    });
    it('crossfades weather continuously across authoritative window boundaries', () => {
        for (let i = 1; i < 80; i++) {
            const boundary = RULES.epochMs + i * RULES.weatherMs;
            const before = climateVisualState(worldClimateAt(boundary - 1, 'home'), boundary - 1);
            const after = climateVisualState(worldClimateAt(boundary, 'home'), boundary);
            expect(after.weights).toEqual(before.weights);
            const blended = climateVisualState(worldClimateAt(boundary + 10_000, 'home'), boundary + 10_000);
            expect(Object.values(blended.weights).reduce((a, b) => a + b)).toBeCloseTo(1);
        }
    });
    it('keeps readable limits and finite output throughout a simulated week', () => {
        for (let i = 0; i < 7 * 24 * 60; i++) {
            const now = RULES.epochMs + i * 60_000, snapshot = worldClimateAt(now, 'home');
            const visual = climateVisualState(snapshot, now);
            expect(visual.washAlpha).toBeLessThanOrEqual(LIMITS.maximumWashAlpha);
            expect(Object.values(visual.weights).every(v => Number.isFinite(v) && v >= 0 && v <= 1)).toBe(true);
            expect(climateLabel(snapshot, now)).toMatch(/^(Dawn|Day|Dusk|Night) · /);
        }
        expect(climateDarknessFill(undefined, 0)).toContain('.96');
    });
    it('uses static reduced-motion ambience and stable bounded particle noise', () => {
        const snapshot = at(44_000);
        expect(climateVisualState(snapshot, RULES.epochMs, true).animated).toBe(false);
        for (let i = 0; i < 62; i++) for (let axis = 0; axis < 7; axis++) {
            const value = climateNoise(snapshot.seed, i, axis);
            expect(value).toBeGreaterThanOrEqual(0); expect(value).toBeLessThan(1);
            expect(value).toBe(climateNoise(snapshot.seed, i, axis));
        }
    });
});

describe('fixed-budget original canvas weather', () => {
    it('bounds every weather draw and retains finite geometry on large maps', () => {
        for (const weather of ['clear', 'drizzle', 'mist', 'breeze'] as const) {
            const { ctx, calls } = drawingContext();
            drawWorldClimate(ctx, { ...at(), weather, previousWeather: weather }, RULES.epochMs + 4000,
                { x: 128 * 32, y: 96 * 32, width: 1440, height: 900 }, { x: 24 * 32, y: 24 * 32, radius: 9 * 32 });
            expect(calls.filter(c => c.operation === 'fillRect').length).toBeLessThanOrEqual(2 * LIMITS.rainDrops + 2);
            expect(calls.flatMap(c => c.args).filter(v => typeof v === 'number').every(Number.isFinite)).toBe(true);
            expect(calls.filter(c => c.operation === 'fillRect' && c.blend === 'source-over').every(c => c.alpha <= .32)).toBe(true);
            expect(calls.some(c => c.blend === 'destination-out')).toBe(true);
        }
    });
    it('has no falling rain/leaves under reduced motion; static mist remains bounded', () => {
        for (const weather of ['clear', 'drizzle', 'breeze'] as const) {
            const { ctx, calls } = drawingContext();
            drawWorldClimate(ctx, { ...at(), weather, previousWeather: weather }, RULES.epochMs,
                { x: 0, y: 0, width: 704, height: 704 }, undefined, true);
            expect(calls.filter(c => c.operation === 'fillRect')).toHaveLength(1);
        }
        const { ctx, calls } = drawingContext();
        drawWorldClimate(ctx, { ...at(), weather: 'mist', previousWeather: 'mist' }, RULES.epochMs,
            { x: 0, y: 0, width: 704, height: 704 }, undefined, true);
        expect(calls.filter(c => c.operation === 'fillRect')).toHaveLength(1 + LIMITS.mistBanks);
    });
    it('clears and exits safely before a camera has valid dimensions', () => {
        const { ctx, calls } = drawingContext();
        drawWorldClimate(ctx, at(), RULES.epochMs, { x: 0, y: 0, width: 0, height: 0 });
        expect(calls.map(c => c.operation)).toEqual(['clearRect']);
    });
});

it('caps raster work at 20 Hz and disposes the single texture without lingering scene objects', async () => {
    const { WorldClimatePresentation } = await import('../../apps/web/lib/world-climate-presentation');
    const { ctx, calls } = drawingContext();
    const canvas = { width: 0, height: 0, getContext: () => ctx };
    const originalDocument = globalThis.document;
    Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => canvas } });
    let refreshes = 0, removals = 0, destroyed = 0, visible = false;
    const image = {
        setOrigin: () => image, setDepth: () => image,
        setVisible: (v: boolean) => { visible = v; return image; },
        setPosition: () => image, setDisplaySize: () => image,
        destroy: () => { destroyed++; },
    };
    const scene = {
        textures: { addCanvas: () => ({ refresh: () => { refreshes++; } }), remove: () => { removals++; } },
        add: { image: () => image },
        cameras: { main: { worldView: { x: 0, y: 0, width: 704, height: 704 } } },
    };
    try {
        const renderer = new WorldClimatePresentation(scene as never);
        expect(canvas.width * canvas.height * 4).toBeLessThanOrEqual(655_360);
        for (let frame = 0; frame < 60; frame++) renderer.update(at(), RULES.epochMs + frame * 17, frame * 17, { outdoors: true, reducedMotion: false });
        expect(refreshes).toBeLessThanOrEqual(20); expect(visible).toBe(true);
        renderer.update(at(), RULES.epochMs + 1004, 1004, { outdoors: false, reducedMotion: false });
        const stopped = calls.length;
        renderer.update(at(), RULES.epochMs + 1050, 1050, { outdoors: true, reducedMotion: false, effectsEnabled: false });
        expect(visible).toBe(false); expect(calls).toHaveLength(stopped);
        renderer.destroy(); renderer.destroy();
        expect(destroyed).toBe(1); expect(removals).toBe(1); expect(canvas.width).toBe(0);
    } finally {
        if (originalDocument) Object.defineProperty(globalThis, 'document', { configurable: true, value: originalDocument });
        else Reflect.deleteProperty(globalThis, 'document');
    }
});
