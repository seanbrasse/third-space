import type * as Phaser from 'phaser';
import type {PlayerState,RoomSnapshot} from '@third-space/contracts';
type Mark={kind:'ward'|'snare'|'tell';x:number;y:number;radius:number};
/** Bounded snapshot-only marks; a steady outline remains in reduced motion. */
export function spiritMarks(players:readonly PlayerState[],pulses:NonNullable<RoomSnapshot['spiritPulses']>,viewer:PlayerState,now:number):Mark[]{
  if(viewer.mode!=='home'||viewer.zone||!Number.isFinite(now))return [];
  const marks:Mark[]=[];
  for(const p of players.slice(0,8)){
    if(p.mode!=='home'||p.zone||p.respawnAt||!p.connected||Math.hypot(p.x-viewer.x,p.y-viewer.y)>14)continue;
    if((p.spiritEffects?.wardUntil??0)>now)marks.push({kind:'ward',x:p.x,y:p.y,radius:4});
    else if((p.spiritEffects?.snareUntil??0)>now)marks.push({kind:'snare',x:p.x,y:p.y,radius:.55});
  }
  for(const pulse of pulses.slice(0,1))if(pulse.until>now&&pulse.radius>0&&pulse.radius<=2&&Math.hypot(pulse.x-viewer.x,pulse.y-viewer.y)<14)marks.push({kind:'tell',x:pulse.x,y:pulse.y,radius:pulse.radius});
  return marks;
}
export class SpiritPresentation{
  private art:Phaser.GameObjects.Graphics;
  constructor(scene:Phaser.Scene){this.art=scene.add.graphics().setDepth(10002);}
  update(players:readonly PlayerState[],pulses:NonNullable<RoomSnapshot['spiritPulses']>,viewer:PlayerState,now:number,tile:number){
    const g=this.art;g.clear();
    for(const m of spiritMarks(players,pulses,viewer,now)){
      const x=m.x*tile,y=m.y*tile,r=m.radius*tile,color=m.kind==='ward'?0xe5d09a:0xc19bc7;
      g.lineStyle(m.kind==='ward'?1:2,color,m.kind==='ward'?.4:.95).strokeCircle(x,y,r);
      if(m.kind==='tell')g.fillStyle(color,.12).fillCircle(x,y,r);
      if(m.kind==='snare')g.lineStyle(2,color,.9).lineBetween(x-r,y-5,x+r,y+5).lineBetween(x-r,y+5,x+r,y-5);
    }
  }
  destroy(){this.art.destroy();}
}
