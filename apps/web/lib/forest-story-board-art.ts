/** Original wood-and-paper physical prop. Note count encodes no future quests;
 * papers are a fixed decorative motif, independent of personal discovery state. */
export function forestStoryBoardCanvas(tile:number){
  const c=document.createElement('canvas');c.width=Math.round(tile*2.8);c.height=Math.round(tile*2.2);
  const g=c.getContext('2d')!;g.imageSmoothingEnabled=false;const w=c.width,h=c.height;
  const r=(x:number,y:number,width:number,height:number,color:string)=>{g.fillStyle=color;g.fillRect(Math.round(x),Math.round(y),Math.max(1,Math.round(width)),Math.max(1,Math.round(height)));};
  r(w*.05,h*.88,w*.9,h*.06,'#1b2b24');
  for(const x of[w*.12,w*.8]){r(x,h*.29,w*.075,h*.65,'#514333');r(x+w*.014,h*.31,w*.02,h*.58,'#927854');}
  r(w*.05,h*.14,w*.9,h*.65,'#473a2d');r(w*.09,h*.2,w*.82,h*.52,'#92734e');r(w*.1,h*.21,w*.8,2,'#b08f62');
  r(w*.02,h*.09,w*.96,h*.075,'#597052');r(w*.06,h*.035,w*.88,h*.055,'#788665');r(w*.08,h*.08,w*.84,2,'#adac7e');
  // Unequal paper edges, pinheads and a stitched string suggest a living board.
  r(w*.16,h*.28,w*.27,h*.32,'#dacb9b');r(w*.19,h*.3,w*.2,2,'#ecdfb5');
  r(w*.54,h*.25,w*.27,h*.23,'#b9c4a0');r(w*.58,h*.5,w*.22,h*.17,'#d0ae8a');
  for(const[x,y]of[[.28,.29],[.66,.27],[.69,.51]]){r(w*x!-1,h*y!,3,3,'#6b5942');r(w*x!,h*y!,1,1,'#c7b781');}
  for(let i=0;i<3;i++)r(w*.21,h*(.39+i*.065),w*(i===2?.13:.18),1,'#9b8963');
  r(w*.59,h*.34,w*.15,1,'#81926b');r(w*.59,h*.39,w*.12,1,'#81926b');r(w*.63,h*.58,w*.11,1,'#a0805e');
  r(w*.42,h*.52,w*.18,1,'#c1ae79');r(w*.43,h*.52,1,h*.1,'#c1ae79');
  return c;
}
