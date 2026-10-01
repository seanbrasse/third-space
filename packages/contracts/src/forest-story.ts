/** Discovered information only. No mystery seed, culprit, or unreached graph belongs here. */
export type ForestStoryChapter = 'undiscovered' | 'wards' | 'inquiry' | 'rescue' | 'complete';
export interface StoryObjective { id: string; text: string; current: number; required: number; complete: boolean }
export interface StoryLead {
  id: string;
  title: string;
  summary: string;
  status: 'active' | 'complete';
  connections: string[];
  npcs: { id: string; name: string; contribution: string }[];
  objectives: StoryObjective[];
}
export interface StoryEvidence { id: string; title: string; text: string; sourceNpcId?: string }
export interface StorySuspect { id: string; name: string; testimony?: string; accused?: boolean }
export interface StoryRecap { id: string; at: number; text: string; revision: number }
export interface ForestStoryView {
  revision: number;
  chapter: ForestStoryChapter;
  title: string;
  summary: string;
  objectives: StoryObjective[];
  leads: StoryLead[];
  evidence: StoryEvidence[];
  suspects: StorySuspect[];
  recap: StoryRecap[];
}
export interface StoryRewardView {
  id: string;
  title: string;
  apples: number;
  badge: string;
  status: 'pending' | 'claimed';
}
export interface ForestStorySnapshot {
  story: ForestStoryView;
  personal: {
    inventory: { apples: number; revision: number };
    badges: string[];
    rewards: StoryRewardView[];
    catchUp: StoryRecap[];
  };
}
