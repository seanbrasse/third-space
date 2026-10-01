'use client';

import { useId, useLayoutEffect, useRef } from 'react';
import type { ForestNPC } from '../../../packages/contracts/src/forest-npc';
import type { NPCActionOffer } from '../../../packages/contracts/src/living-world';
import type { NPCConversationView, NPCJournalTab } from '../../../packages/config/src/npc-conversations';
import { restoreGameFocus } from '../lib/game-focus';
import { npcInteractionUnavailable, npcOfferDetail, npcOfferUnavailable } from '../lib/npc-interaction-model';
import './npc-interaction-panel.css';

export interface NpcInteractionPanelProps {
  open: boolean;
  conversation: NPCConversationView | null;
  npc: ForestNPC | null;
  inRange: boolean;
  playerAlive: boolean;
  connected: boolean;
  mode?: 'conversation' | 'help';
  pendingActionId?: string | null;
  serverTime?: number;
  notice?: string | null;
  onAction: (offer: NPCActionOffer) => void;
  onOpenJournal?: (tab: NPCJournalTab) => void;
  onClose: () => void;
  /** Existing focus helper callback; called only if this panel owned focus. */
  onFocusGame?: () => void;
}

/** Mount inside .world-shell. This is a nonmodal region, including proactive
 * help: no autofocus, keyboard trap, backdrop, or interrupted world simulation.
 * E opens information only. Every server action requires its own button. */
export default function NpcInteractionPanel({ open, conversation, npc, inRange, playerAlive, connected,
  mode = 'conversation', pendingActionId, serverTime, notice, onAction, onOpenJournal, onClose, onFocusGame,
}: NpcInteractionPanelProps) {
  const id = useId();
  const panel = useRef<HTMLElement>(null), previousPanel = useRef<HTMLElement | null>(null), wasOpen = useRef(false);
  const focusHelper = useRef(onFocusGame);
  focusHelper.current = onFocusGame;
  useLayoutEffect(() => {
    let cancel: (() => void) | undefined;
    if (open) previousPanel.current = panel.current;
    else if (wasOpen.current) {
      const owner = previousPanel.current;
      if (owner?.contains(document.activeElement) && focusHelper.current) focusHelper.current();
      else cancel = restoreGameFocus([owner]);
    }
    wasOpen.current = open;
    return () => cancel?.();
  }, [open]);

  if (!open) return null;
  const availability = { conversation, npc, inRange, playerAlive, connected, serverTime, pendingActionId };
  const unavailable = npcInteractionUnavailable(availability);
  const offers = conversation?.offers ?? [];
  const peaceful = offers.filter(offer => offer.kind !== 'attack');
  const attacks = offers.filter(offer => offer.kind === 'attack');
  const status = unavailable || notice || (pendingActionId ? 'Waiting for the world to confirm your choice…' : null);
  const offerButton = (offer: NPCActionOffer) => {
    const reason = npcOfferUnavailable(offer, availability), detail = npcOfferDetail(offer);
    const descriptionId = `${id}-offer-${encodeURIComponent(offer.actionId)}`;
    return <div className="npc-choice" key={offer.actionId}>
      <button type="button" disabled={!!reason} aria-describedby={detail || reason ? descriptionId : undefined}
        data-action-kind={offer.kind} onClick={() => { if (!npcOfferUnavailable(offer, availability)) onAction(offer); }}>
        {pendingActionId === offer.actionId ? 'Confirming…' : offer.label}
      </button>
      {(detail || reason) && <small id={descriptionId}>{detail}{detail && reason ? ' · ' : ''}{reason}</small>}
    </div>;
  };

  return <section ref={panel} className="npc-interaction-panel" data-mode={mode} data-npc-id={conversation?.npcId ?? npc?.id}
    role="region" aria-labelledby={`${id}-title`} aria-describedby={`${id}-keyboard`}
    onPointerDown={event => event.stopPropagation()}
    onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape') { event.preventDefault(); onClose(); } }}
    onKeyUp={event => event.stopPropagation()}>
    <header className="npc-interaction-heading">
      <div><span className="npc-interaction-eyebrow">{mode === 'help' ? 'A neighbour needs help' : conversation?.role ?? 'Nearby neighbour'}</span>
        <h2 id={`${id}-title`}>{conversation?.name ?? npc?.name ?? 'A neighbour'}</h2></div>
      <button type="button" className="npc-interaction-close" onClick={onClose} aria-label={mode === 'help' ? 'Dismiss help request' : 'Close conversation'}>×</button>
    </header>
    <div className="npc-interaction-scroll">
      {conversation ? <>
        <p className="npc-conversation-line">{conversation.text}</p>
        {conversation.lead && <div className="npc-current-lead">
          <span className="npc-interaction-eyebrow">{conversation.lead.id === 'lantern-road' ? 'Lantern Road' : 'Your home’s next step'}</span>
          <h3>{conversation.lead.title}</h3><p>{conversation.lead.text}</p>
          <p className="npc-lead-location"><strong>Where</strong> {conversation.lead.location}</p>
          {conversation.journal && onOpenJournal && <button type="button" className="npc-journal-action"
            onClick={() => onOpenJournal(conversation.journal!.tab)}>{conversation.journal.label}</button>}
        </div>}
        {peaceful.length > 0 && <div className="npc-interaction-choices" aria-label="Available choices">{peaceful.map(offerButton)}</div>}
        {attacks.length > 0 && <details className="npc-other-choices"><summary>Other choices</summary><div className="npc-interaction-choices">{attacks.map(offerButton)}</div></details>}
        <p className="npc-personal-note">{conversation.personalNote}</p>
        {conversation.relationship && Number.isFinite(conversation.relationship.trust) && <p className="npc-relationship-note">Their trust in you: {conversation.relationship.trust}</p>}
        {conversation.personalTrust !== undefined && Number.isFinite(conversation.personalTrust) && <p className="npc-relationship-note">Your reputation in this home: {conversation.personalTrust}</p>}
        {conversation.relationship?.afraid && <p className="npc-relationship-note">Wary of you · {conversation.relationship.fear}/{conversation.relationship.fearThreshold} fear</p>}
      </> : <p className="npc-conversation-line">Waiting for a current reply from the world…</p>}
    </div>
    <footer className="npc-interaction-footer">
      <p role="status" aria-live="polite" aria-atomic="true">{status}</p>
      {mode === 'help' && <button type="button" className="npc-decline-help" onClick={onClose}>Not now</button>}
      <p id={`${id}-keyboard`}>{mode === 'help' ? 'You can help, dismiss, or keep moving. ' : ''}The world keeps moving. Tab to choose · Esc to close.</p>
    </footer>
  </section>;
}
