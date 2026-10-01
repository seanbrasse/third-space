import type {Furniture,Point,Rect,WorldMap} from './index';
import type {ForestInterior} from './authored-forest';

/** These are local compositions in the existing continuous forest, never regions. */
export const LIVING_ENVIRONMENT_ANCHORS=Object.freeze({
 orchardWorker:Object.freeze({x:56,y:84}),washer:Object.freeze({x:99,y:68}),woodworker:Object.freeze({x:94,y:54}),
 lanternSpirit:Object.freeze({x:55,y:82}),reedSpirit:Object.freeze({x:101,y:70}),frog:Object.freeze({x:99,y:67}),duck:Object.freeze({x:101,y:69}),
 caveMouth:Object.freeze({x:64,y:81.5}),orchardCart:Object.freeze({x:55.5,y:85.5}),
});
export type LivingEnvironmentArt='reed-pond'|'lantern-cave'|'orchard-tree'|'orchard-cart'|'wash-line'|'saw-bench'|'reed-dresser'|'reed-washstand'|'reed-rocker'|'cave-lantern';
interface Scenery {id:string;art:LivingEnvironmentArt;footprint:Readonly<Rect>;collider:Readonly<Rect>|null;approach?:Readonly<Point>;floor?:boolean}
const freezeScenery=(items:Scenery[])=>Object.freeze(items.map(item=>Object.freeze({...item,footprint:Object.freeze(item.footprint),collider:item.collider?Object.freeze(item.collider):null,approach:item.approach?Object.freeze(item.approach):undefined})));
export const LIVING_OUTDOOR_SCENERY=freezeScenery([
 {id:'living:reed-pond',art:'reed-pond',footprint:{x:97.1,y:63.8,width:6.4,height:6.9},collider:null,floor:true},
 {id:'living:lantern-cave',art:'lantern-cave',footprint:{x:60,y:75,width:8,height:6.4},collider:{x:60.5,y:75.5,width:7,height:3.1},approach:LIVING_ENVIRONMENT_ANCHORS.caveMouth},
 {id:'living:orchard-tree-a',art:'orchard-tree',footprint:{x:51.7,y:78,width:3.6,height:4.8},collider:{x:53.25,y:82.1,width:.5,height:.5}},
 {id:'living:orchard-tree-b',art:'orchard-tree',footprint:{x:57.2,y:79,width:3.6,height:4.8},collider:{x:58.75,y:83.1,width:.5,height:.5}},
 {id:'living:orchard-tree-c',art:'orchard-tree',footprint:{x:50,y:85.7,width:3.6,height:4.8},collider:{x:51.55,y:89.8,width:.5,height:.5}},
 {id:'living:orchard-cart',art:'orchard-cart',footprint:{x:53.6,y:85.8,width:2.7,height:2.2},collider:{x:53.8,y:87.1,width:2.1,height:.5},approach:LIVING_ENVIRONMENT_ANCHORS.orchardCart},
 {id:'living:wash-line',art:'wash-line',footprint:{x:98,y:61.3,width:4.5,height:2.2},collider:null},
 {id:'living:saw-bench',art:'saw-bench',footprint:{x:91.1,y:52.8,width:2.6,height:2},collider:{x:91.3,y:54.1,width:2.1,height:.4},approach:LIVING_ENVIRONMENT_ANCHORS.woodworker},
 {id:'living:cave-lantern',art:'cave-lantern',footprint:{x:62,y:80.2,width:.8,height:1.7},collider:null},
]);
export const REED_HOUSE_SCENERY=freezeScenery([
 {id:'living:reed-dresser',art:'reed-dresser',footprint:{x:2,y:4,width:3,height:2.2},collider:{x:2.15,y:5.5,width:2.7,height:.6}},
 {id:'living:reed-washstand',art:'reed-washstand',footprint:{x:11,y:3.9,width:2.6,height:1.7},collider:{x:11.1,y:4.9,width:2.4,height:.6}},
 {id:'living:reed-rocker',art:'reed-rocker',footprint:{x:10.5,y:10,width:1.4,height:1.8},collider:{x:10.6,y:11.1,width:1.2,height:.6}},
]);
export function livingEnvironmentStyle(id:string):LivingEnvironmentArt|undefined{return [...LIVING_OUTDOOR_SCENERY,...REED_HOUSE_SCENERY].find(s=>s.id===id)?.art;}
export function livingEnvironmentIsFloor(id:string):boolean{return LIVING_OUTDOOR_SCENERY.some(s=>s.id===id&&s.floor);}
function furniture(s:Scenery):Furniture{return{id:s.id,kind:s.floor?'rug':s.art==='orchard-tree'?'tree':'structure',footprint:{...s.footprint},collider:s.collider?{...s.collider}:null,usePoints:s.approach?[{...s.approach}]:[],seats:[]};}
/** Remove only generated extension trees under authored scenery, never original
 * camp props. This one-time immutable geometry update is shared by navigation. */
export function livingSceneryReplacesTree(item:Furniture):boolean {
 if(!item.id.startsWith('world-tree-')||!item.collider)return false;
 const p={x:item.collider.x+item.collider.width/2,y:item.collider.y+item.collider.height/2};
 return LIVING_OUTDOOR_SCENERY.some(s=>p.x>=s.footprint.x-.6&&p.x<=s.footprint.x+s.footprint.width+.6&&p.y>=s.footprint.y-.6&&p.y<=s.footprint.y+s.footprint.height+.6);
}
export function augmentLivingForest(map:WorldMap):WorldMap {
 if(map.furniture.some(f=>f.id==='living:reed-pond'))return map;
 const removed=new Set(map.furniture.filter(livingSceneryReplacesTree).map(f=>f.collider!));
 const additions=LIVING_OUTDOOR_SCENERY.map(furniture),kept=map.furniture.filter(f=>!livingSceneryReplacesTree(f));
 return {...map,furniture:[...kept,...additions],solids:[...map.solids.filter(s=>!removed.has(s)),...additions.flatMap(f=>f.collider?[f.collider]:[])]};
}
export function augmentLivingInterior(interior:ForestInterior):ForestInterior {
 if(interior.buildingId!=='tansy-hut'||interior.map.furniture.some(f=>f.id==='living:reed-dresser'))return interior;
 const additions=REED_HOUSE_SCENERY.map(furniture);
 return {...interior,map:{...interior.map,furniture:[...interior.map.furniture,...additions],solids:[...interior.map.solids,...additions.flatMap(f=>f.collider?[f.collider]:[])]}};
}
