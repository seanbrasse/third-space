import type { Furniture } from '@third-space/config';
import { authoredBuildingStyle, authoredTreeStyle, forestRoadAt, naturalForestTheme, type BuildingStyle, type ForestInterior, type TreeStyle } from '../../../packages/config/src/authored-forest';
import type { NpcAppearance } from '../../../packages/config/src/forest-cast';

function surface(width:number,height:number){const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(width));canvas.height=Math.max(1,Math.round(height));const g=canvas.getContext('2d')!;g.imageSmoothingEnabled=false;return{canvas,g};}
function pen(g:CanvasRenderingContext2D){return(x:number,y:number,w:number,h:number,color:string)=>{g.fillStyle=color;g.fillRect(Math.round(x),Math.round(y),Math.max(1,Math.round(w)),Math.max(1,Math.round(h)));};}
function polygon(g:CanvasRenderingContext2D,points:readonly (readonly[number,number])[],color:string){g.fillStyle=color;g.beginPath();points.forEach(([x,y],i)=>i?g.lineTo(Math.round(x),Math.round(y)):g.moveTo(Math.round(x),Math.round(y)));g.closePath();g.fill();}

/** Paints one global tile into a caller-owned chunk. Texture noise is indexed in
 * world coordinates so adjacent independently rendered chunks meet invisibly. */
export function paintAuthoredForestFloorTile(g:CanvasRenderingContext2D,x:number,y:number,tile:number,px=x*tile,py=y*tile){
  const theme=naturalForestTheme({x:x+.5,y:y+.5}),core=x<80&&y<64;
  // Match the existing camp/asylum approaches; expansion must not repaint their clearings as woods.
  const originalClearing=Math.hypot(x-23.5,y-23.5)<7.5||(x>62&&x<76&&y>5&&y<17);
  const originalPath=(x>24&&x<71&&Math.abs(y-23.5)<1.5)||(Math.abs(x-68.5)<1.5&&y>12&&y<26)||Math.abs(x-23.5)<1.5||Math.abs(y-23.5)<1.5||(x>11&&x<18&&y>12&&y<24);
  const road=core?originalClearing||originalPath:!!forestRoadAt({x:x+.5,y:y+.5});
  const palettes={pines:['#263e33','#2a4435','#304937'],meadow:['#3c5238','#425b3f','#465d40'],village:['#4a4d39','#4e513a','#54543d'],highland:['#424c47','#48534d','#515951'],deadwood:['#3c3b3a','#41423e','#484740']} as const;
  const seed=Math.abs(x*31+y*47),colors=road?['#685544','#635240','#705b48']:palettes[theme];
  g.fillStyle=colors[seed%3]!;g.fillRect(px,py,tile,tile);
  for(let i=0;i<4;i++){g.fillStyle=road?'#927756':theme==='deadwood'?'#777066':'#65775a';g.fillRect(px+(seed+i*11)%tile,py+(x*3+y*9+i*7)%tile,2,1);}
  if(!road&&theme==='meadow'&&seed%11===0){g.fillStyle='#b8aa77';g.fillRect(px+tile*.4,py+tile*.6,2,2);g.fillStyle='#779c75';g.fillRect(px+tile*.4,py+tile*.6+2,1,3);}
  if(!road&&theme==='deadwood'&&seed%9===0){g.fillStyle='#686156';g.fillRect(px+4,py+tile*.6,tile*.4,2);g.fillRect(px+tile*.4,py+tile*.6-3,2,5);}
  if(road&&theme==='highland'){g.strokeStyle='#4f4f44';g.lineWidth=1;g.strokeRect(px+2,py+2,tile-4,tile-4);}
}

export function authoredTreeCanvas(style:TreeStyle,width:number,height:number){
  const{canvas,g}=surface(width,height),r=pen(g),w=canvas.width,h=canvas.height;
  r(w*.2,h*.92,w*.64,h*.05,'#1c2e26');
  const trunk=style==='birch'?'#c7c6a6':style==='dead'?'#656158':'#66503d';
  r(w*.45,h*.46,w*.14,h*.5,'#2a312a');r(w*.48,h*.43,w*.09,h*.51,trunk);
  if(style==='birch'){for(let i=0;i<6;i++)r(w*(i%2?.51:.48),h*(.48+i*.07),w*.07,2,'#4c5746');}
  else r(w*.5,h*.68,w*.025,h*.24,'#9e7d54');
  if(style==='dead'){
    polygon(g,[[w*.5,h*.58],[w*.13,h*.36],[w*.11,h*.25],[w*.21,h*.32],[w*.51,h*.49]],'#5b5a51');
    polygon(g,[[w*.54,h*.43],[w*.79,h*.21],[w*.78,h*.08],[w*.86,h*.17],[w*.91,h*.13],[w*.91,h*.25],[w*.57,h*.55]],'#747163');
    polygon(g,[[w*.47,h*.4],[w*.29,h*.18],[w*.32,h*.04],[w*.39,h*.17],[w*.53,h*.3]],'#777566');
    r(w*.5,h*.18,w*.05,h*.44,'#8a8774');r(w*.45,h*.78,w*.1,3,'#41483e');return canvas;
  }
  const colors=style==='birch'?['#465e42','#58734b','#718854','#9aab68']:style==='willow'?['#31574a','#416b55','#598267','#749778']:style==='oak'?['#314c36','#44633e','#5c7b46','#7c9459']:['#203c32','#294a3a','#355942','#527650'];
  if(style==='pine'){
    for(let i=0;i<4;i++){const top=h*(.03+i*.145),bottom=top+h*.31,half=w*(.18+i*.09);polygon(g,[[w*.5,top],[w*.5+half,bottom],[w*.5-half,bottom]],colors[i]!);r(w*.5-half+3,bottom-5,half*.9,2,'#6a8358');}
  }else{
    const clusters=[[.5,.18,.54,.28],[.28,.36,.45,.27],[.68,.38,.52,.3],[.47,.52,.63,.31]];
    for(let i=0;i<clusters.length;i++){const[cx,cy,cw,ch]=clusters[i]!;const xx=w*(cx!-cw!/2),yy=h*(cy!-ch!/2),ww=w*cw!,hh=h*ch!;r(xx+ww*.15,yy,ww*.7,hh,colors[i%3]!);r(xx,yy+hh*.2,ww,hh*.6,colors[i%3]!);r(xx+ww*.13,yy+hh*.15,ww*.36,hh*.19,colors[(i+1)%3]!);r(xx+ww*.18,yy+hh*.1,ww*.25,2,colors[3]!);}
    if(style==='willow')for(let i=0;i<7;i++){const xx=w*(.15+i*.11),yy=h*(.45+Math.abs(i-3)*.025);r(xx,yy,Math.max(2,w*.055),h*(.2+(i%3)*.04),colors[i%3]!);r(xx,yy+3,1,h*.16,colors[3]!);}
  }
  return canvas;
}

export function authoredBuildingCanvas(style:BuildingStyle,width:number,height:number){
  const{canvas,g}=surface(width,height),r=pen(g),w=canvas.width,h=canvas.height;
  const isCastle=style==='castle',isTower=style==='wizard-tower',ruin=style==='ruin',tent=style==='goblin-tent';
  r(w*.06,h*.87,w*.88,h*.1,'#1a2c26');
  if(tent){
    polygon(g,[[w*.08,h*.83],[w*.45,h*.1],[w*.92,h*.83]],'#405d48');polygon(g,[[w*.45,h*.1],[w*.55,h*.83],[w*.92,h*.83]],'#6f7e51');
    polygon(g,[[w*.43,h*.45],[w*.32,h*.85],[w*.65,h*.85]],'#172e27');r(w*.44,h*.08,3,h*.79,'#a78e60');r(w*.25,h*.81,w*.47,3,'#b3a271');
    for(let i=0;i<3;i++)r(w*(.19+i*.28),h*.81,3,h*.12,'#c8b788');
    r(w*.73,h*.5,7,7,'#cba462');r(w*.75,h*.52,3,3,'#5d6549');return canvas;
  }
  if(isCastle){
    r(w*.09,h*.31,w*.82,h*.57,'#64746d');r(w*.1,h*.32,w*.8,3,'#97a294');
    for(let row=0;row<10;row++)for(let col=0;col<17;col++){const xx=w*.1+col*w*.047+(row%2?w*.023:0),yy=h*.35+row*h*.05;r(xx,yy,w*.039,h*.035,row%3?'#75837a':'#899184');}
    for(const xx of[w*.04,w*.75]){r(xx,h*.16,w*.21,h*.71,'#7d8b80');r(xx+w*.035,h*.17,w*.025,h*.66,'#a1ab97');for(let n=0;n<4;n++)r(xx+n*w*.054,h*.08,w*.035,h*.13,'#929c8b');r(xx+w*.075,h*.4,w*.06,h*.14,'#263d36');r(xx+w*.085,h*.41,w*.015,h*.11,'#c2c694');}
    for(let n=0;n<8;n++)r(w*.25+n*w*.064,h*.24,w*.039,h*.09,'#899889');
    polygon(g,[[w*.41,h*.89],[w*.41,h*.63],[w*.5,h*.54],[w*.59,h*.63],[w*.59,h*.89]],'#223a32');
    for(let n=0;n<5;n++)r(w*.425+n*w*.029,h*.61,w*.014,h*.085,'#78684c');
    for(const xx of[w*.31,w*.65]){r(xx,h*.4,w*.046,h*.18,'#6e4860');polygon(g,[[xx,h*.58],[xx+w*.046,h*.58],[xx+w*.023,h*.63]],'#aa8197');r(xx-2,h*.39,w*.06,3,'#cfb875');}
    r(w*.385,h*.88,w*.23,h*.055,'#a0a38a');return canvas;
  }
  const wall=ruin?'#69766b':isTower?'#778074':style==='cheese-shop'?'#b1a17a':'#9b8060';
  const wallDark=ruin?'#455a50':isTower?'#53675e':'#5c4d3d';
  r(w*.13,h*.37,w*.74,h*.51,wallDark);r(w*.18,h*.39,w*.66,h*.47,wall);
  for(let i=0;i<6;i++)r(w*.19,h*(.43+i*.064),w*.64,2,ruin||isTower?'#5b6a5e':'#735e44');
  if(isTower){
    polygon(g,[[w*.08,h*.42],[w*.5,h*.02],[w*.93,h*.42]],'#33495b');polygon(g,[[w*.5,h*.02],[w*.93,h*.42],[w*.53,h*.42]],'#496175');
    r(w*.49,h*.015,3,h*.18,'#d6bd70');r(w*.43,h*.075,w*.14,3,'#d6bd70');
    r(w*.4,h*.26,w*.18,h*.14,'#152e37');r(w*.45,h*.28,w*.08,h*.09,'#c3cb99');
  }else if(ruin){
    for(let i=0;i<5;i++)r(w*(.12+i*.155),h*(.29+(i%2)*.045),w*.12,h*.14,'#86917a');
    r(w*.69,h*.32,3,h*.22,'#344f43');r(w*.67,h*.51,w*.04,3,'#344f43');
    polygon(g,[[w*.13,h*.36],[w*.33,h*.26],[w*.49,h*.38],[w*.26,h*.41]],'#556d56');
  }else{
    const roof=style==='witch-hut'?'#63784c':style==='inn'?'#8b5552':style==='cheese-shop'?'#a68b52':style==='keeper-hut'?'#54735b':'#807c50';
    polygon(g,[[w*.04,h*.41],[w*.46,h*.08],[w*.96,h*.41],[w*.88,h*.5],[w*.46,h*.2],[w*.12,h*.51]],roof);
    polygon(g,[[w*.46,h*.08],[w*.96,h*.41],[w*.88,h*.5],[w*.46,h*.2]],style==='inn'?'#633e42':'#465b40');
    for(let i=0;i<6;i++)r(w*(.16+i*.045),h*(.34-i*.025),w*.19,2,'#ad9d6b');
    r(w*.72,h*.09,w*.1,h*.2,'#746e5a');r(w*.7,h*.08,w*.14,3,'#a5a184');
    if(style==='witch-hut'){r(w*.14,h*.4,w*.065,h*.21,'#8d9860');r(w*.8,h*.43,w*.04,h*.19,'#6e874c');r(w*.13,h*.59,w*.09,3,'#9e8c6b');}
  }
  // The open doorway terminates at the same bottom-center use point as geometry.
  r(w*.43,h*.62,w*.18,h*.26,'#20372e');r(w*.45,h*.64,w*.055,h*.23,'#88704d');r(w*.47,h*.75,2,2,'#d8b66e');
  for(const xx of[w*.23,w*.68]){r(xx,h*.53,w*.13,h*.16,'#314a3d');r(xx+2,h*.54,w*.09,h*.115,'#c1b985');r(xx+w*.055,h*.54,2,h*.14,'#6a5c42');r(xx,h*.6,w*.13,2,'#6a5c42');r(xx-2,h*.69,w*.17,3,'#4f6347');}
  r(w*.39,h*.86,w*.26,h*.07,'#a2916b');r(w*.35,h*.92,w*.34,3,'#697457');
  if(style==='cheese-shop'){r(w*.14,h*.46,w*.22,h*.08,'#d8c072');r(w*.19,h*.48,3,3,'#aa864f');r(w*.29,h*.5,2,2,'#aa864f');}
  if(style==='inn'){r(w*.84,h*.51,3,h*.29,'#493e35');r(w*.77,h*.54,w*.17,h*.14,'#b59969');r(w*.81,h*.59,w*.065,3,'#674f3e');r(w*.82,h*.57,2,h*.07,'#674f3e');}
  if(style==='keeper-hut'){r(w*.6,h*.72,3,h*.09,'#b79a61');r(w*.585,h*.75,w*.07,h*.075,'#dac67e');r(w*.6,h*.77,w*.025,h*.04,'#eddfa1');}
  return canvas;
}

export function authoredForestObjectCanvas(item:Furniture,tile:number):HTMLCanvasElement|undefined {
  const tree=authoredTreeStyle(item.id),building=authoredBuildingStyle(item.id);
  return tree?authoredTreeCanvas(tree,item.footprint.width*tile,item.footprint.height*tile):building?authoredBuildingCanvas(building,item.footprint.width*tile,item.footprint.height*tile):undefined;
}

export function forestInteriorFloorCanvas(interior:ForestInterior,tile:number){
  const{canvas,g}=surface(interior.map.width*tile,interior.map.height*tile),r=pen(g),stone=interior.style==='castle'||interior.style==='ruin'||interior.style==='wizard-tower';
  for(let y=0;y<interior.map.height;y++)for(let x=0;x<interior.map.width;x++){
    const wall=y<2||x===0||x===interior.map.width-1||y===interior.map.height-1;
    const color=wall?['#4e5549','#565e51','#626959'][(x+y)%3]:stone?['#686b5c','#6e7261','#747666'][(x*3+y)%3]:['#766049','#7c654b','#846c50'][(x*7+y)%3];
    r(x*tile,y*tile,tile,tile,color!);r(x*tile,y*tile,tile,1,stone?'#4f584d':'#5c4c3c');
    r(x*tile+(y%2?tile/2:0),y*tile,1,tile,stone?'#535c50':'#62503e');
    if(!wall&&!stone)r(x*tile+4,y*tile+tile*.6,tile*.5,1,'#9c7b55');
  }
  r(tile,tile*1.65,canvas.width-tile*2,tile*.2,'#a19b77');
  r(interior.exit.x*tile-tile,canvas.height-tile*1.4,tile*2,tile*.4,'#c2ac77');
  return canvas;
}

export function forestInteriorObjectCanvas(item:Furniture,tile:number,style:BuildingStyle){
  const{canvas,g}=surface(item.footprint.width*tile,item.footprint.height*tile),r=pen(g),w=canvas.width,h=canvas.height;
  if(item.kind==='rug'){
    const tone=style==='castle'?'#71586a':style==='witch-hut'?'#56756a':style==='ruin'?'#596b68':'#8b6c55';
    r(1,1,w-2,h-2,'#b89e70');r(3,3,w-6,h-6,tone);r(6,6,w-12,2,'#b89e70');r(6,h-8,w-12,2,'#b89e70');
    polygon(g,[[w*.5,h*.25],[w*.72,h*.5],[w*.5,h*.75],[w*.28,h*.5]],'#c2ae7c');polygon(g,[[w*.5,h*.35],[w*.63,h*.5],[w*.5,h*.65],[w*.37,h*.5]],tone);
  }else if(item.kind==='bookcase'){
    r(0,0,w,h,'#473e31');r(3,3,w-6,h-6,'#a0875c');
    for(let row=0;row<2;row++){const yy=3+row*h*.43;r(4,yy+h*.35,w-8,3,'#4d4231');
      for(let i=0;i<7;i++){const xx=6+i*(w-12)/7;
        if(style==='cheese-shop'){r(xx,yy+4,(w-15)/7,h*.25,'#d3b365');r(xx+2,yy+6,2,2,'#9e8048');r(xx+6,yy+8,2,2,'#9e8048');}
        else if(style==='witch-hut'){r(xx+3,yy+2,3,3,'#c1ab80');r(xx,yy+5,9,h*.2,['#6a8d70','#969879','#899c92'][i%3]!);r(xx+2,yy+7,2,3,'#bbcfad');}
        else {r(xx,yy+3+(i%2)*2,Math.max(3,(w-15)/7-2),h*.27,['#668577','#a7856a','#77859a','#c2ae75'][i%4]!);r(xx+2,yy+6,1,h*.15,'#d3c29c');}
      }
    }
  }else if(item.kind==='table'){
    r(w*.1,h*.32,w*.82,h*.59,'#453e31');r(w*.06,h*.08,w*.9,h*.62,'#a38a5f');r(w*.09,h*.13,w*.84,2,'#c1a67a');r(w*.14,h*.79,w*.09,h*.2,'#614d38');r(w*.79,h*.79,w*.09,h*.2,'#614d38');
    if(style==='cheese-shop'){r(w*.2,h*.27,w*.35,h*.22,'#d9b762');r(w*.25,h*.31,3,3,'#a6894e');r(w*.46,h*.37,3,3,'#a6894e');}
    else{r(w*.2,h*.23,w*.45,h*.31,'#d8c9a1');r(w*.41,h*.24,1,h*.28,'#998266');for(let i=0;i<3;i++)r(w*.23,h*(.29+i*.07),w*.13,1,'#92866e');}
    r(w*.75,h*.23,w*.09,h*.19,'#768f79');r(w*.78,h*.21,2,2,'#d9bd70');
  }else if(item.kind==='campfire'){
    r(w*.09,h*.2,w*.82,h*.67,'#536259');r(w*.17,h*.15,w*.66,4,'#909880');r(w*.21,h*.39,w*.58,h*.37,'#1f352c');r(w*.25,h*.7,w*.5,4,'#826348');
    polygon(g,[[w*.33,h*.7],[w*.36,h*.4],[w*.49,h*.56],[w*.62,h*.3],[w*.68,h*.7]],'#ca8758');polygon(g,[[w*.43,h*.7],[w*.48,h*.49],[w*.59,h*.69]],'#e8c47b');r(w*.07,h*.85,w*.86,h*.1,'#8b917a');
  }else if(item.kind==='chair'){
    r(w*.09,0,w*.8,h*.74,'#ab8d59');r(w*.2,h*.13,w*.57,h*.45,'#775468');r(w*.1,h*.61,w*.8,h*.2,'#967684');r(w*.14,h*.8,w*.12,h*.2,'#8b724b');r(w*.75,h*.8,w*.12,h*.2,'#8b724b');r(w*.38,0,w*.25,h*.07,'#dbc17c');
  }else if(item.kind==='board'){
    r(0,0,w,h,'#9a8b69');r(3,3,w-6,h-6,'#354d50');
    const stars=[[.14,.62],[.34,.35],[.51,.6],[.73,.3],[.87,.63]];g.strokeStyle='#7f9e9a';g.lineWidth=1;g.beginPath();stars.forEach(([x,y],i)=>i?g.lineTo(x!*w,y!*h):g.moveTo(x!*w,y!*h));g.stroke();
    stars.forEach(([x,y],i)=>{if(style==='ruin'&&i===2){r(x!*w-2,y!*h-2,5,5,'#223c40');return;}r(x!*w-1,y!*h-2,3,5,'#d3c88d');r(x!*w-2,y!*h-1,5,3,'#d3c88d');});
  }else if(item.kind==='plant'){
    r(w*.23,h*.64,w*.55,h*.31,'#9e7959');r(w*.18,h*.6,w*.65,h*.09,'#c09a71');r(w*.48,h*.22,w*.05,h*.43,'#789765');
    for(let i=0;i<4;i++){r(w*(i%2?.48:.21),h*(.19+i*.11),w*.28,h*.1,i%2?'#739365':'#98aa78');}
  }else if(item.kind==='couch'){
    r(1,1,w-2,h-2,'#735d43');r(w*.04,h*.14,w*.9,h*.7,'#657f75');r(w*.08,h*.2,w*.22,h*.55,'#d6c69d');r(w*.36,h*.14,2,h*.7,'#a5b397');r(w*.86,0,w*.1,h,'#a88b61');
  }else if(item.kind==='structure'){
    r(1,h*.3,w-2,h*.6,'#566459');r(4,h*.22,w-8,h*.55,'#8a927c');r(w*.28,h*.24,2,h*.5,'#4b6056');r(w*.65,h*.24,2,h*.5,'#4b6056');r(6,h*.23,w*.8,2,'#b0b095');
  }else if(item.kind==='portal'){
    r(1,h*.48,w-2,h*.45,'#b8a17a');r(4,h*.53,w-8,2,'#e2c89c');r(w*.47,h*.62,3,h*.2,'#4f5c46');r(w*.4,h*.7,w*.18,2,'#4f5c46');
  }
  return canvas;
}

/** Tiny original sprite sheet vocabulary. Rendered at nearest-neighbour scale;
 * costume, silhouette and held props identify a role before a name label appears. */
export function authoredNpcCanvas(role:string,appearance:NpcAppearance,facing:'up'|'down'|'left'|'right'='down',frame=0){
  const{canvas,g}=surface(32,42),r=pen(g),step=[0,1,0,-1][frame%4]!,a=appearance;
  const animal=['rabbit','deer','fox','owl'].includes(role);
  r(6,38,21,2,'#1a2b25');
  if(animal){
    if(role==='owl'){r(10,14,14,20,'#786955');r(7,20,4,13,'#564d44');r(23,20,4,13,'#564d44');r(9,13,4,8,'#a79975');r(22,13,4,8,'#a79975');r(12,20,4,4,'#d4c5a0');r(20,20,4,4,'#d4c5a0');r(13,21,2,2,'#282e2b');r(21,21,2,2,'#282e2b');r(17,25,3,4,'#ceaa63');r(11,34,4,4,'#a99668');r(22,34,4,4,'#a99668');}
    else {const fur=role==='fox'?'#ba7b4e':role==='rabbit'?'#b5b49b':'#a88b64';r(7,25,19,10,fur);r(18,18,10,12,fur);r(24,24,6,4,role==='fox'?'#dac9a4':fur);r(24,21,2,2,'#29332d');r(9+step,33,3,5,'#746b53');r(22-step,33,3,5,'#746b53');r(5,26,5,5,'#d7c8a7');if(role==='rabbit'){r(19,9,3,11,fur);r(25,8,3,12,fur);r(20,10,1,8,'#b58d83');}else if(role==='deer'){r(20,13,2,7,fur);r(26,14,2,6,fur);r(19,7,1,9,'#b9ad8c');r(17,8,3,1,'#b9ad8c');r(26,7,1,9,'#b9ad8c');r(26,9,4,1,'#b9ad8c');}else{r(19,13,4,7,'#734b38');r(26,14,3,6,'#734b38');r(1,27,10,5,fur);r(1,28,3,3,'#e7d6b3');}}
    if(facing==='left'){g.save();g.globalCompositeOperation='copy';g.translate(32,0);g.scale(-1,1);g.drawImage(canvas,0,0);g.restore();}return canvas;
  }
  const ogre=role==='ogre',short=role==='goblin',headY=ogre?8:short?15:10,bodyY=headY+11;
  r(10+step,bodyY+9,5,9,'#48514c');r(18-step,bodyY+9,5,9,'#424b49');r(8+step,37,8,3,'#423c35');r(18-step,37,8,3,'#423c35');
  r(ogre?5:8,bodyY,ogre?23:18,13,a.coat);r(10,bodyY+1,3,11,a.trim);r(8,bodyY+10,18,2,'#5c503b');r(17,bodyY+10,3,2,a.trim);
  r(ogre?2:5,bodyY+2,4,12,a.coat);r(ogre?28:26,bodyY+2,3,12,a.coat);r(ogre?2:5,bodyY+11,4,3,a.skin);r(ogre?28:26,bodyY+11,3,3,a.skin);
  r(ogre?8:11,headY,ogre?17:12,12,a.skin);r(10,headY-2,14,4,a.hair);r(9,headY+1,3,7,a.hair);r(22,headY+1,2,5,a.hair);
  if(short){polygon(g,[[5,headY+2],[11,headY+4],[10,headY+8]],a.skin);polygon(g,[[24,headY+3],[30,headY+1],[25,headY+8]],a.skin);}
  if(facing!=='up'){r(facing==='left'?12:14,headY+6,2,2,'#27352d');if(facing==='down')r(20,headY+6,2,2,'#27352d');r(16,headY+10,4,1,ogre?'#d9d3b2':'#866854');}
  const mage=role==='wizard'||role==='witch'||role==='warlock';
  if(mage){r(8,bodyY+9,18,6,a.coat);r(6,bodyY+14,23,3,a.coat);r(25,14,2,24,'#a38a64');r(23,13,6,4,a.trim);if(role!=='warlock'){polygon(g,[[8,headY],[17,0],[26,headY]],a.coat);r(6,headY,23,3,a.trim);r(17,5,2,3,a.trim);}else{r(8,headY-2,18,5,a.coat);r(8,headY,4,10,a.coat);r(23,headY,4,10,a.coat);}}
  if(['guard','watch','knight'].includes(role)){r(9,headY-3,16,5,'#a0a9a0');r(8,headY+1,4,7,'#7f918a');r(23,headY+1,3,7,'#75877e');r(14,headY-4,7,2,a.trim);r(3,bodyY+3,5,9,'#6f8279');r(4,bodyY+4,3,6,a.trim);r(28,15,1,23,'#d4c9a5');r(26,25,5,2,'#998154');}
  if(role==='king'||role==='queen'){r(9,headY-4,17,4,a.trim);for(const x of[10,16,23])r(x,headY-7,3,5,a.trim);r(16,headY-3,3,2,'#a76e79');r(22,bodyY,4,14,'#b79a64');if(role==='queen')r(7,bodyY+11,21,5,a.coat);}
  if(role==='cat'||role==='catfolk'){polygon(g,[[9,headY+1],[10,headY-7],[15,headY-1]],a.skin);polygon(g,[[20,headY-1],[25,headY-7],[26,headY+2]],a.skin);r(11,headY-4,2,4,'#d9b194');r(23,headY-4,2,4,'#d9b194');r(15,headY+8,7,3,'#dac79f');r(18,headY+8,2,1,'#684838');r(25,bodyY+8,5,3,a.skin);r(29,bodyY+3,2,7,a.skin);r(11,bodyY+2,13,3,'#ccb98e');r(17,bodyY+4,8,6,'#97734d');}
  if(role==='cheesemonger'){r(11,bodyY+2,11,11,'#e1cda1');r(21,bodyY+5,8,6,'#d6b45e');r(23,bodyY+6,2,2,'#a98749');r(10,headY-3,15,4,'#d5c69f');}
  if(role==='innkeeper'||role==='peasant'){r(11,bodyY+4,11,9,'#c6b18a');r(12,bodyY+3,2,2,a.trim);}
  if(role==='flirt'){r(23,bodyY+1,4,4,'#d7a0a3');r(24,bodyY+4,1,5,'#718b5d');r(11,headY-3,13,3,a.hair);}
  return canvas;
}
