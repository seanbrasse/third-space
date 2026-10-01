import type {Furniture,Point,Rect,WorldMap} from './index';
import type {ForestInterior} from './authored-forest';

/** The existing exterior sculpture and collision are unchanged. Register this
 * descriptor as a special doorway; adding another outdoor building duplicates it. */
export const LANTERN_CAVE_DOOR=Object.freeze({
 buildingId:'living:lantern-cave',interiorId:'interior:lantern-cave',point:Object.freeze({x:64,y:81.5}),
});
export const LANTERN_CAVE_ANCHOR:Readonly<Point>=Object.freeze({x:9,y:5.5});
export const LANTERN_CAVE_PEDESTAL_ID='lantern-cave:pedestal';
function prop(id:string,kind:Furniture['kind'],footprint:Rect,collider:Rect|null=null,usePoints:readonly Point[]=[]):Furniture {
 return Object.freeze({id,kind,footprint:Object.freeze(footprint),collider:collider?Object.freeze(collider):null,usePoints:Object.freeze(usePoints.map(p=>Object.freeze({...p}))),seats:Object.freeze([])});
}
const entrance=Object.freeze({x:9,y:13.5}),exit=Object.freeze({x:9,y:14.4});
const furniture=Object.freeze([
 prop(LANTERN_CAVE_PEDESTAL_ID,'structure',{x:7.75,y:2.3,width:2.5,height:2.8},{x:8.2,y:4.65,width:1.6,height:.4}),
 prop('lantern-cave:left-pillar','structure',{x:1.35,y:4.2,width:2.5,height:3.4},{x:1.8,y:6.5,width:1.6,height:.8}),
 prop('lantern-cave:right-pillar','structure',{x:14,y:6.7,width:2.6,height:3.5},{x:14.3,y:9.2,width:1.8,height:.8}),
 prop('lantern-cave:stolen-supplies','structure',{x:4.7,y:6,width:2.8,height:2.15},{x:4.9,y:7.2,width:2.4,height:.7}),
 prop('lantern-cave:rope-and-picks','structure',{x:12.2,y:3.6,width:2.5,height:1.7},{x:12.4,y:4.65,width:2.1,height:.45}),
 prop('lantern-cave:abandoned-bedroll','rug',{x:3.6,y:10.1,width:3,height:1.6}),
 prop('lantern-cave:shallow-pool','rug',{x:10.9,y:7.3,width:2.8,height:3.1}),
 prop('lantern-cave:exit','portal',{x:8,y:13.8,width:2,height:1.2},null,[exit]),
]);
const walls=Object.freeze([
 Object.freeze({x:0,y:0,width:18,height:2.3}),Object.freeze({x:0,y:15,width:18,height:1}),
 Object.freeze({x:0,y:0,width:1.2,height:16}),Object.freeze({x:16.8,y:0,width:1.2,height:16}),
]);
const map:WorldMap=Object.freeze({
 id:'interior:lantern-cave',width:18,height:16,spawn:entrance,
 spawns:Object.freeze(Array.from({length:8},(_,i)=>Object.freeze({x:7.5+i%4,y:12.5-Math.floor(i/4)}))),
 furniture,seats:Object.freeze([]),solids:Object.freeze([...walls,...furniture.flatMap(f=>f.collider?[f.collider]:[])]),
});
/** Deliberately has no .clue field: the Stolen Lantern quest owns its trusted
 * anchor and action; the older keeper quest has only its two established clues. */
export const LANTERN_CAVE:ForestInterior=Object.freeze({
 id:'interior:lantern-cave',name:'The Lantern Hollow',buildingId:LANTERN_CAVE_DOOR.buildingId,style:'ruin',
 map,entrance,exit,returnPoint:LANTERN_CAVE_DOOR.point,
 flavor:'Water ticks through pale lichen. Orchard sacks crowd a stone plinth where a borrowed lantern keeps the darkness back.',
});
