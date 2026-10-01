import {LANTERN_CAVE,LANTERN_CAVE_ANCHOR} from '../../../packages/config/src/lantern-cave';
import * as Phaser from 'phaser';
import {FOREST_INTERIORS,WARD_CACHE_ANCHORS} from '../../../packages/config/src/authored-forest';
import type {WorldBridge} from './types';
import type {Point} from '@third-space/config';
export interface StoryAnchor extends Point {id:string;label:string;command:Record<string,unknown>}
export function storyWorldAnchors(bridge:WorldBridge):StoryAnchor[]{
  const stage=bridge.story?.story.chapter,world=bridge.snapshot?.worldId;
  if(world===LANTERN_CAVE.id&&bridge.stolen?.quest.stage==='find-cave')return [{id:'stolen-lantern',...LANTERN_CAVE_ANCHOR,label:'Recover Elsie’s lantern · E',command:{type:'lantern.recover'}}];
  if(stage==='wards'&&world==='forest')return WARD_CACHE_ANCHORS.map(p=>({...p,label:'Brass ward · E',command:{type:'story.recover',supplyId:p.id}}));
  if(stage==='inquiry'){
    const interior=FOREST_INTERIORS.find(i=>i.id===world);if(!interior?.clue)return [];
    const id=interior.buildingId==='keeper-house'?'ada-journal':'ward-rubbing';
    return [{id,...interior.clue.point,label:interior.buildingId==='keeper-house'?'Ada’s journal · E':'Ward rubbing · E',command:{type:'story.inspect',evidenceId:id}}];
  }
  return [];
}
/** Small shared clue props. Clicking/pressing E requests authority; it never advances progress locally. */
export class StoryWorldPresentation {
  private views=new Map<string,{art:Phaser.GameObjects.Graphics;label:Phaser.GameObjects.Text;hit:Phaser.GameObjects.Zone}>();
  constructor(private scene:Phaser.Scene,private command:(value:Record<string,unknown>)=>void){}
  update(anchors:readonly StoryAnchor[],local:Point,tile:number){
    const wanted=new Set(anchors.map(a=>a.id));for(const[id,v]of this.views)if(!wanted.has(id)){v.art.destroy();v.label.destroy();v.hit.destroy();this.views.delete(id);}
    for(const anchor of anchors){
      let view=this.views.get(anchor.id);
      if(!view){const art=this.scene.add.graphics(),label=this.scene.add.text(0,0,anchor.label,{fontFamily:'system-ui,sans-serif',fontSize:'12px',color:'#f1e3b3',backgroundColor:'#293a2c',padding:{x:5,y:3}}).setOrigin(.5,1).setDepth(11003);const hit=this.scene.add.zone(anchor.x*tile,anchor.y*tile,36,36).setInteractive({useHandCursor:true}).setDepth(anchor.y*tile+1);hit.on('pointerdown',(_p:Phaser.Input.Pointer,_x:number,_y:number,event:Phaser.Types.Input.EventData)=>{event.stopPropagation();this.command(anchor.command);});view={art,label,hit};this.views.set(anchor.id,view);}
      const d=Math.hypot(anchor.x-local.x,anchor.y-local.y),visible=d<24;view.art.clear().setVisible(visible).setDepth(anchor.y*tile);
      view.hit.setVisible(visible);view.label.setVisible(d<3).setPosition(anchor.x*tile,anchor.y*tile-18).setScale(1/(this.scene.cameras.main.zoom||1));
      if(visible&&anchor.id==='stolen-lantern'){view.art.lineStyle(2,0xe4d192,.8).strokeEllipse(anchor.x*tile,anchor.y*tile,28,12);}
      else if(visible){const x=anchor.x*tile,y=anchor.y*tile;view.art.fillStyle(0x213327,.85).fillEllipse(x,y+3,22,9);view.art.fillStyle(0xc6aa67).fillRect(x-9,y-13,18,13);view.art.lineStyle(2,0xf2de9d).strokeRect(x-8,y-12,16,11);view.art.fillStyle(0x6b6849).fillRect(x-4,y-9,8,2);}
    }
  }
  destroy(){for(const v of this.views.values()){v.art.destroy();v.label.destroy();v.hit.destroy();}this.views.clear();}
}
