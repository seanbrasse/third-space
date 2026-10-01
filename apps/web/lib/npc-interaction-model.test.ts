import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_AVATAR } from '../../../packages/contracts/src';
import type { ForestNPC } from '../../../packages/contracts/src/forest-npc';
import type { NPCActionOffer } from '../../../packages/contracts/src/living-world';
import { npcConversation } from '../../../packages/config/src/npc-conversations';
import NpcInteractionPanel from '../components/NpcInteractionPanel';
import { npcInteractionUnavailable, npcOfferDetail, npcOfferUnavailable, type NPCInteractionAvailability } from './npc-interaction-model';

const offer: NPCActionOffer = { actionId: 'server-choice', npcId: 'orchard-worker-mara', kind: 'protect', label: 'Help Mara reach Bramblewick', expiresAt: 500 };
const npc: ForestNPC = { id: 'npc:orchard-worker-mara', name: 'Mara', role: 'Fruit picker', art: 'villager', avatar: { ...DEFAULT_AVATAR }, x: 56, y: 84, facing: 'down', phase: 'wander', activity: 'working', moving: false, health: 100, maxHealth: 100 };
const conversation = npcConversation({ npcId: npc.id, story: { revision: 1, chapter: 'undiscovered', title: 'Story', summary: '', objectives: [], leads: [], evidence: [], suspects: [], recap: [] }, offers: [offer] });
const available = (): NPCInteractionAvailability => ({ conversation, npc, inRange: true, playerAlive: true, connected: true, serverTime: 100, pendingActionId: null });

describe('nonblocking NPC choices', () => {
  it('disables choices after leaving range, changing NPC, death, disconnect, or NPC recovery', () => {
    expect(npcInteractionUnavailable(available())).toBeNull();
    expect(npcOfferUnavailable(offer, { ...available(), inRange: false })).toMatch(/closer/);
    expect(npcOfferUnavailable(offer, { ...available(), npc: null })).toMatch(/no longer here/);
    expect(npcOfferUnavailable(offer, { ...available(), npc: { ...npc, id: 'npc:goblin-pip' } })).toMatch(/no longer here/);
    expect(npcOfferUnavailable(offer, { ...available(), playerAlive: false })).toMatch(/recovering/);
    expect(npcOfferUnavailable(offer, { ...available(), connected: false })).toMatch(/Reconnecting/);
    expect(npcOfferUnavailable(offer, { ...available(), npc: { ...npc, phase: 'respawning' } })).toMatch(/neighbour is recovering/);
    expect(npcOfferUnavailable(offer, { ...available(), npc: { ...npc, health: 0 } })).toMatch(/neighbour is recovering/);
  });

  it('blocks duplicate submissions, stale offers and expired capabilities with explicit feedback', () => {
    expect(npcOfferUnavailable(offer, available())).toBeNull();
    expect(npcOfferUnavailable(offer, { ...available(), pendingActionId: offer.actionId })).toMatch(/confirm/);
    expect(npcOfferUnavailable(offer, { ...available(), serverTime: 500 })).toMatch(/expired/);
    expect(npcOfferUnavailable({ ...offer, actionId: 'old-choice' }, available())).toMatch(/changed/);
    expect(npcOfferUnavailable({ ...offer, npcId: 'wizard-orin-vale' }, available())).toMatch(/changed/);
    expect(npcOfferUnavailable({ ...offer, disabledReason: 'The road is not safe yet.' }, available())).toBe('The road is not safe yet.');
  });

  it('renders server costs without deriving local prices or affordability', () => {
    expect(npcOfferDetail({ ...offer, kind: 'trade', appleCost: 9 })).toBe('9 apples from your inventory');
    expect(npcOfferDetail({ ...offer, kind: 'give', appleCost: 1 })).toBe('1 apple from your inventory');
    expect(npcOfferDetail({ ...offer, kind: 'trade' })).toBeNull();
    expect(npcOfferDetail({ ...offer, kind: 'claim-reward' })).toContain('personal reward');
  });

  it('renders help as an accessible nonmodal region without autofocus or executing a choice', () => {
    const onAction = vi.fn();
    const html = renderToStaticMarkup(createElement(NpcInteractionPanel, { ...available(), open: true, mode: 'help', onAction, onClose: vi.fn(), onOpenJournal: vi.fn() }));
    expect(html).toContain('role="region"');
    expect(html).toContain('Help Mara reach Bramblewick');
    expect(html).toContain('Not now');
    expect(html).toContain('help, dismiss, or keep moving');
    expect(html).toContain('role="status"');
    expect(html).not.toMatch(/<dialog|aria-modal|autofocus|tabindex="-1"/i);
    expect(onAction).not.toHaveBeenCalled();
  });

  it('exposes pending and stale action feedback while leaving dismiss available', () => {
    const html = renderToStaticMarkup(createElement(NpcInteractionPanel, { ...available(), open: true, pendingActionId: offer.actionId, onAction: vi.fn(), onClose: vi.fn() }));
    expect(html).toContain('Confirming…');
    expect(html).toContain('disabled=""');
    expect(html).toMatch(/<button[^>]+aria-label="Close conversation"/);
    const outOfRange = renderToStaticMarkup(createElement(NpcInteractionPanel, { ...available(), open: true, inRange: false, onAction: vi.fn(), onClose: vi.fn() }));
    expect(outOfRange).toContain('Walk closer');
  });

  it('labels this neighbour’s trust separately from home reputation', () => {
    const personalConversation = { ...conversation, personalTrust: 34,
      relationship: { npcId: 'orchard-worker-mara', trust: -12, fear: 0, fearThreshold: 70, afraid: false, fearExpiresAt: 0, giftReadyAt: 0 },
    };
    const html = renderToStaticMarkup(createElement(NpcInteractionPanel, { ...available(), conversation: personalConversation, open: true, onAction: vi.fn(), onClose: vi.fn() }));
    expect(html).toContain('Their trust in you: -12');
    expect(html).toContain('Your reputation in this home: 34');
    const invalid = { ...personalConversation, personalTrust: Infinity, relationship: { ...personalConversation.relationship, trust: NaN } };
    const invalidHtml = renderToStaticMarkup(createElement(NpcInteractionPanel, { ...available(), conversation: invalid, open: true, onAction: vi.fn(), onClose: vi.fn() }));
    expect(invalidHtml).not.toMatch(/Their trust in you|Your reputation in this home|NaN|Infinity/);
  });
});
