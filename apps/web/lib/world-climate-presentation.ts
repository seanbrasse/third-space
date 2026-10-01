import type * as Phaser from 'phaser';
import type { WorldClimateSnapshot } from '../../../packages/contracts/src/world-climate';
import { CLIMATE_VISUAL_LIMITS } from './world-climate-model';
import { drawWorldClimate, type ClimateSanctuary } from './world-climate-art';

let textureSequence = 0;
/** One ~640 KiB RGBA canvas per client, one image, capped at 20 redraws/second. */
export class WorldClimatePresentation {
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private image: Phaser.GameObjects.Image;
    private texture: Phaser.Textures.CanvasTexture;
    private lastDrawAt = -Infinity;
    private key = `world-climate-${++textureSequence}`;
    private disposed = false;
    private wasReduced = false;
    constructor(private scene: Phaser.Scene) {
        this.canvas = document.createElement('canvas');
        this.canvas.width = CLIMATE_VISUAL_LIMITS.canvasWidth;
        this.canvas.height = CLIMATE_VISUAL_LIMITS.canvasHeight;
        this.ctx = this.canvas.getContext('2d')!;
        this.texture = scene.textures.addCanvas(this.key, this.canvas)!;
        this.image = scene.add.image(0, 0, this.key).setOrigin(0).setDepth(10010).setVisible(false);
    }
    update(snapshot: WorldClimateSnapshot | undefined, serverTime: number, renderTime: number,
        options: { outdoors: boolean; reducedMotion: boolean; effectsEnabled?: boolean; sanctuary?: ClimateSanctuary }): void {
        if (this.disposed) return;
        const visible = !!snapshot && options.outdoors && options.effectsEnabled !== false;
        this.image.setVisible(visible);
        if (!visible || !snapshot) { this.lastDrawAt = -Infinity; return; }
        const view = this.scene.cameras.main.worldView;
        if (view.width <= 0 || view.height <= 0) { this.image.setVisible(false); return; }
        this.image.setPosition(view.x, view.y).setDisplaySize(view.width, view.height);
        // Follow the camera every frame; only raster work is throttled. Motion
        // preference changes apply immediately, even within the throttle window.
        if (renderTime - this.lastDrawAt < CLIMATE_VISUAL_LIMITS.frameMs && options.reducedMotion === this.wasReduced) return;
        this.lastDrawAt = renderTime; this.wasReduced = options.reducedMotion;
        drawWorldClimate(this.ctx, snapshot, serverTime, view, options.sanctuary, options.reducedMotion);
        this.texture.refresh();
    }
    destroy(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.image.destroy();
        this.scene.textures.remove(this.key);
        this.canvas.width = this.canvas.height = 0;
    }
}
