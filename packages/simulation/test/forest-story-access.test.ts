import {describe,expect,it} from 'vitest';
import {createPlayer,isHomeWalkable} from '../src/index';
import {canUseForestStory,canDiscussForestStory} from '../src/forest-story-access';

const map={width:20,height:20,solids:[]};
const player=()=>({...createPlayer('reader','Reader'),x:5,y:5});
const orin={x:7,y:5,phase:'wander' as const};
describe('shared journal eligibility',()=>{
  it('allows rewards in safe interiors but requires Orin outside for discussion',()=>{
    const p=player();
    expect(canUseForestStory('forest',false,p)).toBe(true);
    expect(canDiscussForestStory('forest',false,p,orin,map)).toBe(true);
    p.zone='interior:orin-tower';
    expect(canUseForestStory('forest',false,p)).toBe(true);
    expect(canDiscussForestStory('forest',false,p,orin,map)).toBe(false);
  });
  it('rejects a nearby Orin across an obstacle even when both endpoints are walkable',()=>{
    const p=player(),wall={...map,solids:[{x:5.9,y:4,width:.2,height:2}]};
    expect(isHomeWalkable(p,wall)).toBe(true);expect(isHomeWalkable(orin,wall)).toBe(true);
    expect(canDiscussForestStory('forest',false,p,orin,wall)).toBe(false);
    expect(canDiscussForestStory('forest',false,p,{...orin,x:7.51},map)).toBe(false);
    expect(canDiscussForestStory('forest',false,p,{...orin,x:7.5},map)).toBe(true);
  });
  it('keeps discussion and rewards disabled while disconnected, respawning, racing or changing world',()=>{
    for(const p of[undefined,{...player(),connected:false},{...player(),respawnAt:100},{...player(),mode:'race' as const}]){
      expect(canUseForestStory('forest',false,p)).toBe(false);
      expect(canDiscussForestStory('forest',false,p,orin,map)).toBe(false);
    }
    expect(canUseForestStory('living-room',false,player())).toBe(false);
    expect(canUseForestStory('forest',true,player())).toBe(false);
    expect(canDiscussForestStory('forest',true,player(),orin,map)).toBe(false);
    expect(canDiscussForestStory('forest',false,player(),undefined,map)).toBe(false);
    expect(canDiscussForestStory('forest',false,player(),{...orin,phase:'respawning'},map)).toBe(false);
  });
});
