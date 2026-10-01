import type {Furniture} from '@third-space/config';
import type {Facing} from '@third-space/contracts';
import type {ForestInterior} from '../../../packages/config/src/authored-forest';
import {LANTERN_CAVE,LANTERN_CAVE_PEDESTAL_ID} from '../../../packages/config/src/lantern-cave';
import {ArtBuilder,livingArtCanvas,type LivingArt} from './living-art-primitives';

/** Original cave assets. Same deterministic command stream feeds cached Canvas
 * textures and native SVG review; no external art or runtime image requests. */
const P={ink:'#172e32',dark:'#243e41',rock:'#536b67',stone:'#758780',light:'#9ea99a',lichen:'#8fa88a',sand:'#938873',brass:'#cfa66b',water:'#416d74',shadow:'#112c3466'};
function rock(b:ArtBuilder,x:number,y:number,w:number,h:number,tint=P.rock){
 b.poly([[x+w*.22,y],[x+w*.72,y+2],[x+w,y+h*.36],[x+w*.9,y+h*.87],[x+w*.35,y+h],[x,y+h*.67],[x+w*.02,y+h*.23]],tint)
 .poly([[x+w*.22,y],[x+w*.72,y+2],[x+w*.64,y+h*.25],[x+w*.2,y+h*.34],[x+w*.02,y+h*.23]],P.light)
 .poly([[x+w*.64,y+h*.25],[x+w*.72,y+2],[x+w,y+h*.36],[x+w*.9,y+h*.87],[x+w*.64,y+h*.76]],'#3c5859')
 .poly([[x+w*.2,y+h*.34],[x+w*.64,y+h*.25],[x+w*.64,y+h*.76],[x+w*.35,y+h],[x,y+h*.67]],P.stone);
 b.poly([[x+w*.24,y+h*.38],[x+w*.48,y+h*.31],[x+w*.45,y+h*.35],[x+w*.25,y+h*.42]],'#b2b7a1');
}
function lichen(b:ArtBuilder,x:number,y:number,w=12){b.ellipse(x,y,w,2.5,'#4c716766').ellipse(x-2,y-2,w*.8,2,P.lichen).rect(x-w*.5,y,2,7,'#719487').rect(x+w*.25,y,1,4,'#9ab19a');}
function pebble(b:ArtBuilder,x:number,y:number,w:number,color=P.sand){b.poly([[x,y+2],[x+w*.3,y],[x+w*.85,y+1],[x+w,y+3],[x+w*.6,y+5],[x+1,y+4]],color).rect(x+w*.3,y+1,w*.4,1,'#b5b197');}

export function lanternCaveFloorArt(interior:ForestInterior=LANTERN_CAVE):LivingArt {
 const w=interior.map.width*32,h=interior.map.height*32,b=new ArtBuilder(w,h);
 b.rect(0,0,w,h,'#172e34');
 b.poly([[38,76],[124,66],[228,74],[321,64],[442,66],[w-38,82],[w-30,184],[w-39,297],[w-38,h-31],[w/2+35,h-31],[w/2+23,h],[w/2-23,h],[w/2-35,h-31],[38,h-31],[29,370],[37,243],[26,133]],'#435b59');
 b.poly([[69,109],[159,91],[276,103],[378,90],[w-69,123],[w-57,247],[w-79,372],[w-62,h-51],[323,h-35],[252,h-34],[65,h-54],[58,347],[72,224]],'#506662');
 // Worn gravel leads from the natural mouth to the quest approach. Puddles
 // are shallow and decorative, so the floor never invents invisible blockers.
 b.poly([[270,83],[311,88],[318,151],[304,222],[320,287],[310,347],[326,405],[315,h],[263,h],[258,420],[272,350],[258,292],[266,221],[250,165]],'#777968');
 b.poly([[282,96],[299,102],[290,190],[287,253],[299,321],[286,386],[299,h],[280,h],[277,389],[285,321],[277,253],[282,188]],'#95907844');
 b.poly([[102,183],[175,174],[207,208],[201,249],[165,271],[110,256],[85,217]],'#3c5556');
 b.poly([[86,328],[124,311],[178,323],[185,354],[155,372],[100,365]],'#4a6863');
 b.poly([[393,124],[449,108],[486,131],[476,160],[428,178],[392,158]],'#294b52');
 b.poly([[399,130],[448,117],[474,134],[463,156],[429,163],[405,153]],'#426d70');
 for(let i=0;i<170;i++){const x=47+(i*47)%Math.round(w-95),y=89+(i*31)%Math.round(h-128);pebble(b,x,y,2+i%5,i%4?'#7c8673':'#a6a087');}
 for(let i=0;i<13;i++){const x=401+i*5,y=135+(i*7)%21;b.rect(x,y,9+i%6,1,'#85aaa188');}
 // Layered high rock at the top, narrow side faces and lower ledges all sit
 // over the existing immutable wall bands. The central mouth stays legible.
 for(let i=0;i<9;i++){const x=i*65-9;rock(b,x,3+(i%3)*5,76,52+i%2*15,i%2?'#506664':'#435b5c');}
 b.poly([[14,45],[64,40],[93,64],[154,46],[193,69],[244,50],[275,70],[328,49],[372,61],[424,45],[473,68],[531,47],[w-13,55],[w-27,79],[486,73],[434,70],[377,78],[324,68],[275,82],[224,72],[179,82],[136,68],[84,81],[34,76]],'#354f52');
 for(let i=0;i<10;i++){const x=35+i*55;b.poly([[x,56],[x+12,54],[x+9,74+i%3*6],[x+5,80+i%3*4]],i%2?'#71847a':'#546e69');}
 for(let y=78;y<h-28;y+=49){rock(b,-12,y,48,56);rock(b,w-36,y+11,48,55,'#4d6461');}
 for(let x=12;x<w-20;x+=51){if(x>w/2-64&&x<w/2+34)continue;rock(b,x,h-34,63,34,'#3b5354');}
 for(const [x,y,size]of[[95,68,18],[172,71,11],[378,70,17],[492,68,16],[32,161,9],[543,280,11],[38,390,12]])lichen(b,x!,y!,size!);
 // Soft daylight at the mouth is static, bounded and non-flashing.
 b.poly([[w/2-24,h],[w/2+24,h],[w/2+55,h-100],[w/2-52,h-94]],'#b8c5a216');
 b.poly([[w/2-23,h],[w/2+23,h],[w/2+28,h-32],[w/2-27,h-31]],'#84978a');
 b.poly([[w/2-22,h-5],[w/2+22,h-5],[w/2+24,h-9],[w/2-23,h-9]],'#c1cab0');
 return b.build();
}
function pillar(mirror=false):LivingArt {
 const b=new ArtBuilder(100,138);b.ellipse(52,129,47,8,P.shadow);
 rock(b,10,70,76,59,'#405d5e');rock(b,20,34,67,67,'#607770');rock(b,25,4,52,58,'#6a7d71');
 b.poly([[25,27],[38,11],[35,50],[21,67]],'#a4af98').poly([[69,17],[79,43],[75,69],[67,47]],'#395458');
 lichen(b,43,53,19);lichen(b,63,92,16);lichen(b,22,113,12);
 b.poly([[53,60],[48,79],[52,89],[47,101],[51,118],[56,125],[54,106],[58,93],[54,80],[58,63]],'#28484d');
 if(!mirror)return b.build();
 const art=b.build();return {width:100,height:138,commands:art.commands.map(c=>c.kind==='rect'?{...c,x:100-c.x-c.width}:c.kind==='ellipse'?{...c,x:100-c.x}:{...c,points:c.points.map(([x,y])=>[100-x,y] as const)})};
}
function plinth(lanternPresent:boolean):LivingArt {
 const b=new ArtBuilder(100,112);b.ellipse(51,103,46,8,P.shadow);
 b.poly([[14,69],[61,58],[89,70],[86,97],[39,109],[13,95]],'#3f5858').poly([[14,69],[61,58],[89,70],[39,83]],'#9b9e85').poly([[39,83],[89,70],[86,97],[39,109]],'#6d7b6c').poly([[14,69],[39,83],[39,109],[13,95]],'#4b655d');
 b.poly([[28,53],[63,45],[76,55],[75,74],[41,83],[28,74]],'#546c64').poly([[28,53],[63,45],[76,55],[41,64]],'#afb097');
 b.ellipse(51,57,16,6,'#685f48').ellipse(51,56,13,4,'#cfac6a').ellipse(51,56,10,2,'#514d3d');
 b.poly([[48,83],[57,80],[57,90],[53,96],[48,93]],'#afab86').rect(52,84,2,8,'#d6c88d');lichen(b,25,92,12);
 if(lanternPresent){
  b.ellipse(50,38,26,24,'#e9bc6016').ellipse(50,38,18,18,'#e9bd6522');
  b.poly([[40,16],[43,6],[50,2],[58,6],[61,16],[57,16],[54,9],[50,7],[46,10],[44,17]],'#8f774d');
  b.poly([[34,18],[50,12],[67,18],[62,24],[40,24]],'#d8b87a').rect(36,23,29,4,'#716242');
  b.poly([[40,27],[61,27],[65,48],[60,57],[42,57],[36,48]],'#baa163').poly([[43,29],[57,29],[59,48],[55,52],[44,50]],'#f3d594');
  b.poly([[43,29],[46,29],[46,50],[42,48]],'#fff0bd').rect(48,28,3,25,'#7b6c43').rect(39,39,22,3,'#8c7848').rect(39,54,24,4,'#d7b376');
 }else{b.ellipse(51,56,6,2,'#ac9e70');b.rect(54,53,3,2,'#dad0a4');}
 return b.build();
}
function supplies():LivingArt {
 const b=new ArtBuilder(126,96);b.ellipse(62,88,59,7,P.shadow);
 b.poly([[6,30],[55,22],[75,36],[73,73],[24,86],[6,67]],'#705d43').poly([[6,30],[55,22],[75,36],[24,45]],'#aa9062').poly([[24,45],[75,36],[73,73],[24,86]],'#8e744e');
 for(let y=49;y<82;y+=8)b.poly([[26,y],[72,y-12],[72,y-10],[26,y+2]],'#594c38');
 b.poly([[10,31],[55,25],[64,32],[20,40]],'#353f34');
 for(let i=0;i<7;i++){const x=20+i*6,y=32-i%3*2;b.ellipse(x,y,4,3,i%2?'#b38454':'#c5a165').rect(x,y-4,1,2,'#554b33');}
 b.poly([[33,46],[57,40],[57,61],[50,68],[35,66]],'#c9c4a0').poly([[41,49],[49,48],[54,55],[49,61],[42,62],[37,57]],'#66836e').rect(45,45,2,6,'#7d7950');
 b.poly([[81,28],[101,24],[116,38],[119,74],[108,87],[81,87],[72,76],[74,42]],'#9c9a73').poly([[83,27],[94,21],[104,26],[100,36],[85,38]],'#b9af7e').rect(83,34,18,4,'#695e41');
 b.poly([[83,43],[91,41],[87,72],[91,84],[82,80],[78,70]],'#c1b58a').poly([[104,39],[110,48],[112,75],[105,83],[100,83],[103,67]],'#777e5d');
 b.rect(99,54,7,11,'#67816a').rect(101,57,3,5,'#bdc19a');
 return b.build();
}
function ropeAndPicks():LivingArt {
 const b=new ArtBuilder(112,78);b.ellipse(56,69,52,6,P.shadow);
 b.poly([[9,20],[42,12],[66,30],[66,59],[35,72],[9,55]],'#5b5341').poly([[9,20],[42,12],[66,30],[35,39]],'#9b895e').poly([[35,39],[66,30],[66,59],[35,72]],'#7a6b4c');
 b.rect(22,18,4,40,'#afa378').poly([[47,18],[51,20],[51,65],[47,67]],'#aaa077');
 b.ellipse(84,58,24,13,'#baaa7b').ellipse(84,58,20,10,'#716e51').ellipse(84,58,16,8,'#b4a77d').ellipse(84,58,12,5,'#596754').ellipse(84,58,8,3,'#bfb58e').ellipse(84,58,4,1,'#566250');
 b.poly([[45,8],[51,6],[92,52],[87,56]],'#9f8050').poly([[32,17],[37,5],[51,0],[62,1],[69,7],[53,6],[45,10]],'#899990').poly([[42,4],[52,0],[63,2],[58,4],[48,3]],'#c0c6ad');
 b.poly([[68,69],[74,62],[82,64],[78,69],[83,73],[90,69],[94,70],[87,77],[77,77]],'#ad9f75');return b.build();
}
function bedroll():LivingArt {
 const b=new ArtBuilder(132,70);b.ellipse(67,60,61,7,P.shadow);
 b.poly([[6,22],[99,6],[126,34],[31,61]],'#3f665f').poly([[9,24],[96,10],[116,33],[32,55]],'#73917b');
 for(let i=0;i<6;i++)b.poly([[22+i*13,24-i*2],[26+i*13,23-i*2],[46+i*11,49-i*3],[42+i*11,50-i*3]],'#a0ac88');
 b.poly([[12,18],[31,14],[51,40],[33,45],[17,37]],'#a7ac8c').ellipse(17,25,11,12,'#5f7e6c').ellipse(17,25,7,8,'#b0b696').ellipse(17,25,4,5,'#698675');
 b.poly([[77,8],[82,7],[105,33],[99,35]],'#7b7254').rect(96,24,7,5,'#b4a477');
 return b.build();
}
function pool():LivingArt {
 const b=new ArtBuilder(112,124);
 b.poly([[35,3],[76,9],[100,37],[102,73],[84,112],[55,123],[18,101],[3,66],[13,27]],'#789084').poly([[36,10],[72,15],[91,39],[95,71],[78,102],[55,112],[24,94],[10,65],[20,31]],'#456e73');
 b.poly([[44,25],[68,27],[81,48],[78,75],[60,94],[35,78],[29,51]],'#315b63');
 for(let i=0;i<15;i++){const x=25+(i*19)%55,y=27+(i*13)%66;b.rect(x,y,7+i%5,1,'#9dbeb099');}
 for(const [x,y,s]of[[13,30,12],[79,103,13],[13,79,10]])pebble(b,x!,y!,s!,'#9fa991');
 lichen(b,92,51,10);return b.build();
}
function exitThreshold():LivingArt {
 const b=new ArtBuilder(80,48);b.poly([[13,3],[65,3],[79,47],[1,47]],'#a7b8a233').poly([[15,21],[64,20],[73,44],[7,44]],'#899989').poly([[17,22],[63,21],[65,26],[15,27]],'#c3c8aa');
 pebble(b,10,35,11);pebble(b,58,35,12);b.poly([[35,24],[44,24],[44,32],[49,32],[40,40],[30,32],[35,32]],'#dae0bd88');return b.build();
}
export function lanternCaveObjectArt(item:Furniture,lanternPresent=true):LivingArt|undefined {
 if(item.id===LANTERN_CAVE_PEDESTAL_ID)return plinth(lanternPresent);
 switch(item.id){case'lantern-cave:left-pillar':return pillar();case'lantern-cave:right-pillar':return pillar(true);case'lantern-cave:stolen-supplies':return supplies();case'lantern-cave:rope-and-picks':return ropeAndPicks();case'lantern-cave:abandoned-bedroll':return bedroll();case'lantern-cave:shallow-pool':return pool();case'lantern-cave:exit':return exitThreshold();default:return undefined;}
}
export function lanternCaveFloorCanvas(interior:ForestInterior,tile:number):HTMLCanvasElement{return livingArtCanvas(lanternCaveFloorArt(interior),interior.map.width*tile,interior.map.height*tile);}
export function lanternCaveObjectCanvas(item:Furniture,tile:number,lanternPresent=true):HTMLCanvasElement|undefined {const art=lanternCaveObjectArt(item,lanternPresent);return art?livingArtCanvas(art,item.footprint.width*tile,item.footprint.height*tile):undefined;}

/** Hostile patrol art: conspicuous pointed ears, stitched clothes, belt/satchel
 * and an orchard branch cudgel. Same 40×52 canvas/foot anchor as forest mobs. */
export function lanternGoblinArt(facing:Facing='down',frame=0,windup=false):LivingArt {
 const b=new ArtBuilder(40,52),step=[0,1,0,-1][((frame%4)+4)%4]!,look=facing==='left'?-2:facing==='right'?2:0;
 const skin='#86a56c',shade='#567851',ink='#20372e';b.ellipse(20,49,16,2,'#18362d55');
 b.rect(10,37,7,10+step,'#364f4a').rect(23,37,7,10-step,'#294540').rect(7,46+step,10,3,'#64533b').rect(23,46-step,11,3,'#776345');
 b.poly([[12,24],[27,24],[31,33],[28,42],[11,42],[8,33]],ink).poly([[13,25],[25,25],[28,34],[26,40],[12,40],[10,33]],'#708078');
 b.rect(13,32,6,7,'#a6a789').rect(14,31,1,8,'#506557').rect(12,34,8,1,'#506557').rect(24,29,2,8,'#9aa087');
 b.poly([[11,25],[25,25],[28,30],[21,29],[16,31],[10,29]],'#a86954').rect(11,37,18,3,'#66553a').rect(20,36,4,5,'#c6ab70').rect(21,37,2,3,'#675d43');
 b.poly([[8,28],[12,28],[11,35],[6,38],[4,35]],shade).poly([[28,27],[32,26],[34,33],[30,36],[27,33]],skin);
 b.poly([[25,39],[32,37],[35,43],[32,47],[25,47],[23,43]],'#967d51').rect(27,39,4,3,'#bca372');
 // Long ears are part of the head silhouette rather than a disguised human mask.
 b.poly([[10+look,12],[3+look,8],[4+look,20],[12+look,21]],shade).poly([[10+look,14],[4+look,12],[6+look,18]],'#b7b782');
 b.poly([[29+look,12],[38+look,8],[35+look,20],[28+look,21]],skin).poly([[30+look,14],[35+look,12],[33+look,18]],'#bfbd84');
 b.poly([[13+look,6],[26+look,6],[32+look,12],[31+look,23],[24+look,28],[15+look,27],[9+look,22],[9+look,13]],shade);
 b.poly([[14+look,8],[25+look,8],[29+look,13],[28+look,23],[22+look,27],[15+look,24],[11+look,19],[12+look,12]],skin);
 if(facing!=='up'){
  b.rect(12+look,14,6,2,ink).rect(23+look,14,6,2,ink).rect(14+look,16,3,2,'#dfd69b').rect(24+look,16,3,2,'#dfd69b').rect(16+look,16,1,2,ink).rect(24+look,16,1,2,ink);
  b.poly([[19+look,15],[23+look,21],[18+look,21]],'#aac086').rect(17+look,23,9,2,'#3a5940').rect(18+look,23,2,2,'#e4d9b1').rect(24+look,23,1,2,'#e4d9b1');
 }
 b.poly([[9+look,10],[12+look,4],[18+look,1],[25+look,3],[31+look,9],[30+look,12],[22+look,10],[18+look,12]],'#824f40').rect(10+look,9,20,3,'#b17f5b').rect(23+look,4,2,4,'#c29c70');
 const dy=windup?-9:0;b.poly([[32,22+dy],[35,21+dy],[38,41+dy],[35,42+dy]],'#8f7950').poly([[28,20+dy],[33,16+dy],[38,19+dy],[38,25+dy],[32,27+dy]],'#665b3e').rect(32,18+dy,2,6,'#baa575');
 return b.build();
}
export function lanternGoblinCanvas(facing:Facing='down',frame=0,windup=false):HTMLCanvasElement{return livingArtCanvas(lanternGoblinArt(facing,frame,windup));}
