/** Original procedural textures: no repeating pitch-sweep oscillator. Cached by the audio owner. */
export function ambienceSamples(kind:'night'|'fire'|'owl'|'wolf',rate:number,seed=17){
 const duration=kind==='night'?24:kind==='fire'?17:kind==='wolf'?5:2.4;
 const samples=new Float32Array(Math.ceil(rate*duration));let brown=0,crackle=0;
 const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 for(let i=0;i<samples.length;i++){
  const t=i/rate;const noise=random()*2-1;brown=(brown+noise*.016)/1.016;
  if(kind==='night'){
   const chirp=Math.pow(Math.max(0,Math.sin(t*2*Math.PI*.87)),5)*Math.pow(Math.max(0,Math.sin(t*2*Math.PI*24)),3);
   const second=Math.pow(Math.max(0,Math.sin(t*2*Math.PI*.63+1.7)),7)*Math.pow(Math.max(0,Math.sin(t*2*Math.PI*19)),4);
   samples[i]=brown*.2+Math.sin(t*2*Math.PI*3900)*chirp*.055+Math.sin(t*2*Math.PI*4600)*second*.025+noise*.002*(.5+.5*Math.sin(t*.27));
  }else if(kind==='fire'){
   if(random()<9/rate)crackle=.25+random()*.6;
   crackle*=Math.exp(-1/(rate*.003));samples[i]=brown*.28+noise*crackle*.55;
  }else{
   const envelope=Math.pow(Math.sin(Math.PI*t/duration),2);
   if(kind==='wolf'){const f=310+70*Math.sin(Math.PI*t/duration)+8*Math.sin(t*5);samples[i]=(Math.sin(2*Math.PI*(310*t-70*duration/Math.PI*Math.cos(Math.PI*t/duration)))+.22*Math.sin(2*Math.PI*f*2*t))*envelope*.22;}
   else{const pulse=Math.pow(Math.max(0,Math.sin(t*Math.PI*2.1)),3);samples[i]=(Math.sin(2*Math.PI*430*t)+.08*Math.sin(2*Math.PI*860*t))*pulse*envelope*.22;}
  }
 }
 return samples;
}
export function fireAmbienceGain(distance:number,volume:number){return Math.max(0,Math.min(1,volume))*.32*Math.max(0,1-distance/9)**1.3;}
