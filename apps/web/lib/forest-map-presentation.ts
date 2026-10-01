import * as Phaser from 'phaser';
import type {Furniture,WorldMap} from '@third-space/config';
import {authoredBuildingStyle,authoredTreeStyle} from '../../../packages/config/src/authored-forest';
import {authoredForestObjectCanvas,paintAuthoredForestFloorTile} from './authored-forest-art';
import {forestObjectCanvas} from './forest-art';
import {FOREST_STREAMING,forestChunkKeys,forestVisibleChunkKeys} from './forest-streaming';
import {forestStoryBoardCanvas} from './forest-story-board-art';

/** Rendering interest only. Server actors, collisions and story never depend on these chunks. */
export class ForestMapPresentation {
  private floors=new Map<string,Phaser.GameObjects.Image>();
  private floorTextures=new Map<string,string>();
  private objects=new Map<string,Phaser.GameObjects.Image>();
  private objectTextures=new Set<string>();
  private cells=new Map<string,Furniture[]>();
  constructor(private scene:Phaser.Scene,private map:WorldMap,private tile:number,private use:(item:Furniture)=>void){
    const size=FOREST_STREAMING.chunkTiles;
    for(const item of map.furniture){
      if(item.kind==='campfire')continue;
      const f=item.footprint;
      for(let cy=Math.floor(f.y/size);cy<=Math.floor((f.y+f.height)/size);cy++)for(let cx=Math.floor(f.x/size);cx<=Math.floor((f.x+f.width)/size);cx++){
        const key=`${cx}:${cy}`,items=this.cells.get(key)??[];items.push(item);this.cells.set(key,items);
      }
    }
  }
  update(appleTrees:ReadonlySet<string>){
    const camera=this.scene.cameras.main,origin=camera.getWorldPoint(0,0),zoom=camera.zoom||1;
    const view={x:origin.x/this.tile,y:origin.y/this.tile,width:camera.width/zoom/this.tile,height:camera.height/zoom/this.tile};
    const keys=forestChunkKeys(view,this.map.width,this.map.height),wanted=new Set(keys),visibleKeys=new Set(forestVisibleChunkKeys(view,this.map.width,this.map.height)),size=FOREST_STREAMING.chunkTiles;
    for(const [key,image]of this.floors)if(!wanted.has(key)){image.destroy();this.floors.delete(key);}
    // Cold arrivals fill the visible floor immediately. Only offscreen preloads are budgeted.
    let generated=0;
    for(const key of keys){
      let texture=this.floorTextures.get(key);const [cx,cy]=key.split(':').map(Number);
      if(!texture){
        if(!visibleKeys.has(key)&&generated++>=4)continue;
        texture=`forest-chunk:${this.map.id}:${key}`;
        const c=document.createElement('canvas');c.width=c.height=size*this.tile;const g=c.getContext('2d')!;
        for(let y=0;y<size;y++)for(let x=0;x<size;x++)paintAuthoredForestFloorTile(g,cx!*size+x,cy!*size+y,this.tile,x*this.tile,y*this.tile);
        this.scene.textures.addCanvas(texture,c);this.floorTextures.set(key,texture);
      }else{this.floorTextures.delete(key);this.floorTextures.set(key,texture);}
      if(!this.floors.has(key))this.floors.set(key,this.scene.add.image(cx!*size*this.tile,cy!*size*this.tile,texture).setOrigin(0).setDepth(0));
    }
    while(this.floorTextures.size>FOREST_STREAMING.cachedChunks){
      const cold=[...this.floorTextures.keys()].find(key=>!wanted.has(key));if(!cold)break;
      this.scene.textures.remove(this.floorTextures.get(cold)!);this.floorTextures.delete(cold);
    }
    const visible=new Map<string,Furniture>();
    for(const key of keys)for(const item of this.cells.get(key)??[]){
      const f=item.footprint,pad=FOREST_STREAMING.preloadTiles;
      if(!appleTrees.has(item.id)&&f.x+f.width>=view.x-pad&&f.x<=view.x+view.width+pad&&f.y+f.height>=view.y-pad&&f.y<=view.y+view.height+pad)visible.set(item.id,item);
    }
    for(const [id,image]of this.objects)if(!visible.has(id)){image.destroy();this.objects.delete(id);}
    for(const [id,item]of visible){
      if(this.objects.has(id))continue;
      const f=item.footprint,style=id==='bramblewick-story-board'?id:authoredTreeStyle(id)??authoredBuildingStyle(id)??item.kind;
      const texture=`forest-prop-v3:${style}:${f.width}:${f.height}`;
      if(!this.scene.textures.exists(texture)){this.scene.textures.addCanvas(texture,id==='bramblewick-story-board'?forestStoryBoardCanvas(this.tile):authoredForestObjectCanvas(item,this.tile)??forestObjectCanvas(item,this.tile));this.objectTextures.add(texture);}
      const image=this.scene.add.image(f.x*this.tile,f.y*this.tile,texture).setOrigin(0).setDepth((f.y+f.height-.4)*this.tile);
      if(item.usePoints.length){image.setInteractive({useHandCursor:true});image.on('pointerdown',(_p:Phaser.Input.Pointer,_x:number,_y:number,event:Phaser.Types.Input.EventData)=>{event.stopPropagation();this.use(item);});}
      this.objects.set(id,image);
    }
  }
  diagnostics(){return {floorImages:this.floors.size,cachedChunks:this.floorTextures.size,propImages:this.objects.size,propTextures:this.objectTextures.size};}
  destroy(){
    for(const image of [...this.floors.values(),...this.objects.values()])image.destroy();
    for(const key of [...this.floorTextures.values(),...this.objectTextures])if(this.scene.textures.exists(key))this.scene.textures.remove(key);
    this.floors.clear();this.objects.clear();this.floorTextures.clear();this.objectTextures.clear();
  }
}
