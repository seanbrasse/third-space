import type {Furniture} from '@third-space/config';
/** Original cached pixel art; wall faces and object bases share collision coordinates. */
export function asylumFloorCanvas(tile:number){
 const c=document.createElement('canvas');c.width=c.height=20*tile;const g=c.getContext('2d')!;g.imageSmoothingEnabled=false;
 for(let y=0;y<20;y++)for(let x=0;x<20;x++){g.fillStyle=y<2||x===0||x===19||y===19?'#39403d':(x+y)%2?'#5d6257':'#555d53';g.fillRect(x*tile,y*tile,tile-1,tile-1);if((x*7+y*3)%9===0){g.strokeStyle='#363e38';g.beginPath();g.moveTo(x*tile+4,y*tile+3);g.lineTo(x*tile+18,y*tile+14);g.lineTo(x*tile+12,y*tile+25);g.stroke();}}
 for(let i=0;i<35;i++){const x=1.5+(i*7.3)%17,y=3+(i*3.7)%15;g.fillStyle=i%3?'#8f8b75':'#4b4c42';g.fillRect(x*tile,y*tile,4+i%4,2+i%3);g.fillStyle='#51483a';g.fillRect(x*tile+2,y*tile+2,3,1);}
 g.fillStyle='#757c65';g.fillRect(tile,1.4*tile,18*tile,.5*tile);g.fillStyle='#343d36';g.fillRect(15.9*tile,7.2*tile,20,27);g.fillStyle='#c3bda2';g.fillRect(16*tile,7.3*tile,16,21);g.fillStyle='#393e38';g.fillRect(16.1*tile,7.45*tile,3,4);g.fillRect(16.3*tile,7.45*tile,3,4);g.strokeStyle='#a99e78';g.beginPath();g.moveTo(16.3*tile,7.8*tile);g.lineTo(16.5*tile,9*tile);g.stroke();return c;
}
export function asylumObjectCanvas(item:Furniture,tile:number){
 const c=document.createElement('canvas');c.width=Math.round(item.footprint.width*tile);c.height=Math.round(item.footprint.height*tile);const g=c.getContext('2d')!;const w=c.width,h=c.height;g.imageSmoothingEnabled=false;const r=(x:number,y:number,a:number,b:number,color:string)=>{g.fillStyle=color;g.fillRect(x,y,a,b)};
 if(item.id.startsWith('cell-')){r(0,0,w,h-9,'#293830');r(6,12,w-12,h-24,'#192721');r(14,h*.6,w*.5,12,'#626356');r(17,h*.6,w*.43,3,'#9b9780');for(let x=4;x<w;x+=13){r(x,8,4,h-17,'#555f59');r(x,8,1,h-18,'#8c9690');}r(0,h-14,w,6,'#464f46');r(0,8,w,4,'#737a68');}
 else if(item.id==='overturned-desk'){r(5,12,w-10,h-19,'#403b31');r(9,8,w-18,h-24,'#77664b');r(12,10,w-24,3,'#a48c66');r(0,h-22,17,5,'#544934');r(w-21,h-29,20,5,'#544934');r(15,h-18,6,18,'#4b4032');}
 else if(item.id==='broken-cabinet'){r(3,2,w-6,h-5,'#3b3e33');r(7,7,w-14,h-15,'#77735b');for(let y=14;y<h-12;y+=13){r(10,y,w-20,8,'#252e29');r(9,y+8,w-18,3,'#a28c68');}r(w-13,14,6,h-25,'#544c3b');}
 else if(item.kind==='tv'){r(2,9,w-4,h-13,'#242b28');r(5,4,w-10,h-16,'#76694f');r(9,8,w-30,h-26,'#141f1c');r(12,11,w-36,h-32,'#6e7b6e');r(w-19,15,9,9,'#c3b791');r(w-18,32,7,7,'#303832');r(12,h-9,5,9,'#453e34');r(w-20,h-9,5,9,'#453e34');}
 else if(item.kind==='portal'){r(1,1,w-2,h-2,'#554e3b');r(7,3,w-14,h-6,'#182924');r(8,6,w-16,3,'#617c58');}
 else if(item.kind==='log'){r(3,h*.4,w-6,h*.5,'#302e2d');r(5,h*.25,w-10,h*.55,'#84757b');r(3,h*.35,w-6,h*.35,'#84757b');r(8,h*.25,w-16,3,'#b3a093');r(w*.48,h*.48,3,3,'#524a52');r(5,h*.57,6,2,'#574e51');r(w-11,h*.38,4,4,'#363a32');r(w-8,h*.46,3,2,'#bfad8a');}
 else {r(1,h*.45,w-2,h*.48,'#353630');r(3,h*.3,w-6,h*.5,item.id==='charger'?'#756f56':'#827461');r(5,h*.3,w-10,3,'#b19b7d');r(w*.35,h*.45,6,2,'#4a473e');r(w*.7,h*.65,4,3,'#383d35');}
 return c;
}
