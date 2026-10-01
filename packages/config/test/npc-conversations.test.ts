import { describe, expect, it } from 'vitest';
import type { ForestStoryView, StoryLead } from '../../contracts/src/forest-story';
import type { LanternRoadView, NPCActionOffer } from '../../contracts/src/living-world';
import { AUTHORED_FOREST_NPCS } from '../src/forest-cast';
import { NPC_CONVERSATION_NEIGHBOURS, npcConversation } from '../src/npc-conversations';

const story = (patch: Partial<ForestStoryView> = {}): ForestStoryView => ({ revision: 1, chapter: 'undiscovered', title: 'Shared story', summary: '', objectives: [], leads: [], evidence: [], suspects: [], recap: [], ...patch });
const objective = (id: string, complete: boolean) => ({ id, text: id, complete, current: complete ? 1 : 0, required: 1 });
const side = (id: string, npcId: string, current = 0): StoryLead => ({ id, title: id, summary: 'A discovered request.', status: 'active', connections: [], npcs: [{ id: npcId, name: npcId, contribution: 'A known account.' }], objectives: [{ id: id === 'a-fair-rind' ? 'fair-rind-accounts' : 'kept-cup-messages', text: 'Carry the message', current, required: 2, complete: false }] });
const rescue = (discovered: boolean): LanternRoadView => ({ id: 'lantern-road', incidentId: 'lantern-road-v1', npcId: 'orchard-worker-mara', title: 'Lantern Road', revision: 1, stage: 'endangered', discovered, summary: 'Mara needs help.', objective: 'Protect Mara, then escort her to Bramblewick.', recoveryAt: 0, retryAt: 0, setbacks: 0 });

describe('current, discovered NPC conversation guidance', () => {
  it('gives each of the 18 existing important neighbours a contribution and a concrete keeper route', () => {
    expect(AUTHORED_FOREST_NPCS).toHaveLength(18);
    for (const npc of AUTHORED_FOREST_NPCS) {
      expect(NPC_CONVERSATION_NEIGHBOURS[npc.id], npc.id).toBeDefined();
      const result = npcConversation({ npcId: `npc:${npc.id}`, story: story({ chapter: 'wards' }) });
      expect(result.contribution.length, npc.id).toBeGreaterThan(20);
      expect(result.lead?.id, npc.id).toBe('keeper-missing');
      expect(result.lead?.location, npc.id).toMatch(/Button camps/);
      expect(result.journal?.tab).toBe('leads');
    }
  });

  it('does not turn unimplemented cast hooks or future mystery clues into objectives', () => {
    for (const npc of AUTHORED_FOREST_NPCS) {
      const result = npcConversation({ npcId: npc.id, story: story() });
      expect(result.lead?.id).toBe('meet-orin');
      expect(JSON.stringify(result)).not.toMatch(/ward rubbing|borrowed face|guardian|royal-repairs|bark-ledger|court-of-small-promises|fish invoice/i);
    }
  });

  it('updates the ward instruction as the shared gate changes, rather than replaying the old bubble', () => {
    const view = story({ chapter: 'wards', objectives: [objective('recover-seals', true), objective('disperse-raiders', false)] });
    expect(npcConversation({ npcId: 'wizard-orin-vale', story: view }).lead?.title).toBe('Open the camp road');
    view.objectives[1]!.complete = true;
    expect(npcConversation({ npcId: 'wizard-orin-vale', story: view }).lead?.title).toBe('Return the wards');
    view.chapter = 'inquiry';
    expect(npcConversation({ npcId: 'wizard-orin-vale', story: view }).lead?.title).toBe('Read Ada’s journal');
  });

  it('only offers the People comparison when the exact public clues and all three accounts exist', () => {
    const view = story({ chapter: 'inquiry', evidence: [{ id: 'ada-journal', title: 'Journal', text: 'Public journal.' }], suspects: ['goblin-nib', 'flirt-fenn', 'watch-garrick'].map(id => ({ id, name: id, testimony: 'My recorded account.' })) });
    const result = () => npcConversation({ npcId: 'wizard-orin-vale', story: view });
    expect(result().lead?.title).toBe('Read the ward rubbing');
    view.evidence.push({ id: 'unrelated-clue', title: 'A side clue', text: 'Not the rubbing.' });
    expect(result().lead?.title).toBe('Read the ward rubbing');
    view.evidence.push({ id: 'ward-rubbing', title: 'Rubbing', text: 'Discovered mark.' });
    view.suspects[1]!.testimony = ' ';
    expect(result().lead?.location).toContain('inn');
    view.suspects[1]!.testimony = 'My recorded account.';
    expect(result().journal).toEqual({ tab: 'people', label: 'Compare the evidence · People' });
    expect(result().lead?.text).toContain('ordinary conversation alone does not name a face');
    view.chapter = 'rescue';
    expect(result().journal?.tab).toBe('leads');
    expect(result().lead?.title).toBe('Reach Ada’s refuge');
  });

  it('shows only a recorded witness account, without importing authored revelations', () => {
    const view = story({ chapter: 'inquiry', suspects: [{ id: 'goblin-nib', name: 'Nib', testimony: 'A public account from this world.' }] });
    expect(npcConversation({ npcId: 'goblin-nib', story: view }).text).toBe('A public account from this world.');
    view.chapter = 'undiscovered';
    expect(npcConversation({ npcId: 'goblin-nib', story: view }).text).not.toBe('A public account from this world.');
  });

  it('locates both flexible side-story targets before the keeper is discovered, then locates the return', () => {
    const view = story({ leads: [side('a-fair-rind', 'cheesemonger-merrit'), side('reed-and-ash', 'witch-tansy-reed')] });
    const rind = npcConversation({ npcId: 'cheesemonger-merrit', story: view });
    expect(rind.lead?.text).toContain('Copperbutton camp');
    expect(rind.lead?.location).toContain('southeast');
    const cup = npcConversation({ npcId: 'witch-tansy-reed', story: view });
    expect(cup.lead?.text).toContain('Vesper');
    expect(cup.lead?.location).toContain('far southeast');
    view.leads[0]!.objectives[0]!.current = 1;
    view.leads[1]!.objectives[0]!.current = 1;
    expect(npcConversation({ npcId: 'goblin-pip', story: view }).lead?.location).toContain('cheese shop');
    expect(npcConversation({ npcId: 'warlock-vesper', story: view }).lead?.location).toContain('Reed Cottage');
    view.leads[0]!.status = 'complete';
    expect(npcConversation({ npcId: 'goblin-pip', story: view }).lead?.id).toBe('meet-orin');
  });

  it('keeps Orin on the current keeper chapter when a side story is also active', () => {
    const view = story({ chapter: 'rescue', leads: [side('a-fair-rind', 'cheesemonger-merrit')], objectives: [objective('clear-root-guardian', true)] });
    expect(npcConversation({ npcId: 'wizard-orin-vale', story: view }).lead?.title).toBe('Bring Ada home');
    expect(npcConversation({ npcId: 'cheesemonger-merrit', story: view }).lead?.id).toBe('a-fair-rind');
  });

  it('uses Lantern Road only once discovered and never changes the keeper gate', () => {
    const view = story({ chapter: 'wards' });
    expect(npcConversation({ npcId: 'orchard-worker-mara', story: view, rescue: rescue(false) }).lead?.id).toBe('keeper-missing');
    for (const npcId of ['orchard-worker-mara', 'washer-elsie', 'woodworker-bram', 'spirit-lumen', 'spirit-morrow']) {
      expect(npcConversation({ npcId, story: view, rescue: rescue(true) }).lead?.id).toBe('lantern-road');
    }
    expect(npcConversation({ npcId: 'wizard-orin-vale', story: view, rescue: rescue(true) }).lead?.id).toBe('keeper-missing');
    expect(view.chapter).toBe('wards');
  });

  it('passes only matching recipient offers and relationships, preserving server prices and story access', () => {
    const offer: NPCActionOffer = { actionId: 'opaque', npcId: 'witch-tansy-reed', kind: 'trade', label: 'Buy speed potion', expiresAt: 50, appleCost: 7 };
    const relationship = { npcId: 'witch-tansy-reed', trust: -24, fear: 80, fearThreshold: 70, afraid: true, fearExpiresAt: 100, giftReadyAt: 0 };
    const result = npcConversation({ npcId: 'npc:witch-tansy-reed', story: story({ chapter: 'wards' }), offers: [offer, { ...offer, actionId: 'wrong-recipient-npc', npcId: 'goblin-pip' }], relationship });
    expect(result.offers).toEqual([offer]);
    expect(result.offers[0]).not.toBe(offer);
    expect(result.relationship).toEqual(relationship);
    expect(result.personalNote).toContain('story stays available');
    expect(result.lead?.id).toBe('keeper-missing');
    const unrelated = npcConversation({ npcId: 'goblin-pip', story: story(), relationship });
    expect(unrelated.relationship).toBeUndefined();
  });

  it('does not copy extra private fields into the public presentation', () => {
    const input = { npcId: 'wizard-orin-vale', story: story(), trust: 17, privateMystery: { culpritId: 'SECRET_SENTINEL' }, otherMembers: ['PRIVATE_MEMBER'],
      offers: [{ actionId: 'opaque', npcId: 'wizard-orin-vale', kind: 'talk' as const, label: 'Talk', expiresAt: 50, privateNonce: 'PRIVATE_NONCE' }],
      relationship: { npcId: 'wizard-orin-vale', trust: 9, fear: 0, fearThreshold: 70, afraid: false, fearExpiresAt: 0, giftReadyAt: 0, memberId: 'PRIVATE_MEMBER' },
    };
    expect(JSON.stringify(npcConversation(input))).not.toMatch(/SECRET_SENTINEL|PRIVATE_MEMBER|PRIVATE_NONCE|culprit/);
    expect(npcConversation(input).personalTrust).toBe(17);
    expect(npcConversation(input).relationship?.trust).toBe(9);
    const view = story({ chapter: 'complete' });
    expect(npcConversation({ npcId: 'queen-elowen', story: view }).lead?.text).toContain('personal keepsakes');
  });

  it('bounds displayed trust without inventing a score for nonfinite server data', () => {
    const relationship = { npcId: 'witch-tansy-reed', trust: 1000, fear: 0, fearThreshold: 70, afraid: false, fearExpiresAt: 0, giftReadyAt: 0 };
    const input = { npcId: 'witch-tansy-reed', story: story(), trust: -1000, relationship };
    expect(npcConversation(input).relationship?.trust).toBe(100);
    expect(npcConversation(input).personalTrust).toBe(-100);
    expect(relationship.trust).toBe(1000);
    for (const trust of [NaN, Infinity, -Infinity]) {
      expect(npcConversation({ ...input, trust, relationship: { ...relationship, trust } }).personalTrust).toBeUndefined();
      expect(npcConversation({ ...input, trust, relationship: { ...relationship, trust } }).relationship).toBeUndefined();
    }
  });
});
