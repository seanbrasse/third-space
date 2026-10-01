import type {Furniture} from '@third-space/config';
import type {BuildingStyle,ForestInterior} from '../../../packages/config/src/authored-forest';
import {livingEnvironmentStyle,type LivingEnvironmentArt} from '../../../packages/config/src/living-environment';
import type {NpcAppearance} from '../../../packages/config/src/forest-cast';
import type {Facing} from '@third-space/contracts';
import {ArtBuilder,livingArtCanvas,type LivingArt} from './living-art-primitives';

// Original low-resolution material palette: lit top planes, dark front faces,
// bevels and cast shadows establish depth without external images or gradients.
const C={ink:'#202d2b',shadow:'#172b2866',wood:'#73553b',woodDark:'#443b2e',woodLight:'#b48b59',woodMid:'#937046',cream:'#dfd4aa',brass:'#c49c52',stone:'#67736a',stoneLight:'#8d9581',water:'#467f7d',moss:'#556f4e'};
function jar(b:ArtBuilder,x:number,y:number,color:string,s=1){b.ellipse(x+5*s,y+14*s,6*s,2*s,C.shadow).rect(x+2*s,y,6*s,3*s,C.brass).poly([[x+2*s,y+3*s],[x+8*s,y+3*s],[x+10*s,y+6*s],[x+10*s,y+13*s],[x+8*s,y+15*s],[x+2*s,y+15*s],[x,y+12*s],[x,y+6*s]],color).rect(x+2*s,y+5*s,2*s,6*s,'#c5dfc177').rect(x+1*s,y+9*s,8*s,3*s,C.cream).rect(x+4*s,y+10*s,3*s,1*s,C.woodDark);}
function herb(b:ArtBuilder,x:number,y:number,s=1){b.rect(x,y,2*s,18*s,C.woodMid).poly([[x,y+4*s],[x-8*s,y+7*s],[x-10*s,y+14*s],[x-3*s,y+11*s]],'#849a62').poly([[x+2*s,y+7*s],[x+9*s,y+9*s],[x+11*s,y+17*s],[x+4*s,y+14*s]],'#516f51').poly([[x,y+10*s],[x-5*s,y+15*s],[x-5*s,y+21*s],[x+2*s,y+17*s]],'#6c8555');}
function stone(b:ArtBuilder,x:number,y:number,w:number,h:number){b.poly([[x+3,y],[x+w-4,y+1],[x+w,y+h-4],[x+w-4,y+h],[x+1,y+h-1],[x,y+4]],C.stone).poly([[x+3,y],[x+w-4,y+1],[x+w-7,y+4],[x+3,y+4],[x+1,y+h-3],[x,y+4]],C.stoneLight).rect(x+4,y+h-3,w-8,2,'#45564e');}
function woodGrain(b:ArtBuilder,x:number,y:number,w:number,h:number){for(let row=0;row<Math.floor(h/7);row++){const dx=(row*19)%Math.max(1,w-16);b.rect(x+dx,y+3+row*7,Math.min(12+row%5,w-dx),1,'#c69a6166');b.rect(x+(row*7)%Math.max(1,w-11),y+5+row*7,8,1,'#493d2d66');}}
function basket(b:ArtBuilder,x:number,y:number,w=28,h=23,apples=true){b.ellipse(x+w/2,y+h,w/2+2,3,C.shadow).poly([[x,y+6],[x+w,y+6],[x+w-4,y+h],[x+4,y+h]],'#8c683e').ellipse(x+w/2,y+6,w/2,5,'#c6a16c').ellipse(x+w/2,y+6,w/2-3,3,'#493b2b');for(let k=5;k<w-3;k+=5)b.rect(x+k,y+10,1,h-12,'#d2b57c');b.rect(x+3,y+14,w-6,2,'#634c33');if(apples)for(let k=0;k<5;k++){const ax=x+6+(k*7)%(w-10),ay=y+3+(k%2)*3;b.ellipse(ax,ay,4,3,k%2?'#be7550':'#ce9b51').rect(ax,ay-4,1,2,C.woodDark).rect(ax+1,ay-3,3,1,C.moss);}}

function dresser():LivingArt {
 const b=new ArtBuilder(112,88);b.ellipse(57,83,51,5,C.shadow);
 b.poly([[7,11],[95,5],[105,14],[105,76],[17,83],[7,74]],C.woodDark).poly([[7,11],[95,5],[105,14],[17,21]],C.woodLight).poly([[17,21],[105,14],[105,76],[17,83]],C.wood);
 b.rect(22,24,76,31,'#302f27').rect(21,52,79,5,C.woodLight).rect(21,29,79,3,'#4a392c');
 for(let i=0;i<6;i++)jar(b,27+i*11,33-i%2*3,['#6b9290','#95685f','#697959'][i%3]!, .78);
 b.rect(22,59,75,16,'#997349').rect(23,59,73,2,'#c39c66').rect(59,61,2,13,C.woodDark);
 b.ellipse(40,66,2,2,C.brass).ellipse(78,66,2,2,C.brass).rect(23,77,6,10,C.woodDark).rect(94,72,6,13,C.woodDark);
 b.rect(5,10,94,5,'#b68c57').rect(6,14,94,3,'#765736');woodGrain(b,22,58,32,16);woodGrain(b,66,58,29,15);
 // Hanging tea towels and a little mortar distinguish a working apothecary.
 b.poly([[78,22],[94,21],[94,41],[89,44],[84,40],[79,42]],'#c3c9b0').rect(81,24,2,14,'#8aa394');
 b.ellipse(39,17,10,4,'#787d6b').poly([[30,17],[48,17],[45,25],[34,25]],'#515e52').rect(39,8,3,12,'#b6b197');
 herb(b,69,12,.55);return b.build();
}
function washstand():LivingArt {
 const b=new ArtBuilder(104,74);b.ellipse(53,68,47,5,C.shadow).rect(15,37,6,30,C.woodDark).rect(84,33,6,32,C.woodDark).rect(16,52,72,5,C.woodMid);
 b.poly([[7,28],[84,19],[98,31],[21,42]],C.woodLight).poly([[21,42],[98,31],[98,39],[21,50]],C.wood).poly([[7,28],[21,42],[21,50],[7,36]],C.woodDark);
 b.ellipse(47,32,27,12,'#b19f7c').poly([[20,31],[74,31],[68,45],[27,46]],'#8c8b72').ellipse(47,31,27,10,'#d3cbae').ellipse(47,31,23,7,'#597d7a').ellipse(44,30,16,3,'#8bb4a4').rect(39,29,12,1,'#d9dec0');
 b.poly([[76,31],[81,16],[85,14],[93,18],[92,29],[88,34]],'#c4bda0').ellipse(85,16,5,3,'#e5d6b0').ellipse(85,16,3,1,'#687365');
 b.poly([[26,48],[46,46],[47,63],[43,67],[39,64],[34,66],[29,64]],'#d5cda9').rect(30,49,3,12,'#a99d79').rect(38,48,2,15,'#b8b08b');
 jar(b,60,53,'#769190',.55);return b.build();
}
function rocker():LivingArt {
 const b=new ArtBuilder(58,80);b.ellipse(29,74,26,5,C.shadow);
 b.poly([[9,11],[34,5],[42,13],[42,43],[19,51],[9,42]],C.woodDark).poly([[12,12],[33,8],[38,13],[38,40],[19,46],[13,39]],C.woodMid);
 for(let x=16;x<=31;x+=6)b.rect(x,16,3,25,C.woodLight);
 b.poly([[16,43],[41,36],[50,48],[23,57]],'#66846d').poly([[23,57],[50,48],[49,54],[24,64]],'#3c6056');
 b.rect(15,46,4,23,C.woodDark).rect(43,48,4,18,C.woodDark);
 b.poly([[5,66],[10,70],[28,73],[49,66],[53,67],[49,72],[29,78],[10,74],[4,70]],C.woodLight);
 b.poly([[8,40],[25,36],[27,40],[10,45]],C.woodLight).poly([[33,34],[48,29],[52,33],[35,39]],C.woodLight);
 b.poly([[27,43],[37,41],[45,49],[34,53],[29,52]],'#ccba81').rect(33,44,2,6,'#947b53');return b.build();
}
function throne():LivingArt {
 const b=new ArtBuilder(64,92);b.ellipse(33,87,29,4,C.shadow);
 b.poly([[10,16],[19,16],[19,8],[25,14],[33,3],[40,13],[46,7],[47,16],[54,16],[53,65],[15,72]],'#907345');
 b.poly([[17,22],[47,18],[46,62],[19,68]],'#503c50').poly([[22,27],[42,24],[42,53],[23,57]],'#886574');
 b.poly([[26,29],[33,20],[40,28],[34,36]],'#d1af6d').rect(31,24,4,9,'#edd49b');
 b.rect(12,19,4,53,'#dfbe7a').rect(49,18,4,51,'#bd9659');
 b.poly([[15,63],[46,55],[57,68],[26,77]],'#b88573').poly([[26,77],[57,68],[56,77],[26,85]],'#694a4c');
 b.poly([[8,57],[23,53],[25,58],[10,63]],'#d9b675').poly([[41,51],[55,47],[60,52],[44,58]],'#d9b675');
 b.rect(13,65,5,24,C.woodMid).rect(51,67,5,20,C.woodMid).rect(13,83,6,6,'#ddba70').rect(50,81,7,6,'#ddba70');return b.build();
}
function worktable(style:BuildingStyle):LivingArt {
 const b=new ArtBuilder(112,84);b.ellipse(58,76,51,6,C.shadow);
 b.rect(13,40,8,35,C.woodDark).rect(90,33,8,36,C.woodDark).rect(31,48,7,33,'#5c4733').rect(94,41,7,35,'#5c4733');
 b.poly([[4,24],[84,14],[107,35],[27,48]],'#bc9967').poly([[27,48],[107,35],[107,43],[27,57]],'#78583c').poly([[4,24],[27,48],[27,57],[4,33]],'#5c4634');
 for(let k=0;k<5;k++)b.poly([[9+k*15,24-k*1.6],[12+k*15,24-k*1.6],[32+k*15,44-k*2.3],[29+k*15,44-k*2.3]],'#997447');
 if(style==='witch-hut'){
  b.poly([[23,22],[51,19],[59,32],[30,37]],'#748b6c');herb(b,43,21,.5);jar(b,73,7,'#4b8986');jar(b,89,17,'#947090',.7);
  b.ellipse(62,29,10,4,'#b8af8b').poly([[53,29],[70,29],[67,36],[57,36]],'#70786a').rect(62,19,3,13,C.cream);
  b.poly([[15,33],[27,32],[35,43],[23,44]],'#dac9a1').rect(20,36,8,1,C.woodMid);
 }else if(style==='cheese-shop'){
  b.ellipse(48,25,20,8,'#c9a151').rect(28,25,40,10,'#b3833c').ellipse(48,24,20,8,'#edd486');for(let k=0;k<7;k++)b.ellipse(35+k*5,22+k%3*2,2,1,'#b98e41');
  b.poly([[76,24],[94,20],[87,34],[76,35]],'#e8c873');b.rect(78,40,21,2,'#e1d0a8');
 }else if(style==='wizard-tower'||style==='ruin'){
  b.poly([[16,24],[39,20],[47,23],[68,20],[75,32],[51,36],[43,34],[22,39]],'#cfbc8a').poly([[43,24],[47,23],[52,35],[49,35]],'#8b7452');
  for(let i=0;i<5;i++){b.rect(23+i,25+i*2,15,1,'#99815d');b.rect(53+i,24+i*2,12,1,'#99815d');}jar(b,83,15,'#658e8b',.7);
 }else {basket(b,19,19,31,21);b.ellipse(79,27,12,6,'#dfd5b5').ellipse(79,26,8,3,'#9b7660').rect(82,13,5,8,'#d3b977');}
 return b.build();
}
function hearth(style:BuildingStyle):LivingArt {
 const b=new ArtBuilder(96,100);b.ellipse(50,94,43,5,C.shadow);
 b.poly([[12,19],[72,10],[86,20],[86,87],[25,96],[12,84]],'#46564e');
 for(let y=18;y<83;y+=13)for(let x=17+(Math.floor(y/13)%2)*9;x<78;x+=19)stone(b,x,y,18,12);
 b.poly([[29,79],[29,46],[35,34],[45,29],[57,30],[66,38],[70,48],[70,79]],'#263a35');
 b.poly([[34,78],[35,49],[42,38],[54,36],[62,46],[65,79]],'#171f20');
 b.poly([[36,78],[32,70],[42,65],[46,52],[54,65],[61,56],[64,76]],'#c67b48');b.poly([[42,78],[39,70],[47,65],[51,73],[56,65],[59,78]],'#e9b15d');b.rect(35,80,34,4,'#3d3930');
 b.poly([[9,15],[70,5],[90,15],[29,26]],'#9e9c80').poly([[29,26],[90,15],[90,22],[29,34]],'#68756a').poly([[9,15],[29,26],[29,34],[9,23]],'#536054');
 b.poly([[5,89],[74,78],[93,88],[26,99]],'#95947b').poly([[5,89],[26,99],[26,100],[5,95]],'#596358');
 if(style==='witch-hut'){
  b.rect(29,38,44,3,'#666a57').rect(48,40,2,11,'#a09369');b.ellipse(50,59,18,7,'#192f2b').poly([[33,58],[67,58],[64,72],[59,76],[41,76],[36,71]],'#314b40').ellipse(50,57,18,6,'#739477').ellipse(50,57,14,3,'#a7b17a').rect(38,63,3,5,'#527258');
  herb(b,20,27,.6);herb(b,78,22,.55);
 }else{jar(b,26,7,'#72836d',.6);b.rect(62,1,4,14,C.cream).rect(63,0,2,3,'#edc26e');}
 return b.build();
}
function bookcase(style:BuildingStyle):LivingArt {
 const b=new ArtBuilder(128,64);b.ellipse(65,60,60,4,C.shadow).poly([[3,7],[116,1],[124,7],[124,55],[11,63],[3,57]],C.woodDark).poly([[3,7],[116,1],[124,7],[11,15]],C.woodLight).rect(13,15,105,39,'#33362d');
 for(let row=0;row<2;row++){const y=17+row*20;for(let k=0;k<12;k++){const x=17+k*8,h=10+(k*3+row)%6;if(style==='witch-hut'&&k%3===0)jar(b,x,y,'#698d7a',.65);else if(style==='cheese-shop'){b.ellipse(x+4,y+8,4,3,'#dbc17b').rect(x,y+8,8,5,'#bca267');}else{b.rect(x,y+15-h,6,h,['#799b8f','#ab7660','#bca06e','#827383'][k%4]!).rect(x+1,y+17-h,4,1,'#d3c091');}}
  b.rect(11,y+16,111,4,C.woodMid).rect(12,y+16,108,1,C.woodLight);
 }
 b.rect(6,11,6,47,'#9e7c50').rect(117,8,6,46,'#755339');return b.build();
}
function bed():LivingArt {
 const b=new ArtBuilder(126,68);b.ellipse(62,61,60,5,C.shadow).rect(6,16,9,46,C.woodDark).rect(108,11,9,49,C.woodDark);
 b.poly([[12,18],[96,8],[116,25],[29,39]],'#bbaa87').poly([[29,39],[116,25],[116,50],[29,64]],'#46766f').poly([[12,18],[29,39],[29,64],[12,46]],'#35584e');
 b.poly([[16,20],[37,17],[50,32],[29,36]],'#e3d9b7').poly([[44,16],[94,10],[113,26],[61,35]],'#829c85');
 for(let k=0;k<7;k++)b.poly([[47+k*7,16-k*.9],[50+k*7,16-k*.9],[64+k*7,35-k*1.3],[62+k*7,35-k*1.3]],'#abc2a0');
 b.rect(7,10,8,38,C.woodMid).rect(111,16,7,44,C.woodMid).rect(8,10,5,2,C.woodLight).rect(112,16,5,2,C.woodLight);return b.build();
}
function rug(style:BuildingStyle):LivingArt {
 const b=new ArtBuilder(128,144),green=style==='witch-hut';
 b.poly([[8,0],[118,0],[126,139],[2,139]],'#2b373266').rect(8,4,112,134,green?'#718474':'#937464').rect(13,8,102,126,green?'#bbc09a':'#d5b48c').rect(17,12,94,118,green?'#536e5e':'#6a5052');
 for(let y=19;y<127;y+=12)for(let x=23;x<113;x+=12)b.poly([[x,y],[x+3,y+3],[x,y+6],[x-3,y+3]],'#d1bc8366');
 b.poly([[64,28],[97,70],[64,112],[31,70]],green?'#8c9f75':'#bd956d').poly([[64,39],[87,70],[64,101],[41,70]],green?'#405d50':'#674e4c').poly([[64,53],[74,70],[64,87],[54,70]],C.cream);
 for(let x=9;x<121;x+=5){b.rect(x,0,2,4,C.cream).rect(x,138,2,6,C.cream);}return b.build();
}
function pottedHerbs():LivingArt {
 const b=new ArtBuilder(70,76);b.ellipse(38,68,28,5,C.shadow).ellipse(37,53,24,8,'#c1986c').poly([[14,53],[60,53],[54,72],[22,72]],'#8a654d').ellipse(37,52,24,7,'#dab387').ellipse(37,52,19,4,'#414636');
 for(let k=0;k<7;k++){const x=24+k*4;herb(b,x,15+(k*9)%19,1);b.ellipse(x-4,20+(k*9)%19,3,2,k%2?'#d5bb83':'#ac8b9e');}return b.build();
}
function starDesk():LivingArt {
 const b=new ArtBuilder(160,74);b.ellipse(81,66,74,5,C.shadow).poly([[5,13],[144,4],[157,17],[20,30]],'#987443').poly([[20,30],[157,17],[154,63],[19,74]],'#464c4c').poly([[10,16],[145,8],[150,57],[21,68]],'#344d55');
 b.ellipse(82,38,43,23,'#6b806a').ellipse(82,38,41,21,'#2e4b52');for(let i=0;i<12;i++){const a=i*Math.PI/6,x=82+Math.cos(a)*37,y=38+Math.sin(a)*18;b.rect(x,y,2,2,C.cream);}
 b.poly([[46,39],[81,15],[115,41],[78,59]],'#87a19333').rect(76,34,12,1,C.brass).rect(81,29,1,11,C.brass);jar(b,24,37,'#aa935c',.7);return b.build();
}
function orchardTree(ripe=true):LivingArt {
 const b=new ArtBuilder(120,160);b.ellipse(60,149,48,8,C.shadow).poly([[57,85],[68,81],[67,145],[77,154],[62,153],[55,150],[42,155],[51,145]],'#614b38').poly([[58,89],[63,90],[60,147],[54,150]],'#a27a4d').poly([[57,111],[35,93],[31,78],[38,83],[43,95],[62,105]],'#756045');
 const clumps=[[36,56,28,25],[72,43,31,30],[93,73,25,29],[61,82,37,28],[26,87,23,22],[56,21,22,19]];
 for(const [x,y,rx,ry]of clumps)b.ellipse(x!,y!+9,rx!,ry!,'#34563d').ellipse(x!,y!,rx!,ry!,'#557746').ellipse(x!-5,y!-7,rx!*.65,ry!*.57,'#73914f');
 if(ripe)for(let k=0;k<17;k++){const x=20+(k*31)%84,y=32+(k*19)%66;b.ellipse(x+1,y+2,4,5,'#55472f').ellipse(x,y,4,4,k%3?'#c8894d':'#af5e43').rect(x-2,y-2,2,1,'#e8bc75').rect(x,y-5,1,2,C.woodDark).rect(x+1,y-4,3,1,'#a9af63');}
 b.rect(63,118,5,6,'#e3bd6b').rect(63,118,2,6,'#f0db97');return b.build();
}
function orchardCart():LivingArt {
 const b=new ArtBuilder(124,102);b.ellipse(62,93,57,5,C.shadow);
 for(const x of[26,87]){b.ellipse(x,77,12,19,'#3c3930').ellipse(x,77,8,14,'#a88758').ellipse(x,77,5,10,'#594c37').rect(x-1,63,2,28,'#b89c65').rect(x-7,76,14,2,'#b89c65');}
 b.poly([[10,33],[81,22],[103,42],[103,73],[33,87],[10,68]],'#785439').poly([[10,33],[81,22],[103,42],[33,56]],'#bc955f').poly([[33,56],[103,42],[103,73],[33,87]],'#a87d4c').poly([[10,33],[33,56],[33,87],[10,68]],'#61472f');
 for(let y=59;y<81;y+=7)b.poly([[34,y],[102,y-13],[102,y-11],[34,y+2]],'#6e5036');b.poly([[13,31],[82,20],[97,35],[30,50]],'#433f2c');
 b.poly([[13,26],[82,15],[84,23],[14,34]],'#b58a51');
 const fruit=[[30,32],[40,30],[50,28],[60,26],[70,25],[79,24],[35,38],[45,36],[55,34],[65,32],[75,31],[85,29],[44,43],[54,41],[64,39],[74,37],[84,35]];
 fruit.forEach(([x,y],k)=>b.ellipse(x!,y!,4,3,['#c68748','#a95e3d','#deb96b'][k%3]!).rect(x!,y!-4,1,2,C.woodDark));
 b.poly([[29,48],[99,35],[103,42],[33,56]],'#c29a61');
 b.poly([[99,65],[121,82],[119,87],[98,72]],C.woodLight);basket(b,7,78,26,19,false);b.poly([[50,45],[71,42],[73,65],[66,68],[59,63],[53,65]],'#c5c0a0').rect(57,47,2,14,'#819784');return b.build();
}
function sawBench():LivingArt {
 const b=new ArtBuilder(128,96);b.ellipse(63,89,59,5,C.shadow).poly([[20,45],[30,46],[16,88],[9,88]],C.woodDark).poly([[83,39],[92,38],[113,77],[106,80]],C.woodDark);
 b.poly([[4,38],[101,22],[125,43],[29,61]],C.woodLight).poly([[29,61],[125,43],[125,53],[29,71]],C.wood).poly([[4,38],[29,61],[29,71],[4,47]],C.woodDark);woodGrain(b,39,50,55,11);
 b.poly([[21,29],[95,17],[105,29],[31,43]],'#d2ad75').poly([[31,43],[105,29],[105,36],[31,50]],'#947245');
 b.poly([[41,24],[91,16],[88,21],[91,23],[87,25],[89,27],[45,34]],'#a7b5a3').poly([[31,23],[45,21],[49,33],[36,36],[29,31]],'#6f4732').poly([[35,25],[42,24],[44,30],[36,32]],'#302c28');
 for(let k=0;k<12;k++)b.poly([[27+k*6,79+(k*7)%10],[32+k*6,77+(k*7)%10],[30+k*6,80+(k*7)%10]],'#c0a36b');
 b.rect(104,53,6,11,'#555c54').rect(101,58,15,4,'#9c9673');return b.build();
}
function washLine():LivingArt {
 const b=new ArtBuilder(240,118);b.ellipse(121,108,110,7,C.shadow).rect(8,12,7,99,C.woodDark).rect(225,6,7,104,C.woodDark).rect(9,12,2,96,C.woodLight).rect(226,6,2,100,C.woodLight);
 b.poly([[11,17],[62,23],[121,27],[180,20],[228,10],[228,12],[180,22],[121,29],[62,25],[11,19]],'#c1b491');
 const fabrics=[[[30,21],[76,25],[73,77],[65,82],[55,78],[43,83],[31,77]],[[89,27],[137,27],[143,43],[134,50],[128,43],[129,86],[98,84],[99,44],[91,50],[82,44]],[[156,24],[208,16],[206,69],[196,72],[186,68],[173,75],[160,71]]];
 fabrics.forEach((p,i)=>{b.poly(p as [number,number][],['#dad5b6','#839d92','#c4bca0'][i]!);for(let k=0;k<4;k++)b.rect(38+i*64+k*8,32,2,32+i*3,'#526f6344');});
 for(const x of[35,69,100,130,163,200])b.rect(x,19+(x>150?-3:3),3,9,'#aa7d4b');basket(b,170,88,31,24,false);return b.build();
}
function pond():LivingArt {
 const b=new ArtBuilder(256,276);
 const shore:[[number,number],... [number,number][]]=[[72,7],[157,3],[201,27],[230,63],[245,119],[231,150],[247,201],[217,244],[149,268],[77,258],[32,231],[9,187],[20,140],[4,98],[25,45]];
 b.poly(shore,'#526748').poly(shore.map(([x,y])=>[128+(x-128)*.92,138+(y-138)*.92]),'#8b9370');
 b.poly([[76,26],[150,20],[190,43],[215,81],[220,125],[209,150],[226,199],[201,222],[147,243],[80,238],[45,216],[30,180],[42,140],[24,99],[43,59]],'#66968a');
 b.poly([[77,45],[146,32],[178,55],[194,90],[194,126],[182,155],[202,192],[183,209],[133,220],[81,208],[62,183],[72,144],[45,106],[54,70]],'#417875');
 b.poly([[97,68],[145,56],[167,85],[165,122],[146,160],[158,188],[116,197],[82,175],[90,142],[66,108]],'#326662');
 // Shallow pebble ford remains traversable under Elsie's work and wildlife routes.
 b.poly([[17,162],[55,159],[92,172],[120,183],[163,187],[218,180],[237,190],[205,207],[155,210],[109,201],[74,184],[34,185]],'#8caa8d');
 for(let k=0;k<19;k++){const x=29+(k*41)%190,y=165+(k*17)%35;b.ellipse(x,y,3+k%4,2,'#b7baa088');}
 for(let k=0;k<35;k++){const x=50+(k*37)%148,y=52+(k*23)%166;if((x-125)**2/6800+(y-133)**2/15000<1)b.rect(x,y,4+k%13,1,k%3?'#8bb9a488':'#c1d3b088');}
 for(const [x,y]of[[70,94],[174,119],[162,215],[101,51]]){b.ellipse(x!,y!,12,5,'#244e43').ellipse(x!,y!-2,11,5,'#729c66').poly([[x!,y!-2],[x!+11,y!-4],[x!+4,y!+1]],'#3a6f56');b.ellipse(x!-3,y!-4,3,2,'#d5c6b0');}
 for(let k=0;k<26;k++){const side=k%2,x=side?226+(k*3)%16:18+(k*5)%16,y=42+(k*17)%182;b.rect(x,y-16-k%8,1,26,'#929762').poly([[x,y],[x-7,y-13],[x-2,y+2],[x+1,y+8]],'#6b865b').rect(x-1,y-22-k%8,3,8,'#8c7250');}
 for(const [x,y,w,h]of[[42,35,17,10],[196,32,21,12],[231,150,18,11],[55,236,20,12],[205,228,16,10]])stone(b,x!,y!,w!,h!);
 return b.build();
}
function cave():LivingArt {
 const b=new ArtBuilder(256,205);b.ellipse(131,192,122,11,C.shadow);
 b.poly([[3,134],[17,63],[51,31],[86,16],[128,5],[166,19],[196,40],[231,58],[252,129],[242,185],[187,198],[112,180],[57,199],[12,178]],'#485d55');
 b.poly([[15,117],[23,67],[57,39],[89,29],[110,53],[81,91],[72,140],[29,153]],'#6b7b69');
 b.poly([[59,36],[88,18],[128,8],[165,22],[167,64],[122,73],[96,53]],'#8b937a');
 b.poly([[160,22],[198,44],[230,63],[244,119],[198,134],[162,103],[177,63]],'#62766b');
 b.poly([[86,165],[88,101],[104,74],[131,62],[156,74],[174,103],[183,166]],'#263e3b');
 b.poly([[96,168],[98,111],[110,89],[132,78],[150,91],[161,118],[169,169]],'#122d31');
 b.poly([[103,164],[111,127],[128,115],[148,126],[157,168]],'#17383b');
 b.poly([[100,169],[167,169],[192,188],[164,198],[119,194],[82,186]],'#827e60');
 for(let k=0;k<8;k++)b.poly([[101+k*8,174+k%3*4],[109+k*8,174+k%3*4],[116+k*8,178+k%3*4],[107+k*8,179+k%3*4]],'#b5a57a');
 const rocks=[[14,129,50,46],[39,155,47,40],[63,120,25,49],[173,126,41,54],[205,145,40,38],[42,66,38,31],[93,32,49,31],[151,49,39,38],[203,83,28,42]];
 for(const [x,y,w,h]of rocks){b.poly([[x!,y!+h!*.3],[x!+w!*.4,y!],[x!+w!-3,y!+h!*.18],[x!+w!,y!+h!*.78],[x!+w!*.5,y!+h!],[x!+2,y!+h!*.82]],C.stone).poly([[x!,y!+h!*.3],[x!+w!*.4,y!],[x!+w!-3,y!+h!*.18],[x!+w!*.42,y!+h!*.35]],'#a0a488').poly([[x!+w!*.42,y!+h!*.35],[x!+w!-3,y!+h!*.18],[x!+w!,y!+h!*.78],[x!+w!*.5,y!+h!]],'#596b62');}
 for(let k=0;k<11;k++){const x=22+(k*19)%206,y=51+(k*13)%85;b.ellipse(x,y,8+k%7,3,'#789060').rect(x+3,y,2,9,'#607c54');}
 b.poly([[126,80],[133,80],[130,101]],'#516b68').poly([[142,89],[148,95],[143,106]],'#405d5c');b.ellipse(126,148,10,3,'#427474').rect(121,147,8,1,'#83aaa0');
 return b.build();
}
function lantern():LivingArt {const b=new ArtBuilder(38,74);b.ellipse(19,69,17,4,C.shadow).rect(17,8,4,60,C.woodDark).poly([[17,11],[23,5],[29,8],[30,16],[27,16],[26,9],[23,8],[21,12]],C.woodMid).rect(21,17,13,3,C.brass).poly([[23,20],[32,20],[34,37],[20,37]],'#486252').poly([[24,21],[30,21],[31,34],[23,34]],'#e3be71').rect(25,23,3,10,'#f1ddb0').rect(20,37,14,3,C.brass).rect(25,14,4,3,C.woodDark);return b.build();}

export function livingEnvironmentArt(style:LivingEnvironmentArt,ripe=true):LivingArt {
 switch(style){case'reed-pond':return pond();case'lantern-cave':return cave();case'orchard-tree':return orchardTree(ripe);case'orchard-cart':return orchardCart();case'wash-line':return washLine();case'saw-bench':return sawBench();case'reed-dresser':return dresser();case'reed-washstand':return washstand();case'reed-rocker':return rocker();case'cave-lantern':return lantern();}
}
/** Ripe is authoritative harvest state; it changes only orchard fruit, never
 * canopy/trunk geometry, size, foot position or collision. Cache both variants. */
export function livingEnvironmentObjectCanvas(item:Furniture,tile:number,ripe=true):HTMLCanvasElement|undefined {
 const style=livingEnvironmentStyle(item.id);return style?livingArtCanvas(livingEnvironmentArt(style,ripe),item.footprint.width*tile,item.footprint.height*tile):undefined;
}
export function livingInteriorObjectArt(item:Furniture,style:BuildingStyle):LivingArt|undefined {
 const own=livingEnvironmentStyle(item.id);if(own)return livingEnvironmentArt(own);
 switch(item.kind){case'bookcase':return bookcase(style);case'table':return worktable(style);case'campfire':return hearth(style);case'chair':return style==='castle'?throne():rocker();case'couch':return bed();case'plant':return pottedHerbs();case'rug':return rug(style);case'board':return starDesk();default:return undefined;}
}
export function livingInteriorObjectCanvas(item:Furniture,tile:number,style:BuildingStyle):HTMLCanvasElement|undefined {
 const art=livingInteriorObjectArt(item,style);return art?livingArtCanvas(art,item.footprint.width*tile,item.footprint.height*tile):undefined;
}
export function livingInteriorFloorArt(interior:ForestInterior):LivingArt {
 const w=interior.map.width*32,h=interior.map.height*32,b=new ArtBuilder(w,h),stoneFloor=['castle','ruin','wizard-tower'].includes(interior.style);
 b.rect(0,0,w,h,'#263b35').rect(32,52,w-64,h-84,stoneFloor?'#626b5d':'#716148');
 for(let y=58;y<h-33;y+=stoneFloor?28:16)for(let x=32;x<w-33;x+=stoneFloor?40:64){const seed=x*7+y*13,ww=Math.min(stoneFloor?39:63,w-33-x),hh=Math.min(stoneFloor?27:15,h-33-y);b.rect(x+(Math.floor(y/16)%2),y,ww,hh,(stoneFloor?['#7c806c','#737965','#6c7563']:['#847053','#927a58','#79684d'])[seed%3]!);if(!stoneFloor)woodGrain(b,x+2,y,ww-4,hh);else b.poly([[x+3,y+3],[x+14,y+2],[x+12,y+4],[x+3,y+5]],'#a4a58a66');}
 // Wall front face, timber braces, wainscot, windows and recessed sills. These
 // stay within existing wall collision bands; no new invisible furniture.
 b.rect(14,0,w-28,60,'#a6aa8b').rect(18,3,w-36,44,'#c0c2a0');
 if(stoneFloor){
  b.rect(18,2,w-36,54,'#788271');for(let row=0;row<3;row++)for(let x=18+(row%2)*26;x<w-45;x+=52)stone(b,x,row*18+2,50,17);
  for(let x=32;x<w-20;x+=128){b.rect(x,1,12,53,'#a1a48c').rect(x+8,1,4,53,'#637160').rect(x-3,44,18,10,'#b5b393');}
 }else for(let x=25;x<w-20;x+=46){b.rect(x,2,8,58,'#594e39').rect(x,2,2,53,'#8d7955');b.poly([[x+7,3],[x+13,3],[x+43,38],[x+43,46]],'#8b8060');}
 b.rect(17,48,w-34,13,'#66705b').rect(16,57,w-32,7,'#403f32').rect(18,56,w-36,2,'#a1946b');
 for(const x of[80,w-140]){b.rect(x-5,9,70,42,'#655b43').rect(x-2,11,64,35,'#243e3a').rect(x+2,13,56,29,'#7baba0');b.poly([[x+2,13],[x+34,13],[x+2,35]],'#b7d0ae');b.rect(x+27,12,5,33,'#d0c9a5').rect(x,27,61,4,'#d0c9a5').rect(x-7,45,76,7,'#b4a47a').rect(x-7,51,76,3,'#655d44');b.poly([[x,64],[x+60,64],[x+124,148],[x+41,159]],'#d8cd8a18');}
 b.rect(13,62,20,h-94,'#5b604b').rect(14,62,3,h-96,'#9a9d79').rect(w-33,62,20,h-94,'#3f5145').rect(w-33,62,4,h-96,'#717c5b');
 b.rect(14,h-32,w-28,22,'#53604b').rect(18,h-32,w-36,3,'#9b9972');
 const ex=interior.exit.x*32;b.rect(ex-34,h-33,68,23,'#967e56').rect(ex-30,h-29,60,4,'#c7b58a').rect(ex-30,h-16,60,3,'#61563d');
 if(interior.style==='witch-hut'){for(const x of[187,214,238])herb(b,x,22,.8);b.rect(178,20,73,2,C.woodDark);b.ellipse(w-100,217,58,41,'#ddb76614');}
 if(interior.style==='castle'){
  for(const x of[w/2-76,w/2+56])b.poly([[x,6],[x+22,6],[x+22,43],[x+11,53],[x,43]],'#705d69').rect(x+3,7,16,3,C.brass).poly([[x+5,21],[x+11,13],[x+17,21],[x+11,29]],'#c4ae78');
 }else if(interior.style==='ruin'){
  b.poly([[w-132,14],[w-114,14],[w-111,24],[w-124,28],[w-117,38],[w-132,39]],'#253b39').poly([[64,67],[95,65],[72,75],[68,101],[61,99]],'#334d3e');
  for(let k=0;k<8;k++)b.ellipse(53+k*7,74+k%3*8,5,2,'#6c8058');
 }
 return b.build();
}
export function livingInteriorFloorCanvas(interior:ForestInterior,tile:number):HTMLCanvasElement{return livingArtCanvas(livingInteriorFloorArt(interior),interior.map.width*tile,interior.map.height*tile);}

export type LivingActorKind='spirit'|'frog'|'duck';
export function livingActorArt(kind:LivingActorKind,appearance?:Partial<NpcAppearance>,facing:Facing='down',frame=0):LivingArt {
 const b=new ArtBuilder(40,48),step=[0,1,0,-1][((frame%4)+4)%4]!,evil=appearance?.coat==='#5e4979'||appearance?.coat==='#665279';
 if(kind==='spirit'){
  const shade=appearance?.coat??'#adc8a0',trim=appearance?.trim??'#ebd397';b.ellipse(20,42,14,3,'#a0c5b51f');
  b.poly([[20,3],[29,9],[30,22],[36,32],[27,29],[29,39+step],[22,35],[18,43-step],[14,35],[8,39],[10,29],[4,33],[10,22],[11,10]],evil?'#363549aa':'#6c9a8177');
  b.poly([[20,6],[26,11],[25,24],[30,33+step],[23,31],[20,38],[16,32],[10,34-step],[15,23],[14,12]],shade);
  b.ellipse(20,14,6,7,trim).rect(facing==='left'?15:17,14,2,3,'#304b49');if(facing!=='left')b.rect(23,14,2,3,'#304b49');
  b.poly([[17,26],[21,23],[25,27],[23,32],[18,32]],evil?'#bd97b5':'#e7bf70').rect(19,26,2,4,'#f4e3b1');
  if(evil)b.poly([[14,10],[10,3],[18,8],[22,7],[29,2],[26,13]],'#534669');else b.rect(17,4,7,1,'#e6d59b');
 }else if(kind==='frog'){
  b.ellipse(20,41,14,3,C.shadow).ellipse(20,35,10,7,'#577e52').ellipse(19,34,8,5,'#87a564').ellipse(13,30,4,4,'#a8b774').ellipse(27,30,4,4,'#a8b774').rect(12,28,2,3,C.ink).rect(26,28,2,3,C.ink).poly([[11,37],[5,41-step],[14,42],[16,38]],'#789453').poly([[28,36],[35,41+step],[26,42],[24,38]],'#789453').rect(17,37,7,1,'#4b6748');
 }else{
  b.ellipse(20,42,16,3,'#aad0b333').ellipse(19,35,12,7,'#b2baa0').ellipse(17,32,11,7,'#e4dec1').ellipse(14,32,7,4,'#b5ba9c').ellipse(facing==='left'?10:27,25,6,8,'#527b69').rect(facing==='left'?3:30,27,7,3,'#dfb868').rect(facing==='left'?8:28,23,2,2,C.ink).rect(23,31,5,2,'#e3d4a3');b.poly([[8,34],[3,29],[4,35],[11,38]],'#8e9d82');if(frame%2)b.rect(12,42,16,1,'#b3ceae');
 }
 return b.build();
}
export function livingActorCanvas(kind:LivingActorKind,appearance?:Partial<NpcAppearance>,facing:Facing='down',frame=0):HTMLCanvasElement{return livingArtCanvas(livingActorArt(kind,appearance,facing,frame));}
