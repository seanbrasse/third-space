import { FOREST_MAP } from '@third-space/config';
import { appleTreeCanvas } from './apple-tree-art';
import type * as Phaser from 'phaser';
import type { SurvivalSnapshot } from '../../../packages/contracts/src/survival';
import type { PlayerState } from '@third-space/contracts';
const TILE = 32;
/** Original small pixel assets. Apple interaction points stay below existing tree colliders. */
export function survivalAssetCanvas(kind: 'backpack' | 'apples' | 'knife'): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = 24;
    c.height = 28;
    const x = c.getContext('2d')!;
    x.imageSmoothingEnabled = false;
    if (kind === 'backpack') {
        x.fillStyle = '#101712';
        x.fillRect(5, 24, 15, 3);
        x.fillStyle = '#293c32';
        x.fillRect(7, 4, 10, 5);
        x.fillRect(4, 9, 16, 15);
        x.fillStyle = '#65794d';
        x.fillRect(6, 7, 12, 15);
        x.fillStyle = '#8a9664';
        x.fillRect(7, 8, 10, 3);
        x.fillStyle = '#384b36';
        x.fillRect(7, 15, 10, 7);
        x.fillStyle = '#d0b67a';
        x.fillRect(11, 14, 2, 3);
        x.fillStyle = '#40523b';
        x.fillRect(3, 11, 3, 11);
        x.fillRect(18, 11, 3, 11);
    }
    else if (kind === 'knife') {
        x.fillStyle='#1a2525';x.fillRect(10,18,4,9);
        x.fillStyle='#ae8354';x.fillRect(9,19,5,3);
        x.fillStyle='#e0e0c7';x.fillRect(11,4,3,15);x.fillRect(12,1,2,4);
        x.fillStyle='#89a7a0';x.fillRect(14,5,2,12);
    } else {
        for (const [a, b] of [[3, 9], [13, 3], [13, 17]]) {
            x.fillStyle = '#502027';
            x.fillRect(a, b + 2, 8, 7);
            x.fillStyle = '#b54b3e';
            x.fillRect(a + 1, b + 1, 6, 7);
            x.fillStyle = '#d87954';
            x.fillRect(a + 2, b + 2, 2, 2);
            x.fillStyle = '#7b9554';
            x.fillRect(a + 4, b - 1, 4, 2);
        }
    }
    return c;
}
export class SurvivalPresentation {
    private sprites = new Map<string, Phaser.GameObjects.Image>();
    private held = new Map<string, Phaser.GameObjects.Image>();
    private impacts: Phaser.GameObjects.Graphics;
    constructor(private scene: Phaser.Scene, private command: (command: {
        type: 'survival.pickup';
        backpackId: string;
    } | {
        type: 'survival.harvest';
        treeId: string;
    }) => void) { this.impacts=scene.add.graphics(); for (const kind of ['backpack', 'apples', 'knife'] as const) {
        const key = `survival-${kind}`;
        if (!scene.textures.exists(key))
            scene.textures.addCanvas(key, survivalAssetCanvas(kind));
    }
        for (const ripe of [true, false]) { const key = `survival-tree-${ripe}`; if (!scene.textures.exists(key)) scene.textures.addCanvas(key, appleTreeCanvas(ripe)); }
    }
    update(snapshot: SurvivalSnapshot | undefined, viewer: {
        x: number;
        y: number;
        zone?: string;
        mode: string;
    }, now: number, actors: readonly PlayerState[] = [], reducedMotion = false) {
        const wanted = new Set<string>();
        if (snapshot && !viewer.zone && viewer.mode === 'home') {
            for (const bag of snapshot.backpacks) {
                const key = `bag-${bag.id}`;
                wanted.add(key);
                const sprite = this.obtain(key, 'survival-backpack', () => this.command({ type: 'survival.pickup', backpackId: bag.id }));
                sprite.setPosition(bag.x * TILE, bag.y * TILE).setDepth(bag.y * TILE + .1).setVisible(Math.hypot(bag.x - viewer.x, bag.y - viewer.y) <= 12);
            }
            for (const tree of snapshot.appleTrees) {
                const key = `tree-${tree.id}`;
                wanted.add(key);
                const f = FOREST_MAP.furniture.find(item => item.id === tree.id)?.footprint;
                if (!f) continue;
                const texture = `survival-tree-${tree.readyAt <= now}`;
                const sprite = this.obtain(key, texture, () => this.command({ type: 'survival.harvest', treeId: tree.id }));
                sprite.setTexture(texture).setOrigin(0).setScale(1).setPosition(f.x * TILE, f.y * TILE)
                    .setDepth((f.y + f.height - .4) * TILE).setVisible(Math.hypot(tree.x - viewer.x, tree.y - viewer.y) <= 24);

            }
        }
        for (const [key, sprite] of this.sprites)
            if (!wanted.has(key)) {
                sprite.destroy();
                this.sprites.delete(key);
            }
        const wantedHeld=new Set<string>();this.impacts.clear();
        if(snapshot && !viewer.zone && viewer.mode==='home') {
            const inventory=new Map(snapshot.players.map(p=>[p.id,p]));
            for(const actor of actors) {
                if(actor.zone || actor.mode!=='home' || actor.respawnAt || !actor.connected || Math.hypot(actor.x-viewer.x,actor.y-viewer.y)>12)continue;
                const recent=snapshot.events.findLast(e=>e.kind==='swing'&&e.actorId===actor.id&&now-e.at<240);
                const item=inventory.get(actor.id);
                if(item?.equipped==='knife' && item.knifeId) {
                    wantedHeld.add(actor.id);let blade=this.held.get(actor.id);
                    if(!blade){blade=this.scene.add.image(0,0,'survival-knife').setOrigin(.5,.85).setScale(.8);this.held.set(actor.id,blade);}
                    const left=actor.facing==='left', swing=recent&&!reducedMotion?Math.max(0,1-(now-recent.at)/240):0;
                    blade.setPosition(actor.x*TILE+(left?-9:9),actor.y*TILE-5).setDepth(actor.y*TILE+1).setRotation((left?-1:1)*(.6+swing*1.4));
                    if(recent){this.impacts.lineStyle(2,0xd8cfab,.65);this.impacts.beginPath();this.impacts.arc(actor.x*TILE,actor.y*TILE-12,22,left?2: -.9,left?4.1:1.2);this.impacts.strokePath();}
                }
                if(snapshot.events.some(e=>e.kind==='hurt'&&e.actorId===actor.id&&now-e.at<250)) {
                    this.impacts.lineStyle(2,0xc47e59,.8);this.impacts.strokeEllipse(actor.x*TILE,actor.y*TILE-15,29,38);
                }
            }
        }
        this.impacts.setDepth(1900);
        for(const [id,sprite] of this.held)if(!wantedHeld.has(id)){sprite.destroy();this.held.delete(id);}
    }
    private obtain(id: string, key: string, onClick: () => void) { let sprite = this.sprites.get(id); if (!sprite) {
        sprite = this.scene.add.image(0, 0, key).setOrigin(.5, 1).setScale(1.5).setInteractive({ useHandCursor: true });
        sprite.on('pointerdown', (_pointer: unknown, _x: unknown, _y: unknown, event: {
            stopPropagation: () => void;
        }) => { event.stopPropagation(); onClick(); });
        this.sprites.set(id, sprite);
    } return sprite; }
    destroy() { for (const sprite of [...this.sprites.values(),...this.held.values()])
        sprite.destroy(); this.sprites.clear();this.held.clear();this.impacts.destroy(); }
}
