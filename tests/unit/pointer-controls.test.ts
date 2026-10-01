import {describe,it,expect} from 'vitest';
import {pointerAllowsTravel,pointerFacing} from '../../apps/web/lib/pointer-controls';
import {createPlayer,stepHome} from '@third-space/simulation';
import {InputSchema,DEFAULT_AVATAR} from '@third-space/contracts';
describe('desktop aim and touch travel',()=>{
  it('allows only the actual touch event to request travel, including hybrid devices',()=>{
    expect(pointerAllowsTravel({wasTouch:true})).toBe(true);
    expect(pointerAllowsTravel({wasTouch:false})).toBe(false);
    expect(pointerAllowsTravel({})).toBe(false);
    expect(pointerFacing({x:4,y:4},{x:8,y:5})).toBe('right');
    expect(pointerFacing({x:4,y:4},{x:4,y:1})).toBe('up');
    expect(pointerFacing({x:4,y:4},{x:4,y:4})).toBeUndefined();
  });
  it('validates bounded orientation, without accepting position or destination',()=>{
    const input={seq:1,axisX:0,axisY:0,jump:false,look:'left'};
    expect(InputSchema.safeParse(input).success).toBe(true);
    for(const invalid of [{...input,look:'northwest'},{...input,x:10},{...input,destination:{x:10,y:10}}])expect(InputSchema.safeParse(invalid).success).toBe(false);
  });
  it('turns without translating and can keep aiming independently while walking',()=>{
    const player=createPlayer('look','Look',DEFAULT_AVATAR);player.x=10;player.y=10;
    const input=InputSchema.parse({seq:1,axisX:0,axisY:0,jump:false,look:'left'});
    const turned=stepHome(player,input,.1);
    expect(turned.x).toBe(player.x);expect(turned.y).toBe(player.y);expect(turned.facing).toBe('left');
    const seated=stepHome({...player,seatId:'fire-seat'},input,.1);expect(seated.seatId).toBe('fire-seat');expect(seated.x).toBe(player.x);expect(seated.y).toBe(player.y);expect(seated.facing).toBe('left');
    const walking=stepHome(player,{...input,axisX:1},.1);
    expect(walking.x).toBeGreaterThan(player.x);expect(walking.facing).toBe('left');
    expect(stepHome({...player,connected:false},input,.1).facing).toBe(player.facing);
  });
});
