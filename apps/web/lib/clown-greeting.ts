import type { ForestStalker } from '@third-space/contracts';
/** Authority timestamps are never reset when a recipient joins or reconnects. */
export function clownGreetingPresentation(state:ForestStalker|null|undefined,serverTime:number){
 const greeting=state?.greeting;
 if(!greeting||state?.kind==='werewolf'||state?.phase==='retreat'||serverTime<greeting.shownAt||serverTime>=greeting.until)return null;
 const remaining=greeting.until-serverTime;
 return {id:greeting.id,text:greeting.text.slice(0,80),alpha:Math.min(1,remaining/700)};
}
/** Bound the label in CSS pixels even while the camera follows near an edge. */
export function greetingViewportPoint(x:number,y:number,width:number,height:number,viewportWidth:number,viewportHeight:number){
 return {x:Math.max(width/2+8,Math.min(viewportWidth-width/2-8,x)),y:Math.max(height+8,Math.min(viewportHeight-8,y))};
}
