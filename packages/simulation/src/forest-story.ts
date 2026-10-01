/** Server story reducer. Never send this state or the private mystery to clients. */
import type { ForestStoryChapter, ForestStoryView, StoryLead, StoryObjective, StoryRecap } from '../../contracts/src/forest-story.js';

export const FOREST_STORY_VERSION = 1;
export const STORY_SEALS = ['brass-seal-a', 'brass-seal-b', 'brass-seal-c'] as const;
export const STORY_RAIDERS = ['keeper-copperbutton-raiders', 'keeper-mossbutton-raiders'] as const;
export const STORY_GUARDIAN = 'keeper-rootbound-guardian';
export const STORY_EVIDENCE = ['ada-journal', 'ward-rubbing'] as const;
export const STORY_TALK_NPCS = ['wizard-orin-vale', 'cheesemonger-merrit', 'goblin-pip', 'witch-tansy-reed', 'warlock-vesper', 'goblin-nib', 'flirt-fenn', 'watch-garrick'] as const;
export const STORY_SUSPECTS = [
  { id: 'goblin-nib', name: 'Nib Pearlbutton', mark: 'a violet coat with a pale hem', testimony: 'I wore my violet coat while washing bowls with Tulla. Ask her; she counted every bowl. The visitor knew my greeting but not Pip’s name.' },
  { id: 'flirt-fenn', name: 'Fenn Foxglove', mark: 'a rose coat with a cream collar', testimony: 'My rose coat was at the inn all evening. Nessa made me finish the dishes. The visitor repeated a compliment but could not say who it was for.' },
  { id: 'watch-garrick', name: 'Garrick', mark: 'a brown watch coat with brass cuffs', testimony: 'My brown watch coat was on the west patrol; Iona countersigned the route. The visitor recited our watchword but forgot the return answer.' },
] as const;
export const STORY_REWARDS = {
  'wards-restored': { title: 'The wards are home', apples: 3, badge: 'keeper-of-the-small-light' },
  'keeper-rescued': { title: 'An extra chair filled', apples: 2, badge: 'friend-of-the-keeper' },
  'fair-rind': { title: 'Neighbours at the table', apples: 1, badge: 'friend-of-the-button-camps' },
  'kept-cup': { title: 'The kept cup', apples: 1, badge: 'mender-of-small-promises' },
} as const;
export type StoryMilestone = keyof typeof STORY_REWARDS;
export interface PrivateForestMystery { version: 1; culpritId: string }
export interface SharedForestStoryState {
  version: 1;
  chapter: ForestStoryChapter;
  seals: string[];
  defeated: string[];
  evidence: string[];
  interviews: string[];
  wrongAccusations: string[];
  lastAccusationAt: number;
  confirmedFace: string | null;
  sides: { fairRind: number; keptCup: number };
}
interface StoryEventBase { eventId: string; actorId: string; occurredAt: number }
export type ForestStoryEvent = StoryEventBase & (
  | { kind: 'talk'; npcId: string }
  | { kind: 'recover'; supplyId: string }
  | { kind: 'inspect'; evidenceId: string }
  | { kind: 'accuse'; suspectId: string }
  | { kind: 'rescue'; npcId: 'keeper-ada' }
  | { kind: 'encounter-defeated'; encounterId: string; defeatId: string; participantIds: string[] }
);
export interface StoryStep {
  state: SharedForestStoryState;
  status: 'updated' | 'unchanged' | 'out-of-order' | 'need-evidence' | 'wrong-accusation' | 'cooldown';
  message: string;
  milestones: StoryMilestone[];
  recap: string | null;
}
const suspectIds: readonly string[] = STORY_SUSPECTS.map(s => s.id);
const chapters: readonly string[] = ['undiscovered', 'wards', 'inquiry', 'rescue', 'complete'];
const uniqueKnown = (raw: unknown, known: readonly string[]): raw is string[] => Array.isArray(raw) && raw.length <= known.length && raw.every(v => typeof v === 'string' && known.includes(v)) && new Set(raw).size === raw.length;
export function newSharedForestStory(): SharedForestStoryState {
  return { version: 1, chapter: 'undiscovered', seals: [], defeated: [], evidence: [], interviews: [], wrongAccusations: [], lastAccusationAt: 0, confirmedFace: null, sides: { fairRind: 0, keptCup: 0 } };
}
export function restoreForestMystery(raw: unknown): PrivateForestMystery {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid private mystery');
  const m = raw as Partial<PrivateForestMystery>;
  if (m.version !== 1 || !suspectIds.includes(m.culpritId!)) throw new Error('Unsupported or invalid private mystery');
  return { version: 1, culpritId: m.culpritId! };
}
export function restoreSharedForestStory(raw: unknown): SharedForestStoryState {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid shared story');
  const s = raw as SharedForestStoryState;
  if (s.version !== 1 || !chapters.includes(s.chapter) || !uniqueKnown(s.seals, STORY_SEALS) || !uniqueKnown(s.defeated, [...STORY_RAIDERS, STORY_GUARDIAN]) ||
    !uniqueKnown(s.evidence, STORY_EVIDENCE) || !uniqueKnown(s.interviews, suspectIds) || !uniqueKnown(s.wrongAccusations, suspectIds) ||
    !Number.isSafeInteger(s.lastAccusationAt) || s.lastAccusationAt < 0 || !s.sides ||
    ![s.sides.fairRind, s.sides.keptCup].every(n => Number.isInteger(n) && n >= 0 && n <= 3) ||
    (s.confirmedFace !== null && !suspectIds.includes(s.confirmedFace))) throw new Error('Unsupported or invalid shared story');
  const stage = chapters.indexOf(s.chapter);
  if ((stage === 0 && (s.seals.length || s.defeated.length)) ||
    (stage < 2 && (s.evidence.length || s.interviews.length || s.wrongAccusations.length || s.confirmedFace)) ||
    (stage >= 2 && (s.seals.length !== 3 || STORY_RAIDERS.some(id => !s.defeated.includes(id)))) ||
    (stage < 3 && (s.confirmedFace !== null || s.defeated.includes(STORY_GUARDIAN))) ||
    (stage >= 3 && (!s.confirmedFace || s.evidence.length !== 2 || s.interviews.length !== 3)) ||
    (stage === 4 && !s.defeated.includes(STORY_GUARDIAN))) throw new Error('Inconsistent shared story stage');
  return { ...s, seals: [...s.seals], defeated: [...s.defeated], evidence: [...s.evidence], interviews: [...s.interviews], wrongAccusations: [...s.wrongAccusations], sides: { ...s.sides } };
}
export function stepSharedForestStory(raw: SharedForestStoryState, privateRaw: PrivateForestMystery, event: ForestStoryEvent): StoryStep {
  const s = restoreSharedForestStory(raw), mystery = restoreForestMystery(privateRaw);
  if (s.confirmedFace && s.confirmedFace !== mystery.culpritId) throw new Error('Mystery and revealed face disagree');
  const result: StoryStep = { state: s, status: 'unchanged', message: 'Nothing new has changed.', milestones: [], recap: null };
  const update = (text: string) => { result.status = 'updated'; result.message = text; result.recap = text; };
  const blocked = (message: string) => { result.status = 'out-of-order'; result.message = message; };
  if (event.kind === 'talk') {
    if (event.npcId === 'wizard-orin-vale') {
      if (s.chapter === 'undiscovered') { s.chapter = 'wards'; update('Orin asked the home to find Keeper Ada. Three stolen seals and two frightened raider bands stand between the camp and her trail.'); }
      else if (s.chapter === 'wards') {
        if (s.seals.length === 3 && STORY_RAIDERS.every(id => s.defeated.includes(id))) {
          s.chapter = 'inquiry'; result.milestones.push('wards-restored');
          update('Orin restored the three wards. Their light reveals a borrowed face; Ada’s journal and the ward rubbing can expose its story.');
        } else blocked('Recover all three seals and disperse both raider bands, then speak to Orin.');
      }
    }
    if (event.npcId === 'cheesemonger-merrit' && s.sides.fairRind === 0) {
      s.sides.fairRind = 1; update('Merrit wants peace with the Button camps. Ask Pip who ordered the missing supplies.');
    } else if (event.npcId === 'goblin-pip' && s.sides.fairRind === 1) {
      s.sides.fairRind = 2; update('Pip bought his cheese honestly; a borrowed voice ordered the cart away. Carry his account back to Merrit.');
    } else if (event.npcId === 'cheesemonger-merrit' && s.sides.fairRind === 2) {
      s.sides.fairRind = 3; result.milestones.push('fair-rind'); update('Merrit and Pip agreed to share a table. The village now treats the camps as neighbours.');
    }
    if (event.npcId === 'witch-tansy-reed' && s.sides.keptCup === 0) {
      s.sides.keptCup = 1; update('Tansy kept her brother’s cup. Tell Vesper that his place at her table is still waiting.');
    } else if (event.npcId === 'warlock-vesper' && s.sides.keptCup === 1) {
      s.sides.keptCup = 2; update('Vesper admitted that shame kept him away. Bring his promise to visit back to Tansy.');
    } else if (event.npcId === 'witch-tansy-reed' && s.sides.keptCup === 2) {
      s.sides.keptCup = 3; result.milestones.push('kept-cup'); update('Tansy set out two cups. Vesper’s apology now has somewhere to arrive.');
    }
    if (s.chapter === 'inquiry' && suspectIds.includes(event.npcId) && !s.interviews.includes(event.npcId)) {
      s.interviews.push(event.npcId); update(`${STORY_SUSPECTS.find(n => n.id === event.npcId)!.name} gave the home an account to compare with the ward rubbing.`);
    }
  } else if (event.kind === 'recover') {
    if (s.chapter !== 'wards') blocked('Ask Orin about the missing keeper before handling the wards.');
    else if (STORY_SEALS.includes(event.supplyId as typeof STORY_SEALS[number]) && !s.seals.includes(event.supplyId)) {
      s.seals.push(event.supplyId); update(`The home recovered a brass seal (${s.seals.length}/3). It is safe for every member now.`);
    }
  } else if (event.kind === 'encounter-defeated') {
    if (s.defeated.includes(event.encounterId)) return result;
    if ((s.chapter === 'wards' && STORY_RAIDERS.includes(event.encounterId as typeof STORY_RAIDERS[number])) ||
      (s.chapter === 'rescue' && event.encounterId === STORY_GUARDIAN)) {
      s.defeated.push(event.encounterId);
      update(event.encounterId === STORY_GUARDIAN ? 'The rootbound guardian released the refuge. Ada can finally be brought home.' : 'A raider band scattered and left the road open. Friendly camp residents are safe.');
    } else blocked('That encounter is not part of the home’s current lead.');
  } else if (event.kind === 'inspect') {
    if (s.chapter !== 'inquiry') blocked('The restored wards must reveal the keeper’s evidence first.');
    else if (STORY_EVIDENCE.includes(event.evidenceId as typeof STORY_EVIDENCE[number]) && !s.evidence.includes(event.evidenceId)) {
      s.evidence.push(event.evidenceId); update(event.evidenceId === 'ada-journal' ? 'Ada’s journal explains how to test a borrowed face: compare a visible mark with a memory its owner can explain.' : 'The ward rubbing preserved a coat and its delayed shadow. The home can now compare that mark with the witnesses.');
    }
  } else if (event.kind === 'accuse') {
    if (s.chapter !== 'inquiry' || !suspectIds.includes(event.suspectId)) blocked('There is no open accusation to make.');
    else if (s.evidence.length < 2 || s.interviews.length < 3) {
      result.status = 'need-evidence'; result.message = 'Read both clues and interview all three witnesses first. A familiar face is not enough.';
    } else if (s.wrongAccusations.includes(event.suspectId)) {
      result.message = 'That face was ruled out. Compare the coat on the ward rubbing again.';
    } else if (s.lastAccusationAt && event.occurredAt - s.lastAccusationAt < 10_000) {
      result.status = 'cooldown'; result.message = 'Take a breath and compare the evidence before trying again.';
    } else if (event.suspectId !== mystery.culpritId) {
      s.wrongAccusations.push(event.suspectId); s.lastAccusationAt = event.occurredAt;
      result.status = 'wrong-accusation'; result.message = 'The rubbing does not match that coat. Nobody is punished; your evidence is safe. Compare the witnesses again.';
      result.recap = `The home ruled out an echo wearing ${STORY_SUSPECTS.find(n => n.id === event.suspectId)!.name}’s face. No resident was blamed.`;
    } else {
      s.confirmedFace = mystery.culpritId; s.chapter = 'rescue'; s.lastAccusationAt = event.occurredAt;
      update(`The evidence exposed an echo wearing ${STORY_SUSPECTS.find(n => n.id === mystery.culpritId)!.name}’s face. The real resident is innocent. Ada’s refuge lies beyond the rootbound guardian.`);
    }
  } else if (event.kind === 'rescue') {
    if (s.chapter === 'complete') return result;
    if (s.chapter !== 'rescue' || !s.defeated.includes(STORY_GUARDIAN) || event.npcId !== 'keeper-ada') blocked('Clear the guardian’s hold on Ada’s refuge first.');
    else { s.chapter = 'complete'; result.milestones.push('keeper-rescued'); update('Keeper Ada came home. The wards hold, the roads are open, and an empty chair at the camp has its keeper again.'); }
  }
  return result;
}

const objective = (id: string, text: string, current: number, required: number): StoryObjective => ({ id, text, current, required, complete: current >= required });
export function forestStoryView(raw: SharedForestStoryState, privateRaw: PrivateForestMystery, revision: number, recap: StoryRecap[]): ForestStoryView {
  const s = restoreSharedForestStory(raw), mystery = restoreForestMystery(privateRaw);
  const stage = chapters.indexOf(s.chapter), discovered = stage > 0;
  const wardObjectives = [objective('recover-seals', 'Recover the three brass seals together', s.seals.length, 3), objective('disperse-raiders', 'Disperse the two road-blocking raider bands', STORY_RAIDERS.filter(id => s.defeated.includes(id)).length, 2), objective('return-orin', 'Return the wards to Orin', stage >= 2 ? 1 : 0, 1)];
  const inquiryObjectives = [objective('read-evidence', 'Read Ada’s journal and the ward rubbing', s.evidence.length, 2), objective('interview-witnesses', 'Interview Nib, Fenn and Garrick', s.interviews.length, 3), objective('identify-echo', 'Tell Orin which face the echo borrowed', stage >= 3 ? 1 : 0, 1)];
  const rescueObjectives = [objective('clear-root-guardian', 'Free the refuge from its rootbound guardian', s.defeated.includes(STORY_GUARDIAN) ? 1 : 0, 1), objective('bring-ada-home', 'Speak to Ada at the refuge', s.chapter === 'complete' ? 1 : 0, 1)];
  const leads: StoryLead[] = [];
  if (discovered) leads.push({ id: 'keeper-missing', title: 'The Borrowed Ward', summary: stage >= 2 ? 'The home recovered the seals and restored the wards.' : 'Follow the southern road east from Orin to the Button camps. Three brass seals lie beside their tents. Look beneath forest trees for a dropped backpack and knife; strike a hostile raider to challenge it, then step out of its marked attack circle.', status: stage >= 2 ? 'complete' : 'active', connections: stage >= 2 ? ['keeper-inquiry'] : [], npcs: [{ id: 'wizard-orin-vale', name: 'Orin Vale', contribution: 'Keeper Ada’s friend; restores the seals.' }], objectives: wardObjectives });
  if (stage >= 2) leads.push({ id: 'keeper-inquiry', title: 'A Kindness It Cannot Copy', summary: stage >= 3 ? 'Evidence exposed the borrowed face and cleared the real resident.' : 'Read the journal inside Ada’s house south of Orin, and the rubbing inside Hollow Bough at the far southeast. Compare Nib’s account at the Button camps with Fenn and Garrick in Bramblewick, then speak beside Orin. Name the borrowed face; the real neighbour is innocent.', status: stage >= 3 ? 'complete' : 'active', connections: ['keeper-missing', ...(stage >= 3 ? ['keeper-rescue'] : [])], npcs: STORY_SUSPECTS.filter(n => s.interviews.includes(n.id)).map(n => ({ id: n.id, name: n.name, contribution: 'Provided an account the home can compare with the rubbing.' })), objectives: inquiryObjectives });
  if (stage >= 3) leads.push({ id: 'keeper-rescue', title: 'The Extra Chair', summary: s.chapter === 'complete' ? 'Ada is home. The forest remembers the whole home’s help.' : 'The echo’s hold is broken. Follow the road to Hollow Bough in the far southeast; challenge the rootbound guardian and speak to Ada beyond it.', status: s.chapter === 'complete' ? 'complete' : 'active', connections: ['keeper-inquiry'], npcs: [{ id: 'keeper-ada', name: 'Keeper Ada', contribution: s.chapter === 'complete' ? 'Returned to the camp and her neighbours.' : 'Waiting at the refuge beyond the guardian.' }], objectives: rescueObjectives });
  if (s.sides.fairRind) leads.push({ id: 'a-fair-rind', title: 'Neighbours, Not Thieves', summary: s.sides.fairRind === 3 ? 'Merrit and Pip now share a table.' : s.sides.fairRind === 1 ? 'Ask Pip for his account of the missing cart.' : 'Bring Pip’s account back to Merrit.', status: s.sides.fairRind === 3 ? 'complete' : 'active', connections: [], npcs: [{ id: 'cheesemonger-merrit', name: 'Merrit Rind', contribution: 'Asked for an explanation before a feud.' }, ...(s.sides.fairRind >= 2 ? [{ id: 'goblin-pip', name: 'Pip Copperbutton', contribution: 'Explained the honest trade and the borrowed voice.' }] : [])], objectives: [objective('fair-rind-accounts', 'Carry an account between Merrit and Pip', s.sides.fairRind - 1, 2)] });
  if (s.sides.keptCup) leads.push({ id: 'reed-and-ash', title: 'The Kept Cup', summary: s.sides.keptCup === 3 ? 'Two cups wait at Tansy’s table.' : s.sides.keptCup === 1 ? 'Tell Vesper his sister kept his place.' : 'Tell Tansy that Vesper will come home.', status: s.sides.keptCup === 3 ? 'complete' : 'active', connections: [], npcs: [{ id: 'witch-tansy-reed', name: 'Tansy Reed', contribution: 'Kept a place for her estranged brother.' }, ...(s.sides.keptCup >= 2 ? [{ id: 'warlock-vesper', name: 'Vesper Ash', contribution: 'Promised to take the difficult walk home.' }] : [])], objectives: [objective('kept-cup-messages', 'Carry the siblings’ messages', s.sides.keptCup - 1, 2)] });
  return {
    revision, chapter: s.chapter, title: 'The Keeper and the Borrowed Face',
    summary: s.chapter === 'undiscovered' ? 'Stories begin with the neighbours you meet.' : s.chapter === 'wards' ? 'Find the stolen wards together; every recovered seal helps the whole home.' : s.chapter === 'inquiry' ? 'The wards remember a face. Learn enough to name the imitation fairly.' : s.chapter === 'rescue' ? 'Ada can be reached beyond the rootbound guardian.' : 'Ada is home. The camp remains open for stories, watching and company.',
    objectives: s.chapter === 'wards' ? wardObjectives : s.chapter === 'inquiry' ? inquiryObjectives : stage >= 3 ? rescueObjectives : [],
    leads,
    evidence: s.evidence.map(id => id === 'ada-journal'
      ? { id, title: 'Ada’s journal', text: 'An echo copies a visible coat but cannot explain a shared memory. The ward rubbing preserves what it wore; compare every witness before naming its disguise.', sourceNpcId: 'keeper-ada' }
      : { id, title: 'The ward rubbing', text: `The delayed shadow wore ${STORY_SUSPECTS.find(n => n.id === mystery.culpritId)!.mark}. The hem continued moving after its wearer stopped.`, sourceNpcId: 'wizard-orin-vale' }),
    suspects: stage >= 2 ? STORY_SUSPECTS.map(n => ({ id: n.id, name: n.name, ...(s.interviews.includes(n.id) ? { testimony: n.testimony } : {}), ...(s.wrongAccusations.includes(n.id) ? { accused: true } : {}) })) : [],
    recap: recap.map(entry => ({ ...entry })),
  };
}
