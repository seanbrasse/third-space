import type * as Phaser from 'phaser';
import { RACE_MAP, RACE_BOOST } from '@third-space/config';
import type { PlayerState } from '@third-space/contracts';

export function raceBoostLabel(player: PlayerState): string {
  const labels: string[] = [];
  if ((player.raceSpeedBoostSeconds ?? 0) > 0) labels.push(`SPEED +${Math.round((RACE_BOOST.speedMultiplier - 1) * 100)}% · ${player.raceSpeedBoostSeconds!.toFixed(1)}s`);
  if ((player.raceJumpBoostSeconds ?? 0) > 0) labels.push(`JUMP +${Math.round((RACE_BOOST.jumpMultiplier - 1) * 100)}% · ${player.raceJumpBoostSeconds!.toFixed(1)}s`);
  return labels.join('   ');
}
/** Scene owns every returned object and destroys it on world/race transition. */
export class RacePresentation {
  private pickups = new Map<string, Phaser.GameObjects.Container>();
  private status: Phaser.GameObjects.Text;
  constructor(scene: Phaser.Scene, tile: number, objects: Phaser.GameObjects.GameObject[]) {
    const palette = [0x6c956b, 0x678c9c, 0x99857c, 0x9b738d];
    for (const [i, stage] of RACE_MAP.stages.entries()) {
      objects.push(scene.add.rectangle((stage.x + 45) * tile, 15.85 * tile, 90 * tile, .12 * tile, palette[i]).setDepth(.5));
      objects.push(scene.add.text((stage.x + 2) * tile, 12.2 * tile, `${i + 1}/4  ${stage.name.toUpperCase()}\n${i ? 'Taller steps · wider spikes · creek gaps' : 'Arrows / A D + Space · collect >> speed and ^ jump'}`, {
        fontFamily: 'monospace', fontSize: '11px', color: '#304d42', lineSpacing: 4,
      }).setDepth(1));
    }
    for (const gap of RACE_MAP.gaps) {
      objects.push(scene.add.rectangle((gap.x + gap.width / 2) * tile, 17 * tile, gap.width * tile, 2 * tile, 0x517887).setDepth(.5));
      objects.push(scene.add.rectangle((gap.x + gap.width / 2) * tile, 16.15 * tile, gap.width * tile, 3, 0xa5ced0).setDepth(.5));
    }
    for (const pickup of RACE_MAP.pickups) {
      const base = scene.add.rectangle(0, 0, 23, 23, pickup.kind === 'speed' ? 0xf3ce67 : 0xbfabdf).setStrokeStyle(2, 0x52654c);
      const glyph = scene.add.text(0, 0, pickup.kind === 'speed' ? '>>' : '^', { fontFamily: 'monospace', fontSize: '16px', color: '#314838' }).setOrigin(.5);
      const node = scene.add.container(pickup.x * tile, pickup.y * tile, [base, glyph]).setDepth(2);
      this.pickups.set(pickup.id, node); objects.push(node);
    }
    this.status = scene.add.text(10, 0, '', { fontFamily: 'monospace', fontSize: '11px', color: '#fff6dc', backgroundColor: '#344b43', padding: { x: 7, y: 5 } }).setDepth(2100).setScrollFactor(0);
    objects.push(this.status);
  }
  update(self: PlayerState, time: number, height: number) {
    const collected = new Set(self.racePickupIds ?? []);
    for (const [id, node] of this.pickups) {
      node.setVisible(!collected.has(id));
      if (node.visible) node.setScale(1 + Math.sin(time / 250) * .06);
    }
    const camera = this.status.scene.cameras.main, zoom = camera.zoom;
    const boosts = raceBoostLabel(self);
    const text = camera.width < 520 ? boosts.replace('   ', '\n') : boosts;
    // Undo camera zoom for a legible fixed screen HUD on narrow viewports.
    this.status.setText(text).setScale(1 / zoom).setPosition(
      camera.width / 2 + (10 - camera.width / 2) / zoom,
      camera.height / 2 + (Math.max(10, height - (text.includes('\n') ? 52 : 34)) - camera.height / 2) / zoom,
    ).setVisible(!!boosts);
  }
}
