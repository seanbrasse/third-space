import {describe,expect,it} from 'vitest';
import {FOREST_MAP,type Point,type Rect} from '../src/index';
import {expandAuthoredForest} from '../src/authored-forest';
import {AUTHORED_FOREST_NPCS,FOREST_WILDLIFE} from '../src/forest-cast';
import {FOREST_STORY_BOARD,FOREST_STORY_BOARD_USE} from '../src/forest-story-board';
const hits=(p:Point,s:Rect)=>p.x+.3>s.x&&p.x-.3<s.x+s.width&&p.y+.3>s.y&&p.y-.3<s.y+s.height;
describe('physical discovered-story noticeboard',()=>{
 it('has a reachable ground anchor beside the square without displacing trees or buildings',()=>{
  const map=expandAuthoredForest(FOREST_MAP),board=FOREST_STORY_BOARD;
  expect(board.usePoints).toContainEqual(FOREST_STORY_BOARD_USE);
  for(let x=99.5;x<=FOREST_STORY_BOARD_USE.x;x+=.1)expect([...map.solids,board.collider!].some(s=>hits({x,y:FOREST_STORY_BOARD_USE.y},s))).toBe(false);
  expect(map.furniture.filter(f=>f.id===board.id).length).toBeLessThanOrEqual(1);
 });
 it('does not intersect any named guard, resident or wildlife patrol leg',()=>{
  const routes=[...AUTHORED_FOREST_NPCS.flatMap(n=>Object.values(n.routine)),...FOREST_WILDLIFE.map(a=>a.route)];
  for(const route of routes)for(let i=0;i<route.length;i++){const a=route[i]!,b=route[(i+1)%route.length]!,steps=Math.ceil(Math.hypot(a.x-b.x,a.y-b.y)*10);for(let n=0;n<=steps;n++){const t=steps?n/steps:0;expect(hits({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t},FOREST_STORY_BOARD.collider!)).toBe(false);}}
 });
});
