'use client';
import {useEffect,useId,useLayoutEffect,useRef,useState} from 'react';
import type {ForestStorySnapshot,StoryLead,StoryObjective} from '../../../packages/contracts/src/forest-story';
import {canDiscussBorrowedFace,discoveredLeadConnections,discoveredStoryPeople,STORY_BOARD_TABS,storyBoardCounts,storyBoardNextTab,storyObjectiveProgress,type StoryBoardTab} from '../lib/forest-story-board-model';
import './forest-story-board.css';

export interface ForestStoryBoardProps {
  open:boolean;
  initialTab?:StoryBoardTab;
  snapshot:ForestStorySnapshot|null;
  living?:import('../../../packages/contracts/src/living-world').LivingWorldSnapshot|null;
  onClose:()=>void;
  /** Root should use restoreGameFocus so another newly opened panel keeps focus. */
  onFocusGame?:()=>void;
  onClaimReward?:(rewardId:string)=>void;
  actionsAvailable?:boolean;
  unavailableReason?:string;
  pendingRewardId?:string|null;
  onAccuse?:(suspectId:string)=>void;
  /** Shared authority predicate applied to the latest snapshot; server revalidates every request. */
  canAccuse?:boolean;
  pendingAccusationId?:string|null;
  notice?:string|null;
}
const tabLabels={leads:'Leads',evidence:'Evidence',people:'People',recap:'Recap'};

function Objectives({items}:{items:readonly StoryObjective[]}){
  if(!items.length)return null;
  return <ul className="story-objectives">{items.map(o=>{const p=storyObjectiveProgress(o.current,o.required);return <li key={o.id} data-complete={o.complete}>
    <span className="story-check" aria-label={o.complete?'Complete':'In progress'}>{o.complete?'✓':'·'}</span>
    <span>{o.text}</span>{p.required>1&&<span className="story-objective-count" aria-label={`${p.current} of ${p.required}`}>{p.current}/{p.required}</span>}
  </li>;})}</ul>;
}
function LeadCard({lead,titles}:{lead:StoryLead;titles:ReadonlyMap<string,string>}){
  // connections are IDs; filter against discovered cards before resolving labels.
  const connections=discoveredLeadConnections(lead,titles);
  const content=<><p>{lead.summary}</p><Objectives items={lead.objectives}/>
    {!!lead.npcs.length&&<ul className="story-contributions">{lead.npcs.map(n=><li key={n.id}><strong>{n.name}</strong><span>{n.contribution}</span></li>)}</ul>}
    {!!connections.length&&<p className="story-connections">Connected to {connections.join(' · ')}</p>}
  </>;
  return lead.status==='complete'?<details className="story-lead story-lead-complete"><summary><span>{lead.title}</span><small>Resolved</small></summary><div>{content}</div></details>:
    <article className="story-lead"><header><h3>{lead.title}</h3><small>Open lead</small></header>{content}</article>;
}

/** Discovered-only view: no imports of the authored mystery or future quest graph.
 * Mount persistently inside .world-shell so native dialog also works in fullscreen. */
export default function ForestStoryBoard({open,snapshot,onClose,onFocusGame,onClaimReward,actionsAvailable=true,unavailableReason,pendingRewardId,onAccuse,canAccuse=false,pendingAccusationId,notice,initialTab='leads',living}:ForestStoryBoardProps){
  const dialog=useRef<HTMLDialogElement>(null),close=useRef<HTMLButtonElement>(null),wasOpen=useRef(false),restore=useRef(onFocusGame);
  restore.current=onFocusGame;
  const [tab,setTab]=useState<StoryBoardTab>('leads');
  const previousTab=useRef<StoryBoardTab>('leads');
  useEffect(()=>{if(open)setTab(initialTab);},[open,initialTab]);
  const id=useId(),titleId=`${id}-title`,descriptionId=`${id}-description`;
  const tabs=useRef<Partial<Record<StoryBoardTab,HTMLButtonElement|null>>>({});
  useLayoutEffect(()=>{
    const node=dialog.current;if(!node)return;
    let frame=0;
    if(open){if(!node.open)node.showModal();if(!wasOpen.current)close.current?.focus({preventScroll:true});if(!wasOpen.current||previousTab.current!==tab){const content=node.querySelector('.story-board-scroll');if(content)content.scrollTop=0;}}
    else if(wasOpen.current){node.close();frame=requestAnimationFrame(()=>restore.current?.());}
    wasOpen.current=open;
    previousTab.current=tab;
    return()=>cancelAnimationFrame(frame);
  },[open,tab]);
  useEffect(()=>{const node=dialog.current;return()=>node?.close();},[]);
  // The room continues publishing snapshots while the journal is closed. Keep
  // its native modal owner mounted without rebuilding hidden story cards.
  if(!open)return <dialog ref={dialog} className="forest-story-board"/>;
  const people=snapshot?discoveredStoryPeople(snapshot.story):[];
  const counts=snapshot?storyBoardCounts(snapshot):{leads:0,evidence:0,people:0,recap:0};
  if(living?.rescue.discovered)counts.leads++;
  const titles=new Map(snapshot?.story.leads.map(l=>[l.id,l.title])??[]);
  const active=snapshot?.story.leads.filter(l=>l.status==='active')??[],resolved=snapshot?.story.leads.filter(l=>l.status==='complete')??[];
  const rewards=snapshot?.personal.rewards??[];
  const discussionReady=!!snapshot&&canDiscussBorrowedFace(snapshot.story);
  return <dialog ref={dialog} className="forest-story-board" aria-labelledby={titleId} aria-describedby={descriptionId} aria-modal={open?'true':undefined}
    onCancel={event=>{event.preventDefault();onClose();}}
    onKeyDown={event=>{event.stopPropagation();if(event.key==='Tab'){
      const nodes=[...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled):not([tabindex="-1"]),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,[tabindex="0"]')].filter(node=>node.getClientRects().length>0);
      const first=nodes[0],last=nodes[nodes.length-1];
      if(event.shiftKey&&(document.activeElement===first||document.activeElement===event.currentTarget)){event.preventDefault();last?.focus();}
      else if(!event.shiftKey&&(document.activeElement===last||document.activeElement===event.currentTarget)){event.preventDefault();first?.focus();}
    }}} onKeyUp={event=>event.stopPropagation()}
    onPointerDown={event=>{event.stopPropagation();if(event.target===event.currentTarget){const bounds=event.currentTarget.getBoundingClientRect();if(event.clientX<bounds.left||event.clientX>bounds.right||event.clientY<bounds.top||event.clientY>bounds.bottom)onClose();}}}>
    <div className="story-board-frame">
      <header className="story-board-heading"><div><span className="story-eyebrow">Bramblewick · shared journal</span><h2 id={titleId}>The noticeboard</h2></div>
        <button ref={close} className="story-close" type="button" onClick={onClose} aria-label="Close noticeboard">×</button>
      </header>
      <p id={descriptionId} className="story-board-description">A story this world is writing together. Follow a lead, leave a little knowledge, catch up when you return.</p>
      {snapshot?<>
        <div className="story-board-tabs" role="tablist" aria-label="Noticeboard sections">{STORY_BOARD_TABS.map(t=><button key={t} ref={node=>{tabs.current[t]=node;}} type="button" role="tab"
          id={`${id}-tab-${t}`} aria-controls={`${id}-panel-${t}`} aria-selected={tab===t} tabIndex={tab===t?0:-1}
          onClick={()=>setTab(t)} onKeyDown={event=>{const next=storyBoardNextTab(t,event.key);if(next){event.preventDefault();setTab(next);tabs.current[next]?.focus();}}}>
          {tabLabels[t]}<span aria-label={`${counts[t]} entries`}>{counts[t]}</span>
        </button>)}</div>
        <div className="story-board-scroll" role="tabpanel" id={`${id}-panel-${tab}`} aria-labelledby={`${id}-tab-${tab}`} tabIndex={0}>
          {tab==='leads'&&<>
            {snapshot.personal.catchUp.length>0&&<aside className="story-catch-up"><h3>Since your last visit</h3><ul>{snapshot.personal.catchUp.slice(-3).map(note=><li key={note.id}>{note.text}</li>)}</ul>
              {snapshot.personal.catchUp.length>3&&<button type="button" onClick={()=>{setTab('recap');tabs.current.recap?.focus();}}>Read the shared recap</button>}
            </aside>}
            {snapshot.story.chapter!=='undiscovered'&&<section className="story-main-thread"><span className="story-eyebrow">The main thread</span><h3>{snapshot.story.title}</h3><p>{snapshot.story.summary}</p><Objectives items={snapshot.story.objectives}/></section>}
            {living?.rescue.discovered&&<article className="story-lead" aria-label="Lantern Road shared lead"><header><h3>Lantern Road</h3><small>{living.rescue.stage==='complete'?'Resolved':'Shared side lead'}</small></header><p>{living.rescue.summary}</p><p><strong>{living.rescue.objective}</strong></p>
              <p>{['recovering','complete'].includes(living.rescue.stage)?'Mara is at the south end of Bramblewick.':'Find Mara beside the apple cart in Lantern Orchard, then follow the southern road east and the pond road north to Bramblewick.'}</p>
              {living.rescue.setbacks>0&&<p>{living.rescue.setbacks} roadside {living.rescue.setbacks===1?'setback':'setbacks'} recorded. Mara can recover; the home can try again.</p>}
              {living.personal.rewards.map(reward=><p key={reward.id}>{reward.status==='claimed'?'Your thank-you speed tonic is collected.':'Your personal speed tonic is waiting. Speak to Mara in Bramblewick to collect it.'}</p>)}
            </article>}
            {!!active.length&&<section aria-label="Open leads"><h3 className="story-section-label">Open leads</h3>{active.map(lead=><LeadCard key={lead.id} lead={lead} titles={titles}/>)}</section>}
            {!active.length&&!resolved.length&&!living?.rescue.discovered&&<p className="story-empty">No notices yet. Talk to the people you meet; a small conversation can become the first thread.</p>}
            {!!resolved.length&&<section aria-label="Resolved leads"><h3 className="story-section-label">What we have settled</h3>{resolved.map(lead=><LeadCard key={lead.id} lead={lead} titles={titles}/>)}</section>}
            {!!rewards.length&&<section className="story-rewards" aria-label="Your rewards"><h3>Your keepsakes</h3><p>Shared discoveries; a thank-you of your own.</p>{rewards.map(reward=><article key={reward.id}><div><strong>{reward.title}</strong><span>{reward.apples>0?`${reward.apples} apples · `:''}Keepsake badge</span></div>
              {reward.status==='claimed'?<span className="story-reward-claimed">Collected ✓</span>:onClaimReward?<button type="button" disabled={!actionsAvailable||!!pendingRewardId||!!pendingAccusationId} onClick={()=>onClaimReward(reward.id)}>{pendingRewardId===reward.id?'Collecting…':'Collect reward'}</button>:<span>Ready to collect</span>}
            </article>)}</section>}
          </>}
          {tab==='evidence'&&<>{snapshot.story.evidence.length?<div className="story-evidence-grid">{snapshot.story.evidence.map(e=>{const source=people.find(p=>p.id===e.sourceNpcId);return <article className="story-evidence" key={e.id}><span className="story-paper-pin" aria-hidden="true"/><h3>{e.title}</h3><p>{e.text}</p>{source&&<small>Shared by {source.name}</small>}</article>;})}</div>:<p className="story-empty">Nothing has been pinned here yet. Discovered clues will remain for everyone who comes after.</p>}</>}
          {tab==='people'&&<>{discussionReady&&<p className="story-discussion-help" id={`${id}-discussion-help`}>{canAccuse?'You have the accounts and evidence. Discuss the borrowed face with Orin.':'Speak beside Orin to compare the evidence.'}</p>}{people.length?<ul className="story-people">{people.map(person=><li key={person.id}><h3>{person.name}</h3>{person.contributions.map(line=><p key={line}>{line}</p>)}
            {person.testimony&&<blockquote>{person.testimony}</blockquote>}{person.accused&&<p className="story-recorded">Accusation recorded in this world.</p>}
            {!!person.leadTitles.length&&<small>Connected to {person.leadTitles.join(' · ')}</small>}
            {discussionReady&&onAccuse&&snapshot.story.suspects.some(s=>s.id===person.id)&&<button className="story-discuss-face" type="button" aria-describedby={`${id}-discussion-help`} disabled={!actionsAvailable||!canAccuse||!!pendingRewardId||!!pendingAccusationId||person.accused} onClick={()=>onAccuse(person.id)}>{person.accused?'Already discussed':pendingAccusationId===person.id?'Discussing…':'Discuss this face with Orin'}</button>}
          </li>)}</ul>:<p className="story-empty">Names and connections appear as this world meets people and hears their stories.</p>}</>}
          {tab==='recap'&&<>{snapshot.story.recap.length?<ol className="story-recap">{snapshot.story.recap.map((note,index)=><li key={note.id}><span aria-hidden="true">{index+1}</span><p>{note.text}</p></li>)}</ol>:<p className="story-empty">This page is waiting for its first shared memory.</p>}</>}
        </div>
      </>:<div className="story-board-scroll"><p className="story-empty" role="status">Opening this world’s journal…</p></div>}
      <footer className="story-board-footer"><span>Friends can follow other leads while you are away.</span>{(unavailableReason||notice)&&<p role="status">{unavailableReason||notice}</p>}</footer>
    </div>
  </dialog>;
}
