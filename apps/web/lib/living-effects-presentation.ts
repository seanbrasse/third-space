import type * as Phaser from 'phaser';
import type {PlayerState} from '@third-space/contracts';
import type {ForestNPC} from '../../../packages/contracts/src/forest-npc';
import {potionMultipliers} from '../../../packages/simulation/src/living-world-rules';

type Mark={x:number;y:number;at:number};
/** One graphics object, at most32 short trail marks. Teleports and reduced motion clear history. */
export class LivingEffectsPresentation {
  private graphics:Phaser.GameObjects.Graphics;
  private trails=new Map<string,{scope:string;marks:Mark[]}>();
  constructor(private scene:Phaser.Scene){this.graphics=scene.add.graphics().setDepth(2);}
  update(players:readonly PlayerState[],npcs:readonly ForestNPC[],viewer:PlayerState,now:number,tile:number,reducedMotion:boolean){
    const g=this.graphics;g.clear();const alive=new Set<string>();
    for(const p of players.slice(0,8)){
      if(p.mode!=='home'||p.respawnAt||!p.connected||p.zone!==viewer.zone||Math.hypot(p.x-viewer.x,p.y-viewer.y)>14)continue;
      if(reducedMotion||potionMultipliers(p.potionEffects??[],now).speed===1||Math.hypot(p.vx,p.vy)<.1)continue;
      alive.add(p.id);const scope=`${p.zone??'outside'}:${p.zoneRevision??0}:${p.respawnCount??0}`;
      let trail=this.trails.get(p.id);const previous=trail?.marks.at(-1);
      if(!trail||trail.scope!==scope||previous&&Math.hypot(previous.x-p.x,previous.y-p.y)>2)trail={scope,marks:[]};
      trail.marks=trail.marks.filter(m=>now-m.at<320);
      if(!trail.marks.length||now-trail.marks.at(-1)!.at>=80)trail.marks.push({x:p.x,y:p.y,at:now});
      trail.marks=trail.marks.slice(-4);this.trails.set(p.id,trail);
      for(const m of trail.marks){const alpha=.22*Math.max(0,1-(now-m.at)/320);g.fillStyle(0xa4d7c1,alpha).fillEllipse(m.x*tile,m.y*tile-12,17,27);g.lineStyle(2,0xd4e4bd,alpha).lineBetween(m.x*tile-9,m.y*tile-7,m.x*tile+8,m.y*tile-7);}
    }
    for(const id of this.trails.keys())if(!alive.has(id))this.trails.delete(id);
    if(viewer.zone||viewer.mode!=='home')return;
    // Fixed, original task props make work legible even in reduced-motion mode.
    for(const n of npcs.slice(0,36)){
      if(n.phase==='respawning'||Math.hypot(n.x-viewer.x,n.y-viewer.y)>14)continue;
      const x=n.x*tile+10,y=n.y*tile-5,beat=reducedMotion?0:Math.floor(now/400)%2;
      if(n.activity==='fruit-picking'){
        g.fillStyle(0x61482e,1).fillRect(x-3,y-9,13,9);g.fillStyle(0xb99961,1).fillRect(x-2,y-8,11,2);g.fillStyle(0xc48245,1).fillCircle(x+2,y-9,3).fillCircle(x+6,y-9-beat*2,3);
      }else if(n.activity==='washing'){
        g.fillStyle(0x688b8a,1).fillEllipse(x,y-2,19,10);g.fillStyle(0xcbd3ad,1).fillRect(x-5,y-10-beat*2,10,8);g.lineStyle(1,0xa7c9be,.8).lineBetween(x-8,y,x+7,y);
      }else if(n.activity==='woodwork'){
        g.fillStyle(0x8b6740,1).fillRect(x-9,y-2,22,6);g.lineStyle(3,0xc6c7a6,1).lineBetween(x-5+beat*3,y-5,x+8+beat*3,y-10);g.fillStyle(0x543e2d,1).fillRect(x+8+beat*3,y-13,5,5);
      }
    }
  }
  destroy(){this.graphics.destroy();this.trails.clear();}
}
