import { afterEach, describe, expect, it, vi } from "vitest";
import { ASYLUM_MAP, WORLDS } from "@third-space/config";
import { asylumObjectCanvas } from "./asylum-art";

afterEach(()=>vi.unstubAllGlobals());
describe("projector cloth pixel geometry",()=>{
  it.each([16,32,48])("uses the same ten-tile surface as video at tile size %i",tile=>{
    const calls:{color:string;x:number;y:number;width:number;height:number}[]=[];
    const context={fillStyle:"",imageSmoothingEnabled:true,fillRect(x:number,y:number,width:number,height:number){calls.push({color:this.fillStyle,x,y,width,height});}};
    const canvas={width:0,height:0,getContext:()=>context};
    vi.stubGlobal("document",{createElement:()=>canvas});
    const item=ASYLUM_MAP.furniture.find(item=>item.id==="asylum-tv")!;
    const result=asylumObjectCanvas(item,tile),screen=WORLDS.asylum.mediaSurface;
    const cloth=calls.find(call=>call.color==="#bdc3a8")!;
    expect(cloth).toEqual({color:"#bdc3a8",x:(screen.x-item.footprint.x)*tile,y:(screen.y-item.footprint.y)*tile,width:screen.width*tile,height:screen.height*tile});
    expect(cloth.width/cloth.height).toBe(16/9);
    expect(result.width).toBe(Math.round(item.footprint.width*tile));
    expect(result.height).toBe(Math.round(item.footprint.height*tile));
    expect(cloth.y+cloth.height).toBeLessThan(result.height);
    for(const call of calls){expect(call.height).toBeGreaterThanOrEqual(0);expect(call.x+call.width).toBeLessThanOrEqual(result.width);expect(call.y+call.height).toBeLessThanOrEqual(result.height);}
  });
});
