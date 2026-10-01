import type { NPCActionOffer } from '../../contracts/src/living-world';
import type { StolenLanternAction, StolenLanternSnapshot, StolenLanternStage } from '../../contracts/src/stolen-lantern';
import type { NPCConversationLead, NPCConversationView } from './npc-conversations';
import { STOLEN_LANTERN_CONFIG as C, STOLEN_LANTERN_NPCS } from './stolen-lantern';
import { LANTERN_CAVE, LANTERN_CAVE_ANCHOR, LANTERN_CAVE_DOOR } from './lantern-cave';

const ELSIE = STOLEN_LANTERN_NPCS.elsie, PIP = STOLEN_LANTERN_NPCS.pip, LUMEN = STOLEN_LANTERN_NPCS.lumen, MORROW = 'spirit-morrow';
const neighbours = new Set([ELSIE, PIP, LUMEN, MORROW]);
const canonical = (id: string) => id.replace(/^npc:/, '');
const places = {
  elsie: 'Elsie at Reed pond, south of Bramblewick (99, 68)',
  pip: 'Pip at Copperbutton camp, southeast of Lantern Orchard (72, 95)',
  cave: `Lantern Cave doorway, northeast of Lantern Orchard and northwest of Copperbutton camp (${LANTERN_CAVE_DOOR.point.x}, ${LANTERN_CAVE_DOOR.point.y}); the lantern plinth is inside ${LANTERN_CAVE.name} (${LANTERN_CAVE_ANCHOR.x}, ${LANTERN_CAVE_ANCHOR.y})`,
  lumen: 'Lumen at Lantern Orchard (55, 82)',
};
const sharedItem = 'Shared quest item · recovered for your home. The lantern is held for the home; it does not occupy a personal hotbar slot.';

function questLead(stage: StolenLanternStage, title: string): NPCConversationLead {
  const steps: Record<StolenLanternStage, { title?: string; text: string; location: string }> = {
    quiet: { title: 'Ask about Elsie’s lantern', text: 'Speak with Elsie at the pond and choose “Ask about the missing lantern” to begin the shared search.', location: places.elsie },
    'ask-pip': { text: 'Ask Pip what he knows about Elsie’s missing lantern. Find him at Copperbutton camp and choose “Ask Pip about the lantern.”', location: places.pip },
    'find-cave': { text: `Enter Lantern Cave through the stone doorway. Inside ${LANTERN_CAVE.name}, approach the lantern plinth and use the recovery point to recover the lantern for the home.`, location: places.cave },
    'return-lantern': { text: 'The home has recovered the lantern. Return to Elsie at Reed pond and choose “Return the home’s lantern.”', location: places.elsie },
    complete: { title: 'Elsie’s lantern is home', text: 'The shared search is complete. Elsie has her lantern at the pond. Any personal thank-you remains yours to collect there.', location: places.elsie },
  };
  const step = steps[stage];
  return { id: 'stolen-lantern', title: step.title ?? title, text: step.text, location: step.location };
}

function elsieLine(stage: StolenLanternStage): string {
  return {
    quiet: 'My lantern has vanished from the pond. Will you ask Pip what he saw? Choose to begin when you are ready.',
    'ask-pip': 'Pip may have seen where my lantern went. Ask him at Copperbutton camp, then follow the account he gives you.',
    'find-cave': `Pip gave the home a place to search. Enter Lantern Cave, then approach the lantern plinth inside ${LANTERN_CAVE.name} and use its recovery point.`,
    'return-lantern': 'The home has found my lantern. Choose to return it here, and the pond can have its light again.',
    complete: 'The home returned my lantern. There is light beside the washing again; thank you for seeing this through together.',
  }[stage];
}

function pipLine(stage: StolenLanternStage): string {
  return {
    quiet: 'If Elsie asks for help at the pond, bring me her question. I will give my own account.',
    'ask-pip': 'Ask me about Elsie’s lantern, and I will tell the home what I saw. Morrow’s accusations are no substitute for asking.',
    'find-cave': `The home has my account: enter Lantern Cave, northwest of this camp. Inside ${LANTERN_CAVE.name}, approach the lantern plinth and use its recovery point.`,
    'return-lantern': 'You do not need to question me again. The lantern is safe for the home; Elsie is waiting at the pond.',
    complete: 'Elsie has her lantern again. An honest question did more good than Morrow’s accusations.',
  }[stage];
}

function morrowLine(stage: StolenLanternStage): string {
  const whisper: Record<StolenLanternStage, string> = {
    quiet: '“Leave the path. My light knows a quicker way,” Morrow whispers from the pond.',
    'ask-pip': '“Pip’s word is worthless. Blame him and be done,” Morrow whispers from the pond.',
    'find-cave': '“There is nothing worth finding in that cave,” Morrow whispers from the pond.',
    'return-lantern': '“Keep the lantern for yourself,” Morrow whispers from the pond.',
    complete: '“One kindness changes nothing,” Morrow whispers from the pond.',
  };
  return `${whisper[stage]} Morrow is a hostile spirit: his whispers mislead and his pulses can snare nearby travellers. Follow the recorded lead, not his advice. Lumen can clear a snare with a protective ward.`;
}

/** Extends a recipient's current public conversation without advancing a quest,
 * spending an apple, casting a ward, or changing any inventory. These `stolen:`
 * IDs are fixed catalog selectors, NOT capabilities. The room must bind the
 * actor/NPC/range/life and revalidate stage, inventory, incidents and cooldowns.
 * Cave recovery belongs to its world anchor and is never offered by an NPC. */
export function extendStolenLanternConversation(base: NPCConversationView, snapshot: StolenLanternSnapshot): NPCConversationView {
  const npcId = canonical(base.npcId);
  if (!neighbours.has(npcId)) return base;

  const stage = snapshot.quest.stage;
  const title = snapshot.quest.title.trim() || 'The Stolen Lantern';
  const now = snapshot.serverTime;
  const validTime = Number.isFinite(now) && now >= 0 && Number.isSafeInteger(now + 60_000);
  const expiresAt = validTime ? now + 60_000 : 0;
  const unresolved = ([ELSIE, PIP, LUMEN] as readonly string[]).includes(npcId) && snapshot.personal.incidents.some(incident => canonical(incident.npcId) === npcId && !incident.resolvedAt);
  const trustReason = unresolved ? `This neighbour remembers your harm. Make restitution here with ${C.restitutionApples} apples before asking for this help.` : undefined;
  const extraOffers: NPCActionOffer[] = [];
  const offer = (action: Exclude<StolenLanternAction, 'recover'>, kind: NPCActionOffer['kind'], label: string, disabledReason?: string, appleCost?: number) => {
    extraOffers.push({ actionId: `stolen:${action}`, npcId, kind, label, expiresAt,
      ...(!validTime ? { disabledReason: 'Reconnect to refresh this offer.' } : disabledReason ? { disabledReason } : {}),
      ...(appleCost !== undefined ? { appleCost } : {}),
    });
  };

  if (unresolved) offer('restitute', 'give', `Make restitution · ${C.restitutionApples} apples`, snapshot.personal.inventory.apples < C.restitutionApples ? `Restitution needs ${C.restitutionApples} apples from your inventory.` : undefined, C.restitutionApples);
  if (npcId === ELSIE && stage === 'quiet') offer('begin', 'talk', 'Ask about the missing lantern', trustReason);
  if (npcId === PIP && stage === 'ask-pip') offer('ask-pip', 'talk', 'Ask Pip about the lantern', trustReason);
  if (npcId === ELSIE && stage === 'return-lantern') offer('return', 'give', 'Return the home’s lantern', trustReason);
  if (npcId === ELSIE && stage === 'complete' && snapshot.personal.reward === 'pending') offer('claim', 'claim-reward', `Collect your thank-you · ${C.rewardApples} apples`, trustReason);
  if (npcId === LUMEN) {
    const wait = Number.isFinite(snapshot.personal.wardReadyAt) && validTime ? Math.max(0, Math.ceil((snapshot.personal.wardReadyAt - now) / 1000)) : 0;
    offer('ward', 'talk', `Ask Lumen for a ${C.wardDurationMs / 1000}-second ward`, trustReason ?? (!Number.isFinite(snapshot.personal.wardReadyAt) ? 'Speak with Lumen again to refresh the ward’s cooldown.' : wait ? `Lumen can offer another ward in ${wait} seconds. The cooldown is ${C.wardCooldownMs / 1000} seconds.` : undefined));
  }

  // Pip has no lantern account before Elsie's request. After completion, the
  // other neighbours resume their current keeper/Fair Rind lead and journal tab;
  // Elsie remains the specific destination for an earned personal thank-you.
  const useQuestLead = npcId === ELSIE || (stage !== 'quiet' && (stage !== 'complete' || !base.lead));
  const keepPipContext = npcId === PIP && (stage === 'quiet' || stage === 'complete');
  const text = npcId === ELSIE ? elsieLine(stage) : npcId === PIP ? (keepPipContext ? base.text : pipLine(stage)) : npcId === MORROW ? morrowLine(stage)
    : `I can give you a protective ward here at Lantern Orchard (55, 82). It lasts ${C.wardDurationMs / 1000} seconds, clears Morrow’s current snare, and prevents a new snare while active. I need ${C.wardCooldownMs / 1000} seconds before offering another.`;
  const personalNotes = [base.personalNote];
  if (unresolved) personalNotes.push(`${base.name} still remembers the harm you caused. This distrust endures until you make restitution here. Ordinary gifts do not settle this incident; choose “Make restitution” for ${C.restitutionApples} apples.`);
  if (snapshot.quest.custody === 'home') personalNotes.push(sharedItem);
  if (snapshot.personal.wardUntil > now && Number.isFinite(snapshot.personal.wardUntil) && validTime) personalNotes.push(`Lumen’s ward protects you for ${Math.ceil((snapshot.personal.wardUntil - now) / 1000)} more seconds.`);
  if (snapshot.personal.snareUntil > now && Number.isFinite(snapshot.personal.snareUntil) && validTime) personalNotes.push(`Morrow’s snare lasts ${Math.ceil((snapshot.personal.snareUntil - now) / 1000)} more seconds. Find ${places.lumen} for a ward.`);
  if (stage === 'complete') {
    if (snapshot.personal.reward === 'pending') personalNotes.push(`Your ${C.rewardApples}-apple thank-you is pending at Elsie. If your inventory is full, the reward remains available until you have room.`);
    else if (snapshot.personal.reward === 'claimed') personalNotes.push(`You have collected your personal ${C.rewardApples}-apple thank-you. The shared quest is complete.`);
    else personalNotes.push('The home’s lantern is returned. This snapshot has no personal thank-you available to collect.');
  }

  return {
    ...base, text, contribution: keepPipContext ? base.contribution : text,
    ...(useQuestLead ? { lead: questLead(stage, title), journal: { tab: 'leads' as const, label: stage === 'quiet' ? 'Open shared journal' : 'Read Stolen Lantern · Leads' } } : {}),
    offers: [...extraOffers, ...base.offers.filter(existing => !existing.actionId.startsWith('stolen:')).map(existing => ({ ...existing }))],
    personalNote: personalNotes.join(' '),
  };
}
