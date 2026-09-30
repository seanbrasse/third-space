export interface Point {
  x: number;
  y: number;
}
export interface Rect extends Point {
  width: number;
  height: number;
}
export interface WorldObject extends Rect {
  id: string;
}
export interface Seat extends Point {
  id: string;
}
export interface Checkpoint extends Rect {
  id: string;
  spawn: Point;
}
export interface Furniture {
  id: string;
  kind: "couch" | "table" | "chair" | "board" | "tv" | "portal" | "bookcase" | "plant" | "rug" | "tree" | "campfire" | "camper" | "structure" | "log";
  footprint: Rect;
  collider: Rect | null;
  usePoints: readonly Point[];
  seats: readonly Seat[];
}

export const GAME_CONFIG = Object.freeze({
  protocolVersion: 1,
  partyCapacity: 8,
  simulationHz: 60,
  snapshotHz: 20,
  inputHz: 30,
  inputTimeoutMs: 250,
  reconnectGraceMs: 30_000,
  playerRadius: 0.3,
  homeSpeed: 4,
  raceSpeed: 6,
  raceGravity: 30,
  raceJumpVelocity: -10,
  raceTerminalVelocity: 18,
  raceCoyoteSeconds: 0.1,
  raceJumpBufferSeconds: 0.1,
  hazardRespawnSeconds: 0.5,
  raceCountdownMs: 3_000,
  raceTimeoutMs: 120_000,
  voiceFullGainDistance: 2,
  voiceSubscribeDistance: 11.5,
  voiceCutoffDistance: 12,
  maxChatLength: 280,
  maxChatHistory: 100,
  chatWindowMs: 10_000,
  chatWindowLimit: 5,
  bubbleLifetimeMs: 8_000,
  emoteCooldownMs: 1_000,
  emoteLifetimeMs: 3_000,
  soundCooldownMs: 3_000,
  socialTargetDistance: 2,
  interactionDistance: 1.5,
});

export const AVATAR_COLORS = [
  "#d88c71",
  "#9573c5",
  "#68b8a1",
  "#ddba62",
  "#69a6cc",
  "#de8ab2",
] as const;
export const SKIN_COLORS = ["#f3d6bd", "#dfb391", "#c18c68", "#a36e4f", "#794c35", "#513429"] as const;
export const HAIR_COLORS = ["#342a26", "#635044", "#a1744c", "#d5b96e", "#b86b53", "#8c769b"] as const;
export const CLOTHING_COLORS = ["#6c8364", "#769dad", "#b16e67", "#b49268", "#8e789e", "#e0cda0"] as const;
export const TROUSER_COLORS = ["#52627a", "#4a5359", "#75644f", "#73816b", "#927b87", "#d2c0a0"] as const;
export const HAIR_IDS = ["short", "curly", "long", "none"] as const;
export const OUTFIT_IDS = ["hoodie", "overalls", "tee", "jacket"] as const;
export const ACCESSORY_IDS = [
  "none",
  "beanie",
  "glasses",
  "headphones",
] as const;
export const EMOTE_IDS = [
  "wave",
  "heart",
  "laugh",
  "dance",
  "poke",
  "high-five",
] as const;
export const SOUND_IDS = ["chime", "pop", "ta-da", "boop"] as const;

/** Native art footprints, physical bases and interaction anchors share tile units.
 * The couch back is solid while its front cushions contain safe seated centers. */
export const HOME_FURNITURE: readonly Furniture[] = [
  {id: "lounge-couch", kind: "couch", footprint: {x: 3, y: 5, width: 4, height: 2}, collider: {x: 3, y: 5, width: 4, height: 1.1},
    usePoints: [{x: 3.6, y: 6.6}, {x: 4.6, y: 6.6}, {x: 5.6, y: 6.6}, {x: 6.6, y: 6.6}],
    seats: [{id: "sofa-left", x: 3.6, y: 6.6}, {id: "sofa-middle", x: 4.6, y: 6.6}, {id: "sofa-end", x: 5.6, y: 6.6}, {id: "sofa-right", x: 6.6, y: 6.6}]},
  {id: "coffee-table", kind: "table", footprint: {x: 4, y: 8, width: 2.5, height: 1.5}, collider: {x: 4, y: 8, width: 2.5, height: 1.5}, usePoints: [], seats: []},
  {id: "gathering-table", kind: "table", footprint: {x: 9, y: 7, width: 3, height: 2}, collider: {x: 9, y: 7, width: 3, height: 2}, usePoints: [], seats: []},
  {id: "chair-left-object", kind: "chair", footprint: {x: 7.9, y: 6.5, width: 1, height: 1.4}, collider: null, usePoints: [{x: 8.4, y: 7.5}], seats: [{id: "chair-left", x: 8.4, y: 7.5}]},
  {id: "chair-right-object", kind: "chair", footprint: {x: 12.1, y: 6.5, width: 1, height: 1.4}, collider: null, usePoints: [{x: 12.6, y: 7.5}], seats: [{id: "chair-right", x: 12.6, y: 7.5}]},
  {id: "table-stool-left-object", kind: "chair", footprint: {x: 9.1, y: 8.6, width: 1, height: 1.4}, collider: null, usePoints: [{x: 9.6, y: 9.6}], seats: [{id: "table-stool-left", x: 9.6, y: 9.6}]},
  {id: "table-stool-right-object", kind: "chair", footprint: {x: 10.9, y: 8.6, width: 1, height: 1.4}, collider: null, usePoints: [{x: 11.4, y: 9.6}], seats: [{id: "table-stool-right", x: 11.4, y: 9.6}]},
  {id: "idea-board", kind: "board", footprint: {x: 8, y: 1.3, width: 3, height: 0.7}, collider: null, usePoints: [{x: 9.5, y: 2.6}], seats: []},
  {id: "world-tv", kind: "tv", footprint: {x: 3, y: 1.3, width: 3, height: 1.3}, collider: {x: 3, y: 1.6, width: 3, height: 1}, usePoints: [{x: 4.5, y: 3.3}], seats: []},
  {id: "race-portal", kind: "portal", footprint: {x: 16, y: 13, width: 2, height: 2}, collider: null, usePoints: [{x: 17, y: 15.5}, {x: 17, y: 12.5}], seats: []},
  {id: "home-bookcase", kind: "bookcase", footprint: {x: 15, y: 2, width: 2, height: 2}, collider: {x: 15, y: 3, width: 2, height: 1}, usePoints: [], seats: []},
  {id: "home-plant", kind: "plant", footprint: {x: 16.5, y: 7, width: 1, height: 1.5}, collider: {x: 16.6, y: 8, width: 0.8, height: 0.5}, usePoints: [], seats: []},
  {id: "lounge-rug", kind: "rug", footprint: {x: 2.5, y: 7.3, width: 5, height: 3.2}, collider: null, usePoints: [], seats: []},
];
const homeObject = (id: string): WorldObject => ({id, ...HOME_FURNITURE.find((item) => item.id === id)!.footprint});
/** Avatar centers use tiles; all eight entrances and furniture use points are reachable. */
export const HOME_MAP = {
  id: "cozy-home-v2",
  width: 20,
  height: 20,
  wallHeight: 2,
  spawn: { x: 10, y: 12 },
  spawns: [
    { x: 8, y: 12 }, { x: 9, y: 12 }, { x: 10, y: 12 }, { x: 11, y: 12 },
    { x: 8, y: 13.5 }, { x: 9, y: 13.5 }, { x: 10, y: 13.5 }, { x: 11, y: 13.5 },
  ],
  furniture: HOME_FURNITURE,
  solids: [
    { x: 0, y: 0, width: 20, height: 2 }, { x: 0, y: 19, width: 20, height: 1 },
    { x: 0, y: 0, width: 1, height: 20 }, { x: 19, y: 0, width: 1, height: 20 },
    ...HOME_FURNITURE.flatMap((item) => item.collider ? [item.collider] : []),
  ] satisfies Rect[],
  seats: HOME_FURNITURE.flatMap((item) => [...item.seats]),
  portal: homeObject("race-portal"), board: homeObject("idea-board"), tv: homeObject("world-tv"),
  zones: [{ id: "home", x: 0, y: 0, width: 20, height: 20 }],
} as const;

export const RACE_MAP = {
  id: "garden-dash-v2",
  width: 360,
  height: 18,
  spawn: { x: 2, y: 15.7 },
  platforms: [
    { x: 0, y: 16, width: 360, height: 2 },
    ...[0, 90, 180, 270].flatMap((section) =>
      [13, 29, 46, 64].map((x) => ({
        x: section + x,
        y: 15,
        width: 2,
        height: 1,
      })),
    ),
  ] satisfies Rect[],
  hazards: [
    ...[0, 90, 180, 270].flatMap((section) => [
      { x: section + 9, y: 15.4, width: 1, height: 0.6 },
      { x: section + 24, y: 15.4, width: 1.1, height: 0.6 },
      { x: section + 40, y: 15.4, width: 1.2, height: 0.6 },
      { x: section + 58, y: 15.4, width: 1.2, height: 0.6 },
      { x: section + 71, y: 15.4, width: 1.2, height: 0.6 },
    ]),
  ] satisfies Rect[],
  checkpoints: [
    {
      id: "checkpoint-1",
      x: 83,
      y: 0,
      width: 1,
      height: 16,
      spawn: { x: 84.5, y: 15.7 },
    },
    {
      id: "checkpoint-2",
      x: 173,
      y: 0,
      width: 1,
      height: 16,
      spawn: { x: 174.5, y: 15.7 },
    },
    {
      id: "checkpoint-3",
      x: 263,
      y: 0,
      width: 1,
      height: 16,
      spawn: { x: 264.5, y: 15.7 },
    },
    {
      id: "checkpoint-4",
      x: 350,
      y: 0,
      width: 1,
      height: 16,
      spawn: { x: 351.5, y: 15.7 },
    },
  ] satisfies Checkpoint[],
  finish: { id: "finish", x: 357, y: 0, width: 2, height: 16 },
} as const;


// World maps share tile coordinates, collision and interaction metadata with prediction.
export type WorldId = "living-room" | "forest";
export interface WorldMap {
  id: string; width: number; height: number; spawn: Point;
  spawns: readonly Point[]; solids: readonly Rect[];
  furniture: readonly Furniture[]; seats: readonly Seat[];
}
export interface WorldDefinition {
  id: WorldId; name: string; description: string; map: WorldMap;
  camera: "fit" | "follow"; dark: boolean;
  fire?: Point; mediaSurface: Rect & { id: string; source: Point };
}
const forestSeats: Seat[] = Array.from({length:8}, (_,i)=>({
  id:`camp-seat-${i+1}`, x:24+Math.cos(i*Math.PI/4)*3.2, y:24+Math.sin(i*Math.PI/4)*3.2,
}));
const forestFurniture: Furniture[] = [
  {id:"campfire",kind:"campfire",footprint:{x:23,y:23,width:2,height:2},collider:{x:23.5,y:23.5,width:1,height:1},usePoints:forestSeats,seats:[]},
  ...forestSeats.map(s=>({id:s.id+"-log",kind:"log" as const,footprint:{x:s.x-.65,y:s.y-.65,width:1.3,height:1},collider:null,usePoints:[s],seats:[s]})),
  {id:"forest-camper",kind:"camper",footprint:{x:30,y:20,width:6,height:3},collider:{x:30,y:20.6,width:6,height:2.2},usePoints:[],seats:[]},
  {id:"forest-screen",kind:"tv",footprint:{x:30,y:23.7,width:4,height:2.1},collider:null,usePoints:[{x:29.5,y:26.3}],seats:[]},
  {id:"abandoned-cabin",kind:"structure",footprint:{x:12,y:9,width:6,height:5},collider:{x:12,y:9,width:6,height:4},usePoints:[],seats:[]},
];
for(let y=3;y<46;y+=3) for(let x=3;x<46;x+=3) {
  const p={x:x+((x*7+y*3)%5)/8,y:y+((x*3+y*7)%5)/8};
  const clearing=Math.hypot(p.x-24,p.y-24)<8;
  const path=Math.abs(p.x-24)<2 || Math.abs(p.y-24)<2 ||
    (p.x>10 && p.x<19 && p.y>8 && p.y<17) || (p.x>29 && p.x<37 && p.y>18 && p.y<28);
  if(clearing||path)continue;
  forestFurniture.push({id:`tree-${x}-${y}`,kind:"tree",footprint:{x:p.x-1,y:p.y-2,width:2,height:3},collider:{x:p.x-.3,y:p.y-.25,width:.6,height:.6},usePoints:[],seats:[]});
}
export const FOREST_MAP: WorldMap = {
  id:"midnight-pines-v1",width:48,height:48,spawn:{x:24,y:28.5},
  spawns:Array.from({length:8},(_,i)=>({x:21.5+i%4*1.6,y:28.5+Math.floor(i/4)*1.4})),
  furniture:forestFurniture,seats:forestSeats,
  solids:[{x:0,y:0,width:48,height:1},{x:0,y:47,width:48,height:1},{x:0,y:0,width:1,height:48},{x:47,y:0,width:1,height:48},...forestFurniture.flatMap(f=>f.collider?[f.collider]:[])],
};
export const WORLDS: Record<WorldId,WorldDefinition> = {
  "living-room":{id:"living-room",name:"The reading lounge",description:"Walnut, velvet, and your people.",map:HOME_MAP,camera:"fit",dark:false,mediaSurface:{id:"world-tv",x:3,y:1.3,width:3,height:1.3,source:{x:4.5,y:3.3}}},
  forest:{id:"forest",name:"Midnight Pines",description:"A warm fire. A dark forest. Stay a little longer.",map:FOREST_MAP,camera:"follow",dark:true,fire:{x:24,y:24},mediaSurface:{id:"forest-screen",x:30,y:23.7,width:4,height:2.1,source:{x:32,y:24.7}}},
};
export function getWorld(id: WorldId = "living-room") { return WORLDS[id]; }
export const WORLD_COUNTDOWN_MS=8_000;

export {resolveMediaLink,type MediaSource} from "./media";
