import type { Furniture, Point, Rect, WorldMap } from './index';
import { AUTHORED_FOREST_NPCS, FOREST_WILDLIFE } from './forest-cast';

/** Authored locations share one outdoor coordinate space. These labels are lore,
 * never transport regions, server partitions, or barriers to another player's view. */
export const AUTHORED_FOREST_SIZE = Object.freeze({ width: 144, height: 112 });
export type ForestTheme = 'pines' | 'meadow' | 'village' | 'highland' | 'deadwood';
export type TreeStyle = 'pine' | 'birch' | 'oak' | 'willow' | 'dead';
export type BuildingStyle = 'inn' | 'cottage' | 'cheese-shop' | 'castle' | 'wizard-tower' | 'witch-hut' | 'keeper-hut' | 'ruin' | 'goblin-tent';
export interface ForestLocation { id:string; name:string; center:Point; radius:number; theme:ForestTheme; description:string }
export const FOREST_LOCATIONS: readonly ForestLocation[] = [
  {id:'bramblewick', name:'Bramblewick', center:{x:97,y:39}, radius:16, theme:'village', description:'A village that still sets an extra place for the missing forest keeper.'},
  {id:'crownwatch', name:'Crownwatch', center:{x:124,y:21}, radius:18, theme:'highland', description:'A modest woodland court guarding an enormous secret: the crown is only borrowed.'},
  {id:'lantern-orchard', name:'Lantern Orchard', center:{x:46,y:84}, radius:13, theme:'meadow', description:'Orin keeps a window lit for a friend who knows every path except the way home.'},
  {id:'reed-witch', name:'The Reed House', center:{x:108,y:70}, radius:12, theme:'meadow', description:'Tansy mends both kettles and promises, though only one kind whistles.'},
  {id:'hollow-bough', name:'Hollow Bough', center:{x:125,y:94}, radius:18, theme:'deadwood', description:'The leaves vanished the night the brass wards stopped humming.'},
  {id:'button-camps', name:'Button Camps', center:{x:79,y:91}, radius:15, theme:'pines', description:'Goblins traded their boots for supplies. Someone paid them in familiar voices.'},
  {id:'keeper-cottage', name:'The Unlatched House', center:{x:38,y:101}, radius:9, theme:'meadow', description:'Keeper Ada left in a hurry. Her kettle is cold, her door still open.'},
];
export interface ForestRoad { id:string; width:number; points:readonly Point[] }
export const FOREST_ROADS: readonly ForestRoad[] = [
  {id:'east-road',width:3.8,points:[{x:24,y:24},{x:96,y:24},{x:124.5,y:24},{x:124.5,y:20.5}]},
  {id:'village-lane',width:4,points:[{x:96,y:24},{x:97,y:38},{x:97,y:51}]},
  {id:'inn-step',width:3,points:[{x:97,y:38},{x:92,y:38},{x:92,y:36.5}]},
  {id:'cheese-step',width:3,points:[{x:97,y:38},{x:104,y:38},{x:104,y:36.5}]},
  {id:'cottage-step',width:3,points:[{x:97,y:50},{x:91.5,y:50},{x:91.5,y:49.5}]},
  {id:'south-road',width:3.8,points:[{x:24,y:24},{x:24,y:84},{x:46,y:84},{x:72,y:84},{x:96,y:70},{x:107.5,y:70},{x:107.5,y:68.5}]},
  {id:'reed-lane',width:3.6,points:[{x:97,y:51},{x:96,y:70}]},
  {id:'hollow-road',width:3.4,points:[{x:107.5,y:70},{x:115,y:77},{x:115,y:94},{x:124,y:94},{x:124,y:91.5}]},
  {id:'keeper-lane',width:3.4,points:[{x:46,y:84},{x:46,y:102},{x:37.5,y:102},{x:37.5,y:101.5}]},
  {id:'button-loop',width:3.4,points:[{x:72,y:84},{x:72.5,y:93},{x:85.5,y:102},{x:90,y:91},{x:90,y:83},{x:82.5,y:83},{x:82.5,y:81.5}]},
];
export function pointSegmentDistance(p:Point,a:Point,b:Point):number {
  const dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1)));
  return Math.hypot(p.x-a.x-dx*t,p.y-a.y-dy*t);
}
export function forestRoadAt(p:Point,padding=0):ForestRoad|undefined {
  return FOREST_ROADS.find(r=>r.points.some((b,i)=>i>0&&pointSegmentDistance(p,r.points[i-1]!,b)<=r.width/2+padding));
}
export function naturalForestTheme(p:Point):ForestTheme {
  // Irregular overlapping groves; the renderer may blend palette edges. No region outlines.
  const wobble=Math.sin(p.x*.17)*1.5+Math.cos(p.y*.13)*1.2;
  const loc=FOREST_LOCATIONS.find(l=>l.theme!=='pines'&&Math.hypot((p.x-l.center.x)*.92,p.y-l.center.y)<l.radius+wobble);
  return loc?.theme??'pines';
}

export interface ForestBuilding { id:string; name:string; style:BuildingStyle; footprint:Rect; door:Point; interiorId?:string; description:string }
export const FOREST_BUILDINGS: readonly ForestBuilding[] = [
  {id:'bramble-inn',name:'The Extra Chair',style:'inn',footprint:{x:88,y:29,width:8,height:7},door:{x:92,y:36.5},interiorId:'interior:bramble-inn',description:'Nessa keeps the keeper’s chair by the hearth.'},
  {id:'cheese-house',name:'Bramble & Rind',style:'cheese-shop',footprint:{x:101,y:31,width:6,height:5},door:{x:104,y:36.5},interiorId:'interior:cheese-house',description:'Merrit’s best cheese has a bite shaped like a brass ward.'},
  {id:'mill-cottage',name:'The Menders’ Cottage',style:'cottage',footprint:{x:88,y:43,width:7,height:6},door:{x:91.5,y:49.5},interiorId:'interior:mill-cottage',description:'Pell and Lark mend cloaks and compare footprints.'},
  {id:'crownwatch-hall',name:'Crownwatch Hall',style:'castle',footprint:{x:116,y:7,width:17,height:13},door:{x:124.5,y:20.5},interiorId:'interior:crownwatch-hall',description:'An open court where a queen admits what her guard cannot prove.'},
  {id:'orin-tower',name:'Orin’s Lantern',style:'wizard-tower',footprint:{x:42,y:73,width:8,height:9},door:{x:46,y:82.5},interiorId:'interior:orin-tower',description:'A tower of books, brass fittings and one stubborn candle.'},
  {id:'tansy-hut',name:'The Reed House',style:'witch-hut',footprint:{x:104,y:61,width:7,height:7},door:{x:107.5,y:68.5},interiorId:'interior:tansy-hut',description:'Tansy’s herb bundles smell like rain on warm stones.'},
  {id:'keeper-house',name:'Ada’s Unlatched House',style:'keeper-hut',footprint:{x:34,y:95,width:7,height:6},door:{x:37.5,y:101.5},interiorId:'interior:keeper-house',description:'A journal has been torn carefully, rather than in anger.'},
  {id:'hollow-observatory',name:'Hollow Observatory',style:'ruin',footprint:{x:119,y:83,width:10,height:8},door:{x:124,y:91.5},interiorId:'interior:hollow-observatory',description:'Vesper studies the gaps between remembered stars.'},
  {id:'button-tent-a',name:'Copperbutton Camp',style:'goblin-tent',footprint:{x:70,y:88,width:5,height:4},door:{x:72.5,y:92.5},description:'A lost ward holds a soup pot upright.'},
  {id:'button-tent-b',name:'Mossbutton Camp',style:'goblin-tent',footprint:{x:80,y:77,width:5,height:4},door:{x:82.5,y:81.5},description:'A ward is being polished as a highly unsuccessful mirror.'},
  {id:'button-tent-c',name:'Pearlbutton Camp',style:'goblin-tent',footprint:{x:83,y:96,width:5,height:4},door:{x:85.5,y:100.5},description:'The third ward marks a board game nobody remembers inventing.'},
];
export const WARD_CACHE_ANCHORS = [
  {id:'brass-seal-a',buildingId:'button-tent-a',x:74.5,y:93.5},
  {id:'brass-seal-b',buildingId:'button-tent-b',x:85,y:83},
  {id:'brass-seal-c',buildingId:'button-tent-c',x:88,y:101.5},
] as const;
const treeStyles: readonly TreeStyle[]=['pine','birch','oak','willow'];
function nearBuilding(p:Point,padding:number){return FOREST_BUILDINGS.some(b=>p.x>=b.footprint.x-padding&&p.x<=b.footprint.x+b.footprint.width+padding&&p.y>=b.footprint.y-padding&&p.y<=b.footprint.y+b.footprint.height+padding);}
const residentRoutes=[...AUTHORED_FOREST_NPCS.flatMap(n=>Object.values(n.routine)),...FOREST_WILDLIFE.map(a=>a.route)];
function nearRoutine(p:Point){return residentRoutes.some(route=>route.some((a,i)=>pointSegmentDistance(p,a,route[(i+1)%route.length]!)<1.4));}
export function authoredTreeStyle(id:string):TreeStyle|undefined {return (['pine','birch','oak','willow','dead'] as const).find(s=>id.startsWith(`world-tree-${s}-`));}
export function authoredBuildingStyle(id:string):BuildingStyle|undefined {return FOREST_BUILDINGS.find(b=>b.id===id)?.style;}
export function createAuthoredForestFurniture():Furniture[] {
  const items:Furniture[]=FOREST_BUILDINGS.map(b=>({id:b.id,kind:'structure',footprint:{...b.footprint},collider:{x:b.footprint.x+.35,y:b.footprint.y+.6,width:b.footprint.width-.7,height:b.footprint.height-1.15},usePoints:[{...b.door}],seats:[]}));
  for(let gy=4;gy<108;gy+=4.5)for(let gx=4;gx<140;gx+=4.5){
    const seed=Math.abs(Math.round(gx*19+gy*43));
    const p={x:gx+(seed%7)/10,y:gy+(seed%5)/10};
    if(p.x<80&&p.y<64)continue; // Every core prop and its original coordinate survives.
    if(forestRoadAt(p,2)||nearBuilding(p,3)||nearRoutine(p))continue;
    if(FOREST_LOCATIONS.some(l=>Math.hypot(p.x-l.center.x,p.y-l.center.y)<(l.id==='crownwatch'?12:l.id==='bramblewick'?12:l.id==='button-camps'?6:5)))continue;
    const theme=naturalForestTheme(p),style:TreeStyle=theme==='deadwood'?'dead':theme==='meadow'?(seed%2?'birch':'willow'):treeStyles[seed%treeStyles.length]!;
    const width=style==='oak'||style==='willow'?3:2,height=style==='oak'?3.5:4;
    items.push({id:`world-tree-${style}-${gx}-${gy}`,kind:'tree',footprint:{x:p.x-width/2,y:p.y-height+.6,width,height},collider:{x:p.x-.3,y:p.y-.3,width:.6,height:.6},usePoints:[],seats:[]});
  }
  return items;
}
/** Feed the unexpanded 80×64 map once; immutable output is suitable for navigation caches. */
export function expandAuthoredForest(base:WorldMap):WorldMap {
  if(base.id==='midnight-pines-v2'&&base.width===144&&base.height===112)return base;
  const {width,height}=AUTHORED_FOREST_SIZE;
  const furniture=[...base.furniture,...createAuthoredForestFurniture()];
  return {...base,id:'midnight-pines-v2',width,height,furniture,solids:[
    {x:0,y:0,width,height:1},{x:0,y:height-1,width,height:1},{x:0,y:0,width:1,height},{x:width-1,y:0,width:1,height},
    ...furniture.flatMap(f=>f.collider?[f.collider]:[]),
  ]};
}

export interface ForestInterior { id:string; name:string; buildingId:string; style:BuildingStyle; map:WorldMap; entrance:Point; exit:Point; returnPoint:Point; flavor:string; clue?:{id:string;point:Point;text:string} }
function object(id:string,kind:Furniture['kind'],footprint:Rect,solid=true):Furniture{return{id,kind,footprint,collider:solid?{...footprint}:null,usePoints:[],seats:[]};}
export function createForestInterior(building:ForestBuilding):ForestInterior|undefined {
  if(!building.interiorId)return undefined;
  const grand=building.style==='castle',width=grand?22:16,height=grand?19:15;
  const entrance={x:width/2,y:height-2.5},exit={x:width/2,y:height-1.6};
  const furniture:Furniture[]=[
    object(`${building.id}:rug`,'rug',{x:width/2-2,y:6,width:4,height:5},false),
    object(`${building.id}:shelf-left`,'bookcase',{x:2,y:2.3,width:3,height:1.3}),
    object(`${building.id}:shelf-right`,'bookcase',{x:width-5,y:2.3,width:3,height:1.3}),
    object(`${building.id}:table`,'table',{x:2.2,y:7,width:2.6,height:1.7}),
    object(`${building.id}:hearth`,'campfire',{x:width-4.5,y:6,width:2,height:2}),
    {id:`${building.id}:exit`,kind:'portal',footprint:{x:exit.x-1,y:height-2,width:2,height:1},collider:null,usePoints:[exit],seats:[]},
  ];
  if(grand){furniture.push(object('crownwatch:dais','rug',{x:8,y:3.5,width:6,height:2},false),object('crownwatch:throne-left','chair',{x:9,y:3.5,width:1,height:1.5}),object('crownwatch:throne-right','chair',{x:12,y:3.5,width:1,height:1.5}));}
  if(building.style==='inn')furniture.push(object('inn:guest-table','table',{x:11,y:9.5,width:2.6,height:1.7}),object('inn:extra-chair','chair',{x:3,y:10,width:1,height:1.5}));
  if(building.style==='wizard-tower')furniture.push(object('orin:star-chart','board',{x:6,y:3.9,width:4,height:1.8}));
  if(building.style==='witch-hut')furniture.push(object('tansy:herb-pot','plant',{x:12.5,y:9.5,width:1.5,height:1.5}));
  if(building.style==='keeper-hut'||building.style==='cottage')furniture.push(object(`${building.id}:bed`,'couch',{x:2,y:10,width:3,height:1.5}));
  if(building.style==='ruin')furniture.push(object('hollow:fallen-column','structure',{x:10.5,y:9,width:3,height:1.2}),object('hollow:star-chart','board',{x:6,y:3.9,width:4,height:1.8}));
  const clue=building.id==='keeper-house'?{id:'keeper-journal',point:{x:5.5,y:7.5},text:'Ada’s journal: “The thing repeats words, not promises. I am following the stolen wards to Hollow Bough. Tell Orin not to follow alone.”'}:
    building.id==='hollow-observatory'?{id:'hollow-star-map',point:{x:5.5,y:7.5},text:'Three brass circles frame one blank star. Underneath: “A borrowed face cannot remember a kindness it never received.”'}:undefined;
  return{id:building.interiorId,name:building.name,buildingId:building.id,style:building.style,entrance,exit,returnPoint:{...building.door},flavor:building.description,clue,map:{id:building.interiorId,width,height,spawn:entrance,spawns:Array.from({length:8},(_,i)=>({x:width/2-1.5+i%4,y:height-3.5-Math.floor(i/4)})),furniture,seats:[],solids:[{x:0,y:0,width,height:1.8},{x:0,y:height-1,width,height:1},{x:0,y:0,width:1,height},{x:width-1,y:0,width:1,height},...furniture.flatMap(f=>f.collider?[f.collider]:[])]}};
}
export const FOREST_INTERIORS:readonly ForestInterior[]=FOREST_BUILDINGS.flatMap(b=>{const i=createForestInterior(b);return i?[i]:[];});
