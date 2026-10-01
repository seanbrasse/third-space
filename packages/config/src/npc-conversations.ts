import type { ForestStoryView, StoryLead } from '../../contracts/src/forest-story';
import type { LanternRoadView, NPCActionOffer, NPCRelationshipView } from '../../contracts/src/living-world';

export type NPCJournalTab = 'leads' | 'evidence' | 'people' | 'recap';
export interface NPCConversationLead {
  id: string;
  title: string;
  text: string;
  location: string;
}
/** Recipient-only presentation. Build AFTER applying the player's trusted talk
 * event. Never put this personal conversation into the room's NPC bubble. */
export interface NPCConversationView {
  npcId: string;
  name: string;
  role: string;
  contribution: string;
  text: string;
  lead?: NPCConversationLead;
  journal?: { tab: NPCJournalTab; label: string };
  offers: NPCActionOffer[];
  relationship?: NPCRelationshipView;
  personalTrust?: number;
  personalNote: string;
}
export interface NPCConversationContext {
  npcId: string;
  npcName?: string;
  story: ForestStoryView;
  offers?: readonly NPCActionOffer[];
  relationship?: NPCRelationshipView;
  trust?: number;
  rescue?: LanternRoadView;
}

interface Neighbour { name: string; role: string; contribution: string; location: string }
/** Only ordinary identities and places. Quest hooks, authored revelations and
 * ambient dialogue are intentionally absent: they are not playable objectives. */
export const NPC_CONVERSATION_NEIGHBOURS: Readonly<Record<string, Neighbour>> = {
  'wizard-orin-vale': { name: 'Orin Vale', role: 'Keeper’s friend', contribution: 'I restore the wards and help the home compare what it has learned.', location: 'Lantern Orchard, west end of the southern road' },
  'queen-elowen': { name: 'Queen Elowen', role: 'Queen of Crownwatch', contribution: 'Our help belongs to the whole village. I can point you toward the work the home has discovered.', location: 'Crownwatch courtyard, northeast of Bramblewick' },
  'king-rowan': { name: 'King Rowan', role: 'Orchard keeper and king', contribution: 'A useful promise has a next step. Let us keep the home’s work moving.', location: 'Crownwatch courtyard, northeast of Bramblewick' },
  'guard-iona': { name: 'Iona', role: 'Castle guard', contribution: 'Keep to recorded accounts. A familiar face alone is no reason to hurt a neighbour.', location: 'Crownwatch courtyard patrol' },
  'watch-garrick': { name: 'Garrick', role: 'Town watch', contribution: 'I keep the Bramblewick road open and give my account when the home needs it.', location: 'Bramblewick’s north–south main road' },
  'cat-juniper': { name: 'Juniper Claw', role: 'Courier', contribution: 'A message is useful when you know which doorstep comes next. Here is the current route.', location: 'Bramblewick square' },
  'witch-tansy-reed': { name: 'Tansy Reed', role: 'Reed witch', contribution: 'Practical help first. My available remedies and the home’s current lead are below.', location: 'Reed Cottage, south of Bramblewick beside the pond' },
  'warlock-vesper': { name: 'Vesper Ash', role: 'Hollow Bough neighbour', contribution: 'I live beside Hollow Bough. Bring me the words you have actually heard.', location: 'Hollow Bough, at the far southeast of the forest' },
  'cheesemonger-merrit': { name: 'Merrit Rind', role: 'Cheesemonger', contribution: 'I would rather hear a neighbour’s account than start a feud.', location: 'Eastern side of Bramblewick square, outside the cheese shop' },
  'innkeeper-nessa': { name: 'Nessa Hearth', role: 'Innkeeper', contribution: 'There is room at the table. Fenn is nearby if the home needs his account.', location: 'Western side of Bramblewick square, outside the inn' },
  'peasant-pell': { name: 'Pell Morrow', role: 'Mender', contribution: 'Lark and I work at the south end of town. I can help you follow the home’s recorded lead.', location: 'Southwestern edge of Bramblewick' },
  'peasant-lark': { name: 'Lark Morrow', role: 'Mapmaker', contribution: 'A good direction names the place and the next thing to do there. Let us start with that.', location: 'Southern edge of Bramblewick' },
  'knight-ser-calder': { name: 'Ser Calder', role: 'Road protector', contribution: 'Challenge a hostile raider when the road calls for it. The camp residents are our neighbours.', location: 'Western entrance to Crownwatch' },
  'flirt-fenn': { name: 'Fenn Foxglove', role: 'Inn poet', contribution: 'If the home needs my account, it deserves the plain version.', location: 'Bramblewick, just south of the square near the inn' },
  'ogre-brindle': { name: 'Brindle', role: 'Orchard gardener', contribution: 'Orin is west of my garden. We help people get home, one road at a time.', location: 'Lantern Orchard, east of Orin' },
  'goblin-pip': { name: 'Pip Copperbutton', role: 'Camp cook', contribution: 'I can speak for my own trade. You can carry an honest account between neighbours.', location: 'Copperbutton camp, southeast along the road from Orin' },
  'goblin-tulla': { name: 'Tulla Mossbutton', role: 'Camp keeper', contribution: 'The Button camps are people’s homes. Use the shared journal to keep the current task straight.', location: 'Mossbutton camp, east along the southern road from Orin' },
  'goblin-nib': { name: 'Nib Pearlbutton', role: 'Camp storyteller', contribution: 'I can give my own account. The short, true version belongs in the shared journal.', location: 'Pearlbutton camp, south of Mossbutton and southeast of Orin' },
  'keeper-ada': { name: 'Keeper Ada', role: 'Forest keeper', contribution: 'A forest is kept by the people who help each other come home.', location: 'The refuge beyond Hollow Bough’s guardian' },
  'orchard-worker-mara': { name: 'Mara', role: 'Fruit picker', contribution: 'I carry fruit from Lantern Orchard to Bramblewick.', location: 'Lantern Orchard road, between the orchard and Bramblewick' },
  'washer-elsie': { name: 'Elsie Reed', role: 'Pond washer', contribution: 'Mara’s road joins our village. Help on that road matters to the people waiting here.', location: 'The pond south of Bramblewick' },
  'woodworker-bram': { name: 'Bram', role: 'Woodworker', contribution: 'I work at the south end of Bramblewick, where the orchard road arrives.', location: 'Southern edge of Bramblewick, near Pell and Lark' },
  'spirit-lumen': { name: 'Lumen', role: 'Lantern spirit', contribution: 'A small light can show the next safe step. Follow the lead your home has found.', location: 'Lantern Orchard road' },
  'spirit-morrow': { name: 'Morrow', role: 'Whispering spirit', contribution: 'My whispers are no witness account. Let the home’s discovered evidence guide you.', location: 'The pond south of Bramblewick, near Reed House' },
  'forest:0': { name: 'Moss', role: 'Trail counter', contribution: 'Orin can give the home its first keeper lead. I can point out the next recorded step.', location: 'The forest camp' },
  'forest:1': { name: 'Wren', role: 'Keeper’s messenger', contribution: 'Carry the news the home has found. Orin keeps the keeper’s trail together.', location: 'The forest camp' },
  'forest:2': { name: 'Fern', role: 'Lantern mender', contribution: 'I keep the camp lights ready. Here is the next step the home can take.', location: 'The forest camp' },
};

const canonical = (id: string) => id.replace(/^npc:/, '');
// Presentation bounds only. Trust changes and trade eligibility remain server-owned.
const displayTrust = (value: number) => Math.max(-100, Math.min(100, value));
const place = (id: string) => NPC_CONVERSATION_NEIGHBOURS[id]?.location ?? 'The place named in the shared journal';
const nextLead = (id: string, title: string, text: string, location: string): NPCConversationLead => ({ id, title, text, location });
const incomplete = (story: ForestStoryView, id: string) => !story.objectives.find(o => o.id === id)?.complete;

function sideLead(lead: StoryLead): NPCConversationLead {
  // Infer only from this already-discovered lead's public progress, not authored
  // prerequisites (both side stories are executable before the keeper story).
  if (lead.id === 'a-fair-rind') {
    const heardPip = lead.npcs.some(n => n.id === 'goblin-pip') || (lead.objectives.find(o => o.id === 'fair-rind-accounts')?.current ?? 0) >= 1;
    return heardPip
      ? nextLead(lead.id, lead.title, 'Bring Pip’s account back to Merrit and speak with him outside the cheese shop.', place('cheesemonger-merrit'))
      : nextLead(lead.id, lead.title, 'Ask Pip about the missing cart at Copperbutton camp. Follow the southern road east from Orin, then southeast to the camp.', place('goblin-pip'));
  }
  if (lead.id === 'reed-and-ash') {
    const heardVesper = lead.npcs.some(n => n.id === 'warlock-vesper') || (lead.objectives.find(o => o.id === 'kept-cup-messages')?.current ?? 0) >= 1;
    return heardVesper
      ? nextLead(lead.id, lead.title, 'Bring Vesper’s promise back to Tansy and speak with her by Reed Cottage.', place('witch-tansy-reed'))
      : nextLead(lead.id, lead.title, 'Tell Vesper that Tansy kept his place. Find him outside Hollow Bough in the far southeast.', place('warlock-vesper'));
  }
  return nextLead(lead.id, lead.title, lead.objectives.find(o => !o.complete)?.text ?? lead.summary, lead.summary);
}

function keeperLead(story: ForestStoryView): { lead: NPCConversationLead; tab: NPCJournalTab } {
  if (story.chapter === 'undiscovered') return {
    lead: nextLead('meet-orin', 'Meet Orin', 'Speak with Orin beside Lantern Orchard to discover the home’s keeper story.', place('wizard-orin-vale')), tab: 'leads',
  };
  if (story.chapter === 'wards') {
    if (incomplete(story, 'recover-seals')) return {
      lead: nextLead('keeper-missing', 'Recover the brass seals', 'Follow the southern road east from Orin to the Button camps. Collect the three brass seals beside their tents; every seal helps the whole home.', 'Button camps, east and southeast of Lantern Orchard'), tab: 'leads',
    };
    if (incomplete(story, 'disperse-raiders')) return {
      lead: nextLead('keeper-missing', 'Open the camp road', 'Disperse the two hostile raider bands on the Button camp road. A knife can be found in a dropped backpack beneath the forest trees. Step out of each marked attack circle.', 'Road through the Button camps, east of Orin'), tab: 'leads',
    };
    return { lead: nextLead('keeper-missing', 'Return the wards', 'The home has the seals and cleared both raider bands. Speak with Orin to restore the wards.', place('wizard-orin-vale')), tab: 'leads' };
  }
  if (story.chapter === 'inquiry') {
    if (!story.evidence.some(e => e.id === 'ada-journal')) return {
      lead: nextLead('keeper-inquiry', 'Read Ada’s journal', 'Enter Ada’s unlatched house south of Orin, then inspect the journal inside.', 'Ada’s house, south of Lantern Orchard'), tab: 'evidence',
    };
    if (!story.evidence.some(e => e.id === 'ward-rubbing')) return {
      lead: nextLead('keeper-inquiry', 'Read the ward rubbing', 'Enter Hollow Bough in the far southeast and inspect the ward rubbing inside.', 'Hollow Bough, far southeast of the forest'), tab: 'evidence',
    };
    const witness = ['goblin-nib', 'flirt-fenn', 'watch-garrick'].find(id => !story.suspects.some(s => s.id === id && !!s.testimony?.trim()));
    if (witness) return {
      lead: nextLead('keeper-inquiry', 'Hear the remaining accounts', `Speak with ${NPC_CONVERSATION_NEIGHBOURS[witness]!.name} to record their account. The home needs Nib, Fenn and Garrick’s accounts.`, place(witness)), tab: 'people',
    };
    return {
      lead: nextLead('keeper-inquiry', 'Compare the evidence with Orin', 'Stand beside Orin, open People in the shared journal, and choose “Discuss this face with Orin.” Compare the rubbing with every account; ordinary conversation alone does not name a face.', place('wizard-orin-vale')), tab: 'people',
    };
  }
  if (story.chapter === 'rescue') return incomplete(story, 'clear-root-guardian')
    ? { lead: nextLead('keeper-rescue', 'Reach Ada’s refuge', 'Follow the road to Hollow Bough in the far southeast. Challenge the rootbound guardian and avoid its marked attacks to free the refuge.', 'Refuge beyond Hollow Bough, far southeast'), tab: 'leads' }
    : { lead: nextLead('keeper-rescue', 'Bring Ada home', 'The guardian’s hold is broken. Speak with Ada at the refuge beyond it.', 'Refuge beyond Hollow Bough, far southeast'), tab: 'leads' };
  const openSide = story.leads.find(l => l.status === 'active' && !l.id.startsWith('keeper-'));
  if (openSide) return { lead: sideLead(openSide), tab: 'leads' };
  return { lead: nextLead('keeper-rescue', 'Ada is home', 'The keeper story is complete. Read the shared recap or collect any pending personal keepsakes in Leads.', 'Shared journal → Recap or Leads'), tab: 'recap' };
}

/** Public data in; discovered guidance out. Never import the private keeper
 * reducer, mystery seed, biography dialogue, or the unimplemented hook graph. */
export function npcConversation(context: NPCConversationContext): NPCConversationView {
  const id = canonical(context.npcId);
  const neighbour = NPC_CONVERSATION_NEIGHBOURS[id];
  const name = neighbour?.name ?? context.npcName ?? 'Neighbour';
  const current = keeperLead(context.story);
  let lead = current.lead, tab = current.tab;
  const relatedSide = context.story.leads.find(l => l.status === 'active' && (
    (l.id === 'a-fair-rind' && ['cheesemonger-merrit', 'goblin-pip'].includes(id)) ||
    (l.id === 'reed-and-ash' && ['witch-tansy-reed', 'warlock-vesper'].includes(id))
  ));
  if (relatedSide) { lead = sideLead(relatedSide); tab = 'leads'; }
  const rescue = context.rescue;
  if (rescue?.discovered && ['orchard-worker-mara', 'washer-elsie', 'woodworker-bram', 'spirit-lumen', 'spirit-morrow'].includes(id)) {
    lead = nextLead(rescue.id, rescue.title, rescue.objective, ['recovering', 'complete'].includes(rescue.stage) ? 'Bramblewick, at the south end of town' : place('orchard-worker-mara'));
    tab = 'leads';
  }
  const account = context.story.chapter === 'inquiry' ? context.story.suspects.find(s => s.id === id)?.testimony : undefined;
  const contribution = account?.trim() || neighbour?.contribution || 'Let us follow the next lead the home has discovered.';
  const memory = context.relationship;
  const relationship: NPCRelationshipView | undefined = memory && canonical(memory.npcId) === id && Number.isFinite(memory.trust) ? {
    npcId: memory.npcId, trust: displayTrust(memory.trust), fear: memory.fear, fearThreshold: memory.fearThreshold,
    afraid: memory.afraid, fearExpiresAt: memory.fearExpiresAt, giftReadyAt: memory.giftReadyAt,
  } : undefined;
  // Project fields rather than spreading a store object across the private DTO
  // boundary. Offer capabilities are opaque; prices are copied, never derived.
  const offers: NPCActionOffer[] = (context.offers ?? []).filter(o => canonical(o.npcId) === id).map(o => ({
    actionId: o.actionId, npcId: o.npcId, kind: o.kind, label: o.label, expiresAt: o.expiresAt,
    ...(o.disabledReason !== undefined ? { disabledReason: o.disabledReason } : {}),
    ...(o.potion !== undefined ? { potion: o.potion } : {}),
    ...(o.appleCost !== undefined ? { appleCost: o.appleCost } : {}),
  }));
  const personalNote = relationship?.afraid
    ? 'This neighbour is wary of you. Give them space or use an offered gift to rebuild trust. The home’s story stays available.'
    : 'Discoveries help the whole home. Trades, gifts, trust and rewards belong to you.';
  return {
    npcId: context.npcId, name, role: neighbour?.role ?? 'Neighbour', contribution,
    text: rescue?.discovered && id === 'orchard-worker-mara' ? rescue.summary : contribution,
    lead, journal: { tab, label: tab === 'people' && lead.title === 'Compare the evidence with Orin' ? 'Compare the evidence · People' : `Open ${tab[0]!.toUpperCase()}${tab.slice(1)} in the journal` },
    offers, ...(relationship ? { relationship } : {}),
    ...(context.trust !== undefined && Number.isFinite(context.trust) ? { personalTrust: displayTrust(context.trust) } : {}), personalNote,
  };
}
