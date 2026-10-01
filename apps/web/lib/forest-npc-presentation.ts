import * as Phaser from 'phaser';
import type { ForestNPC } from '../../../packages/contracts/src/forest-npc';
import type { Facing, PlayerState } from '@third-space/contracts';
import { avatarPixelCanvas } from './pixel-art';
import { forestNPCBubblePoint } from './forest-npc-layout';

export type ForestNPCTextureFactory = (npc: ForestNPC, facing: Facing, frame: number) => HTMLCanvasElement;

interface View {
  sprite: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
  bubble: Phaser.GameObjects.Text;
  health: Phaser.GameObjects.Graphics;
}

/** Separate, explicitly labelled world actors. Texture count is bounded by cast × four facings × two frames. */
export class ForestNPCPresentation {
  private views = new Map<string, View>();
  private textureKeys = new Set<string>();
  constructor(private scene: Phaser.Scene, private interact: (id: string) => void, private texture: ForestNPCTextureFactory = (npc, facing, frame) => avatarPixelCanvas(npc.avatar, facing, frame)) {}

  update(npcs: readonly ForestNPC[], local: PlayerState, now: number, tile: number, reducedMotion = false) {
    const alive = new Set(npcs.map(n => n.id));
    for (const [id, view] of this.views) if (!alive.has(id)) { this.destroyView(view); this.views.delete(id); }
    const camera = this.scene.cameras.main;
    const origin = camera.getWorldPoint(0, 0);
    const zoom = camera.zoom || 1;
    const density = Number.isFinite(window.devicePixelRatio) ? Math.min(3, Math.max(1, window.devicePixelRatio)) : 1;
    for (const npc of npcs) {
      const x = npc.x * tile, y = npc.y * tile;
      const screenX = (x - origin.x) * zoom, screenY = (y - origin.y) * zoom;
      const visible = local.mode === 'home' && !local.zone && npc.phase !== 'respawning' && screenX > -tile && screenX < camera.width + tile && screenY > -tile && screenY < camera.height + tile * 2;
      let view = this.views.get(npc.id);
      // Do not allocate textures or display objects for actors that have never entered the viewport.
      if (!visible && !view) continue;
      const frame = reducedMotion || !npc.moving ? 0 : Math.floor(now / 300) % 2;
      const key = `forest-npc-v2:${npc.id}:${npc.facing}:${frame}`;
      if (visible && !this.scene.textures.exists(key)) {
        this.scene.textures.addCanvas(key, this.texture(npc, npc.facing, frame));
        this.textureKeys.add(key);
      }
      if (!view) {
        const sprite = this.scene.add.image(x, y, key).setOrigin(.5, 1).setDisplaySize(tile * .9, tile * 1.2).setInteractive({ useHandCursor: true });
        sprite.on('pointerdown', (_pointer: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => { event.stopPropagation(); this.interact(npc.id); });
        const label = this.scene.add.text(0, 0, '', { fontFamily: 'system-ui,sans-serif', fontSize: '11px', color: '#dbd1b5', backgroundColor: '#1c2622', padding: { x: 4, y: 2 }, align: 'center' }).setOrigin(.5, 1).setScrollFactor(0).setDepth(1889).setResolution(1);
        const bubble = this.scene.add.text(0, 0, '', { fontFamily: 'system-ui,sans-serif', fontSize: '13px', color: '#f6edd6', backgroundColor: '#21352a', padding: { x: 8, y: 5 }, align: 'center', wordWrap: { width: Math.max(80, Math.min(210, camera.width - 40)), useAdvancedWrap: true } }).setOrigin(.5, 1).setScrollFactor(0).setDepth(1891).setResolution(1);
        const health = this.scene.add.graphics().setDepth(1890);
        view = { sprite, label, bubble, health };
        this.views.set(npc.id, view);
      }
      for (const text of [view.label, view.bubble]) {
        // CanvasRenderer stores source density separately from TextStyle. Keep both in sync.
        if (text.style.resolution !== density || text.frame.source.resolution !== density) {
          text.frame.source.resolution = density;
          text.setResolution(density);
        }
      }
      view.sprite.setVisible(visible);
      view.label.setVisible(visible && Math.hypot(npc.x - local.x, npc.y - local.y) <= 5);
      view.health.clear().setVisible(visible && npc.health < npc.maxHealth);
      const talking = visible && !!npc.dialogue && npc.dialogue.until > now;
      view.bubble.setVisible(talking);
      if (!visible) continue;
      view.sprite.setTexture(key).setPosition(x, y).setDepth(y);
      // Text uses CSS pixels. Scroll-factor zero still applies camera zoom, so undo it in both scale and position.
      view.label.setScale(1 / zoom).setText(`${npc.name} · ${npc.role}`);
      const labelPoint = forestNPCBubblePoint(screenX, screenY - tile * 1.25 * zoom, view.label.width, view.label.height, camera.width, camera.height);
      view.label.setPosition(camera.width / 2 + (labelPoint.x - camera.width / 2) / zoom, camera.height / 2 + (labelPoint.y - camera.height / 2) / zoom);
      if (npc.health < npc.maxHealth) {
        const healthWidth = tile * .65, healthY = y - tile * 1.12;
        view.health.fillStyle(0x30232b, .95).fillRect(x - healthWidth / 2, healthY, healthWidth, 3 / zoom);
        view.health.fillStyle(0xbdcf92, 1).fillRect(x - healthWidth / 2, healthY, healthWidth * Math.max(0, npc.health / npc.maxHealth), 3 / zoom);
      }
      if (talking) {
        view.bubble.setScale(1 / zoom).setMaxLines(Math.max(1, Math.floor((camera.height - 26) / 16))).setWordWrapWidth(Math.max(80, Math.min(210, camera.width - 40)), true).setText(npc.dialogue!.text);
        const point = forestNPCBubblePoint(screenX, screenY - tile * 1.7 * zoom, view.bubble.width, view.bubble.height, camera.width, camera.height);
        view.bubble.setPosition(camera.width / 2 + (point.x - camera.width / 2) / zoom, camera.height / 2 + (point.y - camera.height / 2) / zoom);
        view.label.setVisible(false);
      }
    }
  }

  private destroyView(view: View) { view.sprite.destroy(); view.label.destroy(); view.bubble.destroy(); view.health.destroy(); }
  destroy() {
    for (const view of this.views.values()) this.destroyView(view);
    this.views.clear();
    for (const key of this.textureKeys) if (this.scene.textures.exists(key)) this.scene.textures.remove(key);
    this.textureKeys.clear();
  }
}
