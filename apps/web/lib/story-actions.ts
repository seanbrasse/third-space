export type StoryAction = {type:'story.reward';rewardId:string}|{type:'story.accuse';suspectId:string};
export interface PendingStoryAction {
  owner:object;
  commandId:string;
  type:StoryAction['type'];
  targetId:string;
  expiresAt:number;
}
export const STORY_ACTION_TIMEOUT_MS=10_000;

/** One intentional action at a time, including two clicks before React rerenders.
 * A reply from another socket or an older attempt cannot settle the current one. */
export class StoryActions {
  pending:PendingStoryAction|null=null;
  private expired:PendingStoryAction|null=null;
  begin(owner:object,commandId:string,action:StoryAction,now:number):PendingStoryAction|null {
    if(this.pending)return null;
    this.expired=null;
    return this.pending={owner,commandId,type:action.type,targetId:action.type==='story.reward'?action.rewardId:action.suspectId,expiresAt:now+STORY_ACTION_TIMEOUT_MS};
  }
  complete(owner:object,commandId:string):boolean {
    const action=this.pending??this.expired;
    if(action?.owner!==owner||action.commandId!==commandId)return false;
    this.pending=null;this.expired=null;return true;
  }
  expire(action:PendingStoryAction,now:number):boolean {
    if(this.pending!==action||now<action.expiresAt)return false;
    this.pending=null;this.expired=action;return true;
  }
  clear():boolean {const hadPending=!!this.pending;this.pending=null;this.expired=null;return hadPending;}
}
