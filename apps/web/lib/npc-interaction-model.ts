import type { ForestNPC } from '../../../packages/contracts/src/forest-npc';
import type { NPCActionOffer } from '../../../packages/contracts/src/living-world';
import type { NPCConversationView } from '../../../packages/config/src/npc-conversations';

export interface NPCInteractionAvailability {
  conversation: NPCConversationView | null;
  npc: ForestNPC | null;
  inRange: boolean;
  playerAlive: boolean;
  connected: boolean;
  /** Latest server-clock estimate. This is a UI expiry hint, never authority. */
  serverTime?: number;
  pendingActionId?: string | null;
}
export const canonicalNPCId = (id: string) => id.replace(/^npc:/, '');

/** The room repeats every check. Client hints keep stale controls honest and
 * never calculate affordability, stock, damage, rewards or trust changes. */
export function npcInteractionUnavailable(input: NPCInteractionAvailability): string | null {
  if (!input.connected) return 'Reconnecting. Actions will return when the world is connected.';
  if (!input.playerAlive) return 'Return to the forest after recovering to speak with this neighbour.';
  if (!input.conversation) return 'Waiting for this neighbour’s current reply…';
  if (!input.npc || canonicalNPCId(input.npc.id) !== canonicalNPCId(input.conversation.npcId)) return 'This neighbour is no longer here. Approach them and press E again.';
  if (input.npc.phase === 'respawning' || input.npc.health <= 0) return 'This neighbour is recovering. Give them time to return.';
  if (!input.inRange) return 'Walk closer to this neighbour to use these actions.';
  return null;
}

export function npcOfferUnavailable(offer: NPCActionOffer, input: NPCInteractionAvailability): string | null {
  const unavailable = npcInteractionUnavailable(input);
  if (unavailable) return unavailable;
  if (!input.conversation || canonicalNPCId(offer.npcId) !== canonicalNPCId(input.conversation.npcId) ||
    !input.conversation.offers.some(current => current.actionId === offer.actionId && current.npcId === offer.npcId)) return 'This offer has changed. Speak with the neighbour again.';
  if (input.pendingActionId) return 'Waiting for the world to confirm your choice…';
  if (input.serverTime !== undefined && offer.expiresAt <= input.serverTime) return 'This offer has expired. Speak with the neighbour again.';
  return offer.disabledReason || null;
}

export function npcOfferDetail(offer: NPCActionOffer): string | null {
  // Values are rendered exactly as issued. No client-side price or potion-stat table.
  if (offer.appleCost !== undefined && Number.isFinite(offer.appleCost) && offer.appleCost > 0)
    return `${offer.appleCost} ${offer.appleCost === 1 ? 'apple' : 'apples'} from your inventory`;
  if (offer.kind === 'attack') return 'This choice can frighten the neighbour and harm your trust.';
  if (offer.kind === 'protect' || offer.kind === 'escort') return 'Help in the world; movement and combat continue.';
  if (offer.kind === 'claim-reward') return 'A personal reward for your help.';
  return null;
}
