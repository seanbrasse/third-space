import {describe,expect,it} from 'vitest';
import {StoryActions,STORY_ACTION_TIMEOUT_MS} from './story-actions';

const reward={type:'story.reward',rewardId:'fair-rind'} as const;
const discuss={type:'story.accuse',suspectId:'goblin-nib'} as const;
describe('journal actions across latency and admission changes',()=>{
  it('admits only one action even before UI updates and blocks both action kinds',()=>{
    const actions=new StoryActions(),room={};
    const pending=actions.begin(room,'first',reward,100)!;
    expect(actions.begin(room,'double-click',reward,101)).toBeNull();
    expect(actions.begin(room,'other-button',discuss,101)).toBeNull();
    expect(actions.pending).toBe(pending);
    expect(actions.complete(room,'first')).toBe(true);
    expect(actions.begin(room,'intentional-next-action',discuss,102)?.targetId).toBe('goblin-nib');
  });
  it('does not accept another actor notice or a reply from a retired connection',()=>{
    const actions=new StoryActions(),oldRoom={},room={};
    actions.begin(room,'current',reward,0);
    expect(actions.complete(room,'somebody-else')).toBe(false);
    expect(actions.complete(oldRoom,'current')).toBe(false);
    expect(actions.pending?.commandId).toBe('current');
    actions.clear();actions.begin(oldRoom,'new-admission',discuss,1);
    expect(actions.complete(room,'current')).toBe(false);
    expect(actions.pending?.commandId).toBe('new-admission');
  });
  it('times out without replay and accepts a late confirmation until another intentional action starts',()=>{
    const actions=new StoryActions(),room={};
    const pending=actions.begin(room,'slow',reward,5)!;
    expect(actions.expire(pending,5+STORY_ACTION_TIMEOUT_MS-1)).toBe(false);
    expect(actions.expire(pending,5+STORY_ACTION_TIMEOUT_MS)).toBe(true);
    expect(actions.pending).toBeNull();
    expect(actions.complete(room,'slow')).toBe(true);
    expect(actions.complete(room,'slow')).toBe(false);
  });
  it('cannot let an old timeout or late reply clear a retry, and clears uncertain replies on disconnect',()=>{
    const actions=new StoryActions(),room={};
    const first=actions.begin(room,'slow',reward,0)!;
    actions.expire(first,STORY_ACTION_TIMEOUT_MS);
    const retry=actions.begin(room,'retry',reward,STORY_ACTION_TIMEOUT_MS+1)!;
    expect(actions.complete(room,'slow')).toBe(false);
    expect(actions.expire(first,STORY_ACTION_TIMEOUT_MS+2)).toBe(false);
    expect(actions.pending).toBe(retry);
    actions.expire(retry,2*STORY_ACTION_TIMEOUT_MS+1);actions.clear();
    expect(actions.complete(room,'retry')).toBe(false);
  });
});
