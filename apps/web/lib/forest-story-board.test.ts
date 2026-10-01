import {describe,expect,it} from 'vitest';
import type {ForestStorySnapshot,ForestStoryView} from '../../../packages/contracts/src/forest-story';
import {canDiscussBorrowedFace,discoveredLeadConnections,discoveredStoryPeople,storyBoardCounts,storyBoardNextTab,storyObjectiveProgress} from './forest-story-board-model';
const story=():ForestStoryView=>({revision:1,chapter:'undiscovered',title:'Unknown',summary:'',objectives:[],leads:[],evidence:[],suspects:[],recap:[]});
describe('discovered-only noticeboard presentation',()=>{
 it('shows a side lead before the main mystery and never invents unknown connections or people',()=>{
  const view=story();view.leads=[{id:'fair-rind',title:'A Fair Rind',summary:'Merrit needs a conversation.',status:'active',connections:['unreached-mystery','fair-rind'],objectives:[],npcs:[{id:'merrit',name:'Merrit Rind',contribution:'A worried neighbour.'}]}];
  const snapshot:ForestStorySnapshot={story:view,personal:{inventory:{apples:0,revision:0},badges:[],rewards:[],catchUp:[]}};
  expect(storyBoardCounts(snapshot)).toEqual({leads:1,evidence:0,people:1,recap:0});
  expect(discoveredLeadConnections(view.leads[0]!,new Map([['fair-rind','A Fair Rind']]))).toEqual(['A Fair Rind']);
  expect(discoveredStoryPeople(view).map(p=>p.name)).toEqual(['Merrit Rind']);
 });
 it('merges discovered contributions without duplicating people or converting an accusation into a verdict',()=>{
  const view=story(),npc={id:'fenn',name:'Fenn',contribution:'He carries letters.'};
  view.leads=[{id:'a',title:'Letters',summary:'',status:'active',connections:[],objectives:[],npcs:[npc]},{id:'b',title:'An account',summary:'',status:'complete',connections:[],objectives:[],npcs:[npc]}];
  view.suspects=[{id:'fenn',name:'Fenn',testimony:'A recorded statement.',accused:true}];
  expect(discoveredStoryPeople(view)).toEqual([{id:'fenn',name:'Fenn',contributions:['He carries letters.'],leadTitles:['Letters','An account'],testimony:'A recorded statement.',accused:true}]);
 });
 it('requires the two exact clues and all three discovered accounts before offering a discussion',()=>{
  const view=story();view.chapter='inquiry';view.evidence=[{id:'ada-journal',title:'Journal',text:''},{id:'unrelated-side-evidence',title:'Cheese invoice',text:''}];
  view.suspects=['goblin-nib','flirt-fenn','watch-garrick'].map(id=>({id,name:id,testimony:'An account.'}));
  expect(canDiscussBorrowedFace(view)).toBe(false);
  view.evidence.push({id:'ward-rubbing',title:'Rubbing',text:''});expect(canDiscussBorrowedFace(view)).toBe(true);
  view.suspects[1]!.testimony=' ';expect(canDiscussBorrowedFace(view)).toBe(false);
  view.suspects[1]!.testimony='An account.';view.chapter='rescue';expect(canDiscussBorrowedFace(view)).toBe(false);
 });
 it('provides bounded progress and roving keyboard navigation without treating game keys as tab changes',()=>{
  expect(storyObjectiveProgress(99,3)).toEqual({current:3,required:3});expect(storyObjectiveProgress(-2,0)).toEqual({current:0,required:1});
  expect(storyObjectiveProgress(NaN,Infinity)).toEqual({current:0,required:1});
  expect(storyBoardNextTab('leads','ArrowLeft')).toBe('recap');expect(storyBoardNextTab('recap','ArrowRight')).toBe('leads');
  expect(storyBoardNextTab('people','Home')).toBe('leads');expect(storyBoardNextTab('leads','End')).toBe('recap');
  for(const key of['1','5',' ','w','Enter'])expect(storyBoardNextTab('leads',key)).toBeUndefined();
 });
});
