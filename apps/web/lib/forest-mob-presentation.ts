import * as Phaser from 'phaser';
import type { PlayerState } from '@third-space/contracts';
import type { ForestMob, ForestMobSnapshot } from '../../../packages/contracts/src/forest-mobs';
import {lanternGoblinCanvas} from './lantern-cave-art';
import { forestMobCanvas } from './forest-mob-art';
import { forestNPCBubblePoint } from './forest-npc-layout';
import type { ScreenLabelLayout } from './screen-label-layout';

interface View { sprite: Phaser.GameObjects.Image; label: Phaser.GameObjects.Text; bar: Phaser.GameObjects.Graphics; ring: Phaser.GameObjects.Graphics }
export class ForestMobPresentation {
  private views = new Map<string, View>();
  private textureKeys = new Set<string>();
  constructor(private scene: Phaser.Scene, private attack: (mobId: string, targetLifeRevision: number) => void) {}
  update(snapshot: ForestMobSnapshot | undefined, local: PlayerState, now: number, tile: number, reducedMotion = false, labels?: ScreenLabelLayout) {
    const mobs = snapshot?.mobs ?? [], present = new Set(mobs.map(m => m.id));
    for (const [id, view] of this.views) if (!present.has(id)) { this.destroyView(view); this.views.delete(id); }
    const camera = this.scene.cameras.main, zoom = camera.zoom || 1, origin = camera.getWorldPoint(0, 0);
    for (const mob of mobs) {
      const x = mob.x * tile, y = mob.y * tile, sx = (x - origin.x) * zoom, sy = (y - origin.y) * zoom;
      const visible = local.mode === 'home' && !local.zone && sx > -tile * 2 && sy > -tile * 2 && sx < camera.width + tile * 2 && sy < camera.height + tile * 2 && (mob.phase !== 'defeated' || now - (mob.defeatedAt ?? 0) < 1800);
      let view = this.views.get(mob.id); if (!visible && !view) continue;
      const frame = reducedMotion || !mob.moving ? 0 : Math.floor(now / 230) % 2;
      const patrol=mob.id.startsWith('mob:stolen-lantern:');
      const key = `forest-mob-v1:${patrol?'lantern-goblin':mob.kind}:${mob.facing}:${frame}:${mob.phase === 'windup' ? 1 : 0}`;
      if (visible && !this.scene.textures.exists(key)) { this.scene.textures.addCanvas(key, patrol?lanternGoblinCanvas(mob.facing,frame,mob.phase==='windup'):forestMobCanvas(mob.kind, mob.facing, frame, mob.phase === 'windup')); this.textureKeys.add(key); }
      if (!view) {
        const sprite = this.scene.add.image(x, y, key).setOrigin(.5, 1).setInteractive({ useHandCursor: true });
        sprite.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => { event.stopPropagation(); const current = this.current.get(mob.id); if (current && current.health > 0) this.attack(current.id, current.lifeRevision); });
        const label = this.scene.add.text(0, 0, '', { fontFamily: 'system-ui,sans-serif', fontSize: '11px', color: '#f1dcc1', backgroundColor: '#362820', padding: { x: 5, y: 2 }, align: 'center' }).setOrigin(.5, 1).setScrollFactor(0).setDepth(11000);
        view = { sprite, label, bar: this.scene.add.graphics().setDepth(10990), ring: this.scene.add.graphics().setDepth(5) }; this.views.set(mob.id, view);
      }
      view.sprite.setVisible(visible); view.label.setVisible(visible && mob.health > 0 && !labels); view.bar.clear().setVisible(visible && mob.health > 0); view.ring.clear().setVisible(visible && !!mob.windup);
      if (!visible) continue;
      const size = mob.kind === 'rootbound-guardian' ? 1.55 : 1.1;
      view.sprite.setTexture(key).setPosition(x, y).setDisplaySize(tile * size, tile * size * 1.3).setDepth(y).setAlpha(mob.phase === 'defeated' ? .32 : mob.phase === 'returning' ? .62 : 1);
      // One finite impact tint; reduced motion retains the health change without pulses or shaking.
      if (!reducedMotion && mob.hurtAt && now - mob.hurtAt < 120) view.sprite.setTint(0xf2d4b4); else view.sprite.clearTint();
      const density = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
      if (view.label.style.resolution !== density || view.label.frame.source.resolution !== density) { view.label.frame.source.resolution = density; view.label.setResolution(density); }
      view.label.setScale(1 / zoom).setText(mob.phase === 'idle' ? `${mob.name}\n${patrol?'Hostile patrol · keep your distance':'Strike with knife to challenge'}` : `${mob.name} · ${mob.health}/${mob.maxHealth}`);
      const point = forestNPCBubblePoint(sx, sy - tile * size * 1.48 * zoom, view.label.width, view.label.height, camera.width, camera.height);
      view.label.setPosition(camera.width / 2 + (point.x - camera.width / 2) / zoom, camera.height / 2 + (point.y - camera.height / 2) / zoom);
      if (mob.health > 0) labels?.add({ id: `mob-label:${mob.id}`, rect: { x: point.x - view.label.width / 2, y: point.y - view.label.height, width: view.label.width, height: view.label.height }, priority: mob.phase === 'idle' ? 'idle-mob' : 'engaged-mob', distance: Math.hypot(mob.x - local.x, mob.y - local.y), setVisible: visible => view.label.setVisible(visible) });
      const width = tile * size * .75, barY = y - tile * size * 1.35;
      view.bar.fillStyle(0x30231f, .95).fillRect(x - width / 2, barY, width, 4 / zoom);
      view.bar.fillStyle(0xcb926b, 1).fillRect(x - width / 2, barY, width * Math.max(0, mob.health / mob.maxHealth), 4 / zoom);
      if (mob.windup) {
        // A steady, readable committed strike area; no flashing and no camera movement.
        view.ring.fillStyle(0xcb9457, .13).fillCircle(mob.windup.x * tile, mob.windup.y * tile, mob.windup.radius * tile);
        view.ring.lineStyle(2 / zoom, 0xe1ba79, .95).strokeCircle(mob.windup.x * tile, mob.windup.y * tile, mob.windup.radius * tile);
      }
    }
    this.current = new Map(mobs.map(m => [m.id, m]));
  }
  private current = new Map<string, ForestMob>();
  private destroyView(view: View) { view.sprite.destroy(); view.label.destroy(); view.bar.destroy(); view.ring.destroy(); }
  destroy() { for (const view of this.views.values()) this.destroyView(view); this.views.clear(); this.current.clear(); for (const key of this.textureKeys) if (this.scene.textures.exists(key)) this.scene.textures.remove(key); this.textureKeys.clear(); }
}
