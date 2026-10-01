'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {StoryActions,type PendingStoryAction,type StoryAction} from './story-actions';

export function useStoryActions(){
  const actions=useRef(new StoryActions());
  const [pending,setPending]=useState<PendingStoryAction|null>(null),[notice,setNotice]=useState('');
  const submit=useCallback((owner:object,action:StoryAction,dispatch:(commandId:string)=>boolean|string)=>{
    const next=actions.current.begin(owner,crypto.randomUUID(),action,performance.now());if(!next)return;
    setPending(next);setNotice('');
    let failure='Your action was not sent. Reconnect, then try again.';
    try{const result=dispatch(next.commandId);if(result===true)return;if(typeof result==='string')failure=result;}catch{/* Keep the journal usable after a closing transport. */}
    if(actions.current.complete(owner,next.commandId)){setPending(null);setNotice(failure);}
  },[]);
  const acknowledge=useCallback((owner:object,message:{commandId?:string;message:string})=>{
    if(message.commandId&&actions.current.complete(owner,message.commandId)){setPending(null);setNotice(message.message);}
  },[]);
  const reset=useCallback((interruptedMessage='')=>{
    const interrupted=actions.current.clear();setPending(null);setNotice(interrupted?interruptedMessage:'');
  },[]);
  const dismissNotice=useCallback(()=>setNotice(''),[]);
  useEffect(()=>{
    if(!pending)return;
    const timer=setTimeout(()=>{
      if(actions.current.expire(pending,performance.now())){
        setPending(null);setNotice('No confirmation yet. Reopen the journal to check your progress before trying again.');
      }
    },Math.max(0,Math.ceil(pending.expiresAt-performance.now())));
    return()=>clearTimeout(timer);
  },[pending]);
  return {pending,notice,submit,acknowledge,reset,dismissNotice};
}
