import type {ForestStorySnapshot,ForestStoryView,StoryLead} from '../../../packages/contracts/src/forest-story';

export const STORY_BOARD_TABS=['leads','evidence','people','recap'] as const;
export type StoryBoardTab=(typeof STORY_BOARD_TABS)[number];
export function storyBoardNextTab(current:StoryBoardTab,key:string):StoryBoardTab|undefined {
  const i=STORY_BOARD_TABS.indexOf(current);
  if(key==='Home')return STORY_BOARD_TABS[0];if(key==='End')return STORY_BOARD_TABS[STORY_BOARD_TABS.length-1];
  if(key==='ArrowRight')return STORY_BOARD_TABS[(i+1)%STORY_BOARD_TABS.length];
  if(key==='ArrowLeft')return STORY_BOARD_TABS[(i+STORY_BOARD_TABS.length-1)%STORY_BOARD_TABS.length];
  return undefined;
}
export function storyObjectiveProgress(current:number,required:number){
  const target=Number.isFinite(required)?Math.max(1,Math.floor(required)):1;
  return{current:Number.isFinite(current)?Math.max(0,Math.min(target,Math.floor(current))):0,required:target};
}
export interface DiscoveredStoryPerson {id:string;name:string;contributions:string[];leadTitles:string[];testimony?:string;accused:boolean}
/** This module deliberately imports no authored cast or plot graph. Relationships
 * are collected exclusively from already-discovered public server view entries. */
export function discoveredStoryPeople(story:ForestStoryView):DiscoveredStoryPerson[]{
  const people=new Map<string,DiscoveredStoryPerson>();
  for(const lead of story.leads)for(const n of lead.npcs){
    const p=people.get(n.id)??{id:n.id,name:n.name,contributions:[],leadTitles:[],accused:false};
    if(n.contribution&&!p.contributions.includes(n.contribution))p.contributions.push(n.contribution);
    if(!p.leadTitles.includes(lead.title))p.leadTitles.push(lead.title);people.set(n.id,p);
  }
  for(const suspect of story.suspects){const p=people.get(suspect.id)??{id:suspect.id,name:suspect.name,contributions:[],leadTitles:[],accused:false};p.testimony=suspect.testimony;p.accused=!!suspect.accused;people.set(p.id,p);}
  return[...people.values()].sort((a,b)=>a.name.localeCompare(b.name));
}
export function storyBoardCounts(snapshot:ForestStorySnapshot){return{leads:snapshot.story.leads.length,evidence:snapshot.story.evidence.length,people:discoveredStoryPeople(snapshot.story).length,recap:snapshot.story.recap.length};}
export function discoveredLeadConnections(lead:StoryLead,titles:ReadonlyMap<string,string>):string[]{return lead.connections.flatMap(id=>titles.has(id)?[titles.get(id)!]:[]);}
export function canDiscussBorrowedFace(story:ForestStoryView):boolean {
  return story.chapter==='inquiry'&&['ada-journal','ward-rubbing'].every(id=>story.evidence.some(e=>e.id===id))&&
    ['goblin-nib','flirt-fenn','watch-garrick'].every(id=>story.suspects.some(s=>s.id===id&&!!s.testimony?.trim()));
}
