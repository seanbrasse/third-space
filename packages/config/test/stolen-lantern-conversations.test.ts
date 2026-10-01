import { describe, expect, it } from 'vitest';
import type { StolenLanternSnapshot, StolenLanternStage } from '../../contracts/src/stolen-lantern';
import type { NPCConversationView } from '../src/npc-conversations';
import { extendStolenLanternConversation } from '../src/stolen-lantern-conversations';
import { STOLEN_LANTERN_RECIPIENTS } from '../src/stolen-lantern';
import { LANTERN_CAVE, LANTERN_CAVE_ANCHOR, LANTERN_CAVE_DOOR } from '../src/lantern-cave';

const ELSIE = 'washer-elsie', PIP = 'goblin-pip', LUMEN = 'spirit-lumen', MORROW = 'spirit-morrow';
const base = (npcId: string): NPCConversationView => ({
  npcId, name: npcId === ELSIE ? 'Elsie' : npcId === PIP ? 'Pip' : npcId === LUMEN ? 'Lumen' : 'Neighbour', role: 'Neighbour',
  text: 'A current keeper contribution.', contribution: 'A current keeper contribution.',
  lead: { id: 'keeper-inquiry', title: 'Read Ada’s journal', text: 'A keeper step.', location: 'Ada’s house' },
  journal: { tab: 'evidence', label: 'Open Evidence' }, personalNote: 'Shared discoveries; personal rewards.',
  offers: [{ actionId: 'existing-server-offer', npcId: npcId.replace(/^npc:/, ''), kind: 'talk', label: 'Talk', expiresAt: 110_000 }],
});
const snapshot = (stage: StolenLanternStage = 'quiet'): StolenLanternSnapshot => ({
  serverTime: 100_000,
  quest: { revision: 1, stage, title: 'The Stolen Lantern', objective: '', location: '', custody: stage === 'return-lantern' ? 'home' : stage === 'complete' ? 'returned' : 'missing' },
  personal: { revision: 1, inventory: { apples: 4, revision: 2 }, wardUntil: 0, wardReadyAt: 0, snareUntil: 0, incidents: [], reward: 'unavailable' },
});
const presented = (npcId: string, view: StolenLanternSnapshot) => extendStolenLanternConversation(base(npcId), view);
const action = (view: NPCConversationView, name: string) => view.offers.find(offer => offer.actionId === `stolen:${name}`);
const harm = (npcId: string) => ({ npcId, reason: 'Attacked this neighbour.', at: 1, resolvedAt: 0 });

describe('Stolen Lantern conversation extension', () => {
  it('leaves unrelated residents and their keeper or side lead unchanged', () => {
    for (const npcId of ['wizard-orin-vale', 'orchard-worker-mara', 'queen-elowen', 'cheesemonger-merrit']) {
      const original = base(npcId);
      for (const stage of ['quiet', 'ask-pip', 'find-cave', 'return-lantern', 'complete'] as const)
        expect(extendStolenLanternConversation(original, snapshot(stage))).toBe(original);
    }
  });

  it('offers Elsie’s actual first step without revealing the cave or adding recovery elsewhere', () => {
    const view = snapshot();
    expect(action(presented(ELSIE, view), 'begin')?.label).toBe('Ask about the missing lantern');
    expect(presented(ELSIE, view).lead?.location).toContain('(99, 68)');
    for (const id of [ELSIE, PIP, LUMEN, MORROW]) {
      expect(JSON.stringify(presented(id, view))).not.toMatch(/Lantern Cave|Lantern Hollow|64, 81.5|9, 5.5|stolen:recover|stolen:ask-pip/);
    }
    const pip = presented(PIP, view);
    expect(pip.lead).toEqual(base(PIP).lead);
    expect(pip.journal).toEqual(base(PIP).journal);
  });

  it('advances the displayed route through Pip, cave and Elsie using the shared stage', () => {
    const ask = presented(PIP, snapshot('ask-pip'));
    expect(action(ask, 'ask-pip')?.disabledReason).toBeUndefined();
    expect(ask.lead?.location).toContain('(72, 95)');
    expect(JSON.stringify(ask)).not.toMatch(/Lantern Cave|Lantern Hollow/);
    const cave = presented(PIP, snapshot('find-cave'));
    expect(cave.lead?.location).toContain('(64, 81.5)');
    expect(cave.lead?.text).toContain('recovery point');
    expect(action(cave, 'ask-pip')).toBeUndefined();
    const returned = presented(ELSIE, snapshot('return-lantern'));
    expect(action(returned, 'return')).toMatchObject({ npcId: ELSIE, kind: 'give' });
    expect(action(returned, 'return')?.appleCost).toBeUndefined();
    expect(returned.lead?.location).toContain('(99, 68)');
  });

  it('directs recovery inside the configured cave at its plinth, never at the exterior doorway', () => {
    expect(LANTERN_CAVE_DOOR.buildingId).toBe('living:lantern-cave');
    for (const npcId of [ELSIE, PIP, LUMEN, MORROW]) {
      const result = presented(npcId, snapshot('find-cave'));
      expect(result.lead?.text).toContain('Enter Lantern Cave');
      expect(result.lead?.text).toContain(`Inside ${LANTERN_CAVE.name}, approach the lantern plinth`);
      expect(result.lead?.location).toContain(`(${LANTERN_CAVE_DOOR.point.x}, ${LANTERN_CAVE_DOOR.point.y})`);
      expect(result.lead?.location).toContain(`inside ${LANTERN_CAVE.name} (${LANTERN_CAVE_ANCHOR.x}, ${LANTERN_CAVE_ANCHOR.y})`);
      expect(JSON.stringify(result)).not.toMatch(/Shadow Cave|recovery point at its entrance|At the cave entrance, use/);
      expect(action(result, 'recover')).toBeUndefined();
    }
    for (const npcId of [ELSIE, PIP]) {
      const { text } = presented(npcId, snapshot('find-cave'));
      expect(text).toMatch(/enter Lantern Cave/i);
      expect(text).toContain('approach the lantern plinth');
      expect(text).toContain(LANTERN_CAVE.name);
    }
  });

  it('describes the recovered lantern as shared home custody, never a personal slot or entitlement', () => {
    const view = snapshot('return-lantern');
    view.quest.recoveredBy = 'OTHER_MEMBER_PRIVATE_ID';
    const result = presented(ELSIE, view);
    expect(result.personalNote).toContain('Shared quest item · recovered for your home');
    expect(result.personalNote).toContain('does not occupy a personal hotbar slot');
    expect(JSON.stringify(result)).not.toContain('OTHER_MEMBER_PRIVATE_ID');
    expect(action(result, 'claim')).toBeUndefined();
    expect(presented(ELSIE, snapshot('complete')).personalNote).not.toContain('recovered for your home');
  });

  it('makes a pending 2-apple thank-you claimable only at Elsie and keeps it pending when full', () => {
    const view = snapshot('complete');
    view.personal.reward = 'pending';
    view.personal.inventory.apples = 5;
    const result = presented(ELSIE, view);
    expect(action(result, 'claim')).toMatchObject({ npcId: ELSIE, kind: 'claim-reward', label: 'Collect your thank-you · 2 apples' });
    expect(result.personalNote).toContain('If your inventory is full, the reward remains available');
    expect(view.personal.reward).toBe('pending');
    for (const id of [PIP, LUMEN, MORROW]) expect(action(presented(id, view), 'claim')).toBeUndefined();
    for (const status of ['claimed', 'unavailable'] as const) {
      view.personal.reward = status;
      expect(action(presented(ELSIE, view), 'claim')).toBeUndefined();
    }
  });

  it('offers Lumen’s ward independently, with the server cooldown and current snare explained', () => {
    const view = snapshot();
    view.personal.snareUntil = view.serverTime + 5_000;
    let result = presented(LUMEN, view);
    expect(action(result, 'ward')?.disabledReason).toBeUndefined();
    expect(result.text).toContain('lasts 20 seconds');
    expect(result.text).toContain('clears Morrow’s current snare');
    expect(result.text).toContain('60 seconds');
    expect(result.text).toContain('(55, 82)');
    expect(result.personalNote).toContain('snare lasts 5 more seconds');
    view.personal.wardReadyAt = view.serverTime + 59_001;
    view.personal.wardUntil = view.serverTime + 19_000;
    result = presented(LUMEN, view);
    expect(action(result, 'ward')?.disabledReason).toContain('in 60 seconds');
    expect(result.personalNote).toContain('protects you for 19 more seconds');
    view.serverTime = view.personal.wardReadyAt;
    expect(action(presented(LUMEN, view), 'ward')?.disabledReason).toBeUndefined();
  });

  it('clearly labels Morrow’s misleading role while keeping the actual discovered objective correct', () => {
    for (const stage of ['ask-pip', 'find-cave', 'return-lantern', 'complete'] as const) {
      const result = presented(MORROW, snapshot(stage));
      expect(result.text).toContain('hostile spirit');
      expect(result.text).toContain('from the pond');
      expect(result.text).toContain('pulses can snare');
      expect(result.text).toContain('Follow the recorded lead, not his advice');
      expect(result.lead).toEqual(stage === 'complete' ? base(MORROW).lead : presented(ELSIE, snapshot(stage)).lead);
      expect(result.offers.some(offer => offer.actionId.startsWith('stolen:'))).toBe(false);
    }
  });

  it('restores current keeper and Fair Rind guidance after completion while keeping personal services', () => {
    for (const npcId of [PIP, LUMEN, MORROW]) {
      for (const leadId of ['keeper-inquiry', 'a-fair-rind']) {
        const original = base(npcId);
        original.lead = { id: leadId, title: 'Still active', text: 'Follow this current lead.', location: 'The discovered destination' };
        original.journal = { tab: leadId === 'keeper-inquiry' ? 'people' : 'leads', label: 'Current journal action' };
        for (const reward of ['pending', 'claimed', 'unavailable'] as const) {
          const view = snapshot('complete');
          view.personal.reward = reward;
          const result = extendStolenLanternConversation(original, view);
          expect(result.lead).toEqual(original.lead);
          expect(result.journal).toEqual(original.journal);
          expect(action(result, 'ask-pip')).toBeUndefined();
          expect(action(result, 'claim')).toBeUndefined();
          if (npcId === PIP) {
            expect(result.text).toBe(original.text);
            expect(result.contribution).toBe(original.contribution);
          }
          if (npcId === LUMEN) expect(action(result, 'ward')).toBeDefined();
        }
      }
    }
    const view = snapshot('complete');
    view.personal.reward = 'pending';
    const elsie = presented(ELSIE, view);
    expect(elsie.lead?.id).toBe('stolen-lantern');
    expect(elsie.lead?.location).toContain('Elsie at Reed pond');
    expect(action(elsie, 'claim')).toBeDefined();
    expect(elsie.personalNote).toContain('thank-you is pending at Elsie');
  });

  it('keeps enduring distrust personal to the harmed neighbour and exposes explicit restitution', () => {
    for (const [npcId, stage, next] of [[ELSIE, 'quiet', 'begin'], [PIP, 'ask-pip', 'ask-pip'], [LUMEN, 'quiet', 'ward']] as const) {
      const view = snapshot(stage);
      view.personal.incidents = [harm(npcId)];
      view.serverTime = 9_000_000;
      const result = presented(npcId, view);
      expect(action(result, next)?.disabledReason).toContain('remembers your harm');
      expect(action(result, 'restitute')).toMatchObject({ npcId, kind: 'give', appleCost: 2 });
      expect(action(result, 'restitute')?.disabledReason).toBeUndefined();
      expect(result.personalNote).toContain('distrust endures');
      expect(result.personalNote).toContain('Ordinary gifts do not settle this incident');
      const otherId = npcId === LUMEN ? ELSIE : LUMEN;
      expect(action(presented(otherId, view), 'restitute')).toBeUndefined();
    }
  });

  it('gates Elsie’s return and reward after harm, and removes the incident gate after restitution', () => {
    for (const [stage, next] of [['return-lantern', 'return'], ['complete', 'claim']] as const) {
      const view = snapshot(stage);
      view.personal.reward = 'pending';
      view.personal.incidents = [harm(ELSIE)];
      view.personal.inventory.apples = 1;
      expect(action(presented(ELSIE, view), 'restitute')?.disabledReason).toContain('needs 2 apples');
      expect(action(presented(ELSIE, view), next)?.disabledReason).toContain('restitution');
      view.personal.incidents[0]!.resolvedAt = view.serverTime;
      expect(action(presented(ELSIE, view), next)?.disabledReason).toBeUndefined();
      expect(action(presented(ELSIE, view), 'restitute')).toBeUndefined();
    }
  });

  it('emits only the bounded fixed catalog selectors at the correct canonical NPC, never recover', () => {
    for (const stage of ['quiet', 'ask-pip', 'find-cave', 'return-lantern', 'complete'] as const) {
      const view = snapshot(stage);
      view.personal.reward = 'pending';
      view.personal.incidents = [harm(ELSIE), harm(PIP), harm(LUMEN)];
      for (const id of [ELSIE, PIP, LUMEN, MORROW]) {
        for (const offer of presented(`npc:${id}`, view).offers.filter(o => o.actionId.startsWith('stolen:'))) {
          const name = offer.actionId.slice('stolen:'.length) as keyof typeof STOLEN_LANTERN_RECIPIENTS;
          expect(STOLEN_LANTERN_RECIPIENTS[name]).toContain(id);
          expect(offer.npcId).toBe(id);
          expect(offer.expiresAt).toBe(view.serverTime + 60_000);
          expect(['talk', 'give', 'claim-reward']).toContain(offer.kind);
          expect(name).not.toBe('recover');
        }
      }
    }
  });

  it('does not mutate base offers, incidents, inventory, or quest state', () => {
    const original = base(ELSIE), view = snapshot('return-lantern');
    original.offers.push({ actionId: 'stolen:begin', npcId: ELSIE, kind: 'talk', label: 'Old stage', expiresAt: 99_000 });
    view.personal.incidents.push(harm(PIP));
    const before = JSON.stringify({ original, view });
    const result = extendStolenLanternConversation(original, view);
    expect(JSON.stringify({ original, view })).toBe(before);
    expect(action(result, 'begin')).toBeUndefined();
    expect(result.offers.find(offer => offer.actionId === 'existing-server-offer')).toEqual(original.offers[0]);
    expect(result.offers.find(offer => offer.actionId === 'existing-server-offer')).not.toBe(original.offers[0]);
    expect(JSON.stringify(result)).not.toContain('Attacked this neighbour');
  });

  it('never renders nonfinite timers or emits an unbounded action expiry', () => {
    const view = snapshot();
    view.personal.wardUntil = Infinity;
    view.personal.snareUntil = Infinity;
    view.personal.wardReadyAt = NaN;
    expect(JSON.stringify(presented(LUMEN, view))).not.toMatch(/Infinity|NaN/);
    expect(action(presented(LUMEN, view), 'ward')?.disabledReason).toContain('refresh');
    view.serverTime = Infinity;
    const offer = action(presented(LUMEN, view), 'ward');
    expect(offer?.expiresAt).toBe(0);
    expect(offer?.disabledReason).toContain('Reconnect');
  });
});
