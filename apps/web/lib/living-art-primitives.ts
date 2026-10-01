/** Original, deterministic vector/pixel artwork. Both the game canvas and the
 * offline SVG contact sheets render this same command stream; no remote assets. */
export type ArtCommand =
  | {kind:'rect';x:number;y:number;width:number;height:number;fill:string}
  | {kind:'ellipse';x:number;y:number;rx:number;ry:number;fill:string}
  | {kind:'poly';points:readonly (readonly [number,number])[];fill:string};
export interface LivingArt {width:number;height:number;commands:readonly ArtCommand[]}
export class ArtBuilder {
 readonly commands:ArtCommand[]=[];
 constructor(readonly width:number,readonly height:number){}
 rect(x:number,y:number,width:number,height:number,fill:string){if(width>0&&height>0)this.commands.push({kind:'rect',x,y,width,height,fill});return this;}
 ellipse(x:number,y:number,rx:number,ry:number,fill:string){this.commands.push({kind:'ellipse',x,y,rx,ry,fill});return this;}
 poly(points:readonly (readonly [number,number])[],fill:string){this.commands.push({kind:'poly',points,fill});return this;}
 add(art:LivingArt,x=0,y=0,sx=1,sy=sx){for(const c of art.commands){if(c.kind==='rect')this.rect(x+c.x*sx,y+c.y*sy,c.width*sx,c.height*sy,c.fill);else if(c.kind==='ellipse')this.ellipse(x+c.x*sx,y+c.y*sy,c.rx*sx,c.ry*sy,c.fill);else this.poly(c.points.map(p=>[x+p[0]*sx,y+p[1]*sy]),c.fill);}return this;}
 build():LivingArt{return {width:this.width,height:this.height,commands:this.commands};}
}
export function paintLivingArt(g:CanvasRenderingContext2D,art:LivingArt,width=art.width,height=art.height){
 g.save();g.scale(width/art.width,height/art.height);g.imageSmoothingEnabled=false;
 for(const c of art.commands){g.fillStyle=c.fill;if(c.kind==='rect')g.fillRect(c.x,c.y,c.width,c.height);else{g.beginPath();if(c.kind==='ellipse')g.ellipse(c.x,c.y,c.rx,c.ry,0,0,Math.PI*2);else{c.points.forEach(([x,y],i)=>i?g.lineTo(x,y):g.moveTo(x,y));g.closePath();}g.fill();}}
 g.restore();
}
export function livingArtCanvas(art:LivingArt,width=art.width,height=art.height):HTMLCanvasElement {
 const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(width));canvas.height=Math.max(1,Math.round(height));
 const g=canvas.getContext('2d');if(!g)throw new Error('A 2D canvas is required for living world artwork.');paintLivingArt(g,art,canvas.width,canvas.height);return canvas;
}
export function livingArtSvg(art:LivingArt):string {
 const body=art.commands.map(c=>c.kind==='rect'?`<rect x="${c.x}" y="${c.y}" width="${c.width}" height="${c.height}" fill="${c.fill}"/>`:c.kind==='ellipse'?`<ellipse cx="${c.x}" cy="${c.y}" rx="${c.rx}" ry="${c.ry}" fill="${c.fill}"/>`:`<polygon points="${c.points.map(p=>p.join(',')).join(' ')}" fill="${c.fill}"/>`).join('');
 return `<svg xmlns="http://www.w3.org/2000/svg" width="${art.width}" height="${art.height}" viewBox="0 0 ${art.width} ${art.height}">${body}</svg>`;
}
