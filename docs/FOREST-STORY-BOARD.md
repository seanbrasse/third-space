# Discovered story noticeboard integration

The physical board, persistent dialog and authoritative commands are integrated into the expanded forest. The main thread has three chapters and two executable side stories; the journal displays only discovered information.

## Physical board

Import `FOREST_STORY_BOARD`, `FOREST_STORY_BOARD_USE` and `FOREST_STORY_BOARD_LABEL` from `packages/config/src/forest-story-board.ts`.

- Footprint: `(101,41)`, 2.8×2.2 tiles.
- Collider: `(101.2,42.5)`, 2.4×0.35 tiles.
- Use point: `(102.4,43.5)` beside the town square.

Append the prop and its collider exactly once while constructing the immutable expanded map. Tests verify a clear approach from the square and no collision with any existing guard, resident or wildlife patrol. No trees need to move. Render its ID with `forestStoryBoardCanvas(tile)` from `apps/web/lib/forest-story-board-art.ts`, origin `(0,0)` at its footprint and normal physical-base depth. The fixed decorative paper count does not reveal future quests.

Reuse the existing authoritative furniture approach/interaction mechanism. On a successful nearby interaction, request the current shared story snapshot, record the board visit through the story store's revision API, and open the panel. Do not reveal the complete authored story graph or derive progress in the client. Scene clicking is not proof of interaction range, world/life/zone context, or line of sight.

## UI mount

`apps/web/components/ForestStoryBoard.tsx` consumes the exact `ForestStorySnapshot` from `packages/contracts/src/forest-story.ts`. The component imports its own scoped stylesheet and never imports the authored cast or future story graph.

Mount it persistently inside `.world-shell`, outside conditionally mounted GameMenu children. This ancestry is needed when the game shell is fullscreen. Close another modal before opening it. Stop any currently held movement/sprint using the existing modal-opening path; new inventory and sprint key events are contained by this dialog.

```tsx
<ForestStoryBoard
  open={storyBoardOpen}
  snapshot={snapshot.story ?? null}
  onClose={() => setStoryBoardOpen(false)}
  onFocusGame={() => restoreGameFocus([
    document.querySelector('.forest-story-board'), storyJournalTriggerRef.current,
  ])}
  onClaimReward={rewardId => sendStoryRewardClaim(rewardId)}
  pendingRewardId={pendingStoryRewardId}
  onAccuse={suspectId => sendStoryAccusation(suspectId)}
  canAccuse={serverAllowsDiscussionBesideOrin}
  pendingAccusationId={pendingStoryAccusationId}
  notice={storyActionNotice}
/>
```

These names are illustrative integration variables/functions, not new protocol command names. Root should use the finalized story command contract and its authenticated context fences. The only callback payloads are reward/suspect IDs; the component never grants inventory, writes quest progress or compares a chosen face with a culprit.

`canAccuse` defaults false. Discussion buttons appear only during inquiry after the exact discovered evidence `ada-journal` and `ward-rubbing`, plus testimony from `goblin-nib`, `flirt-fenn` and `watch-garrick`. The distant physical board remains read-only for this action. The integrated client uses the same `canDiscussForestStory` predicate as PartyRoom against its latest snapshot: connected home actor in the forest, no respawn or world change, outside beside a present Orin, within 2.5 tiles and across a walkable line of sight. The server revalidates every request, including revisions, evidence and the discussion cooldown. Recorded accusations are displayed neutrally, not as a guilty verdict.

## Journal submissions

Only one reward or discussion action can be pending at a time, including clicks in the same render frame. Both button groups disable while it is pending; the selected action displays Collecting or Discussing. The result remains in the journal until another action or explicit journal refresh. A full inventory leaves the durable reward pending and shows the server's make-room message.

Replies use the original browser command ID. Internal hashed event IDs still identify durable story receipts; they are not replaced by the reply ID. Discussion attempts that make no change also reply, as do stale actions arriving during respawn. Old-socket and unrelated replies cannot settle a current action.

A ten-second monotonic timeout releases the button and asks the player to refresh their journal before retrying; it never resends a mutation automatically. A late matching reply is accepted until the player starts another action. Connection/admission, scene and life changes clear pending state. Reconnecting does not replay the action. Reward receipts remain the final authority against duplicate claims.

The four sections are Leads, Evidence, People and Recap. Current main objectives are sequential; discovered side leads display even when the main chapter is still `undiscovered`. Connections resolve only to discovered lead IDs. Shared NPC contributions and personal reward receipts remain distinct. A catch-up summary and resolved-lead details allow asynchronous play without listing unreached plots.

The native modal handles inert background and Escape. Explicit focus wrapping keeps Tab inside the dialog across browser variations. Arrow keys, Home and End move among its tabs. Closing invokes `onFocusGame` after dismissal; root's existing focus helper avoids stealing focus from a newly opened panel. Opening or changing section resets that section's scroll to the top.

## Checks and proof

- `apps/web/lib/forest-story-board.test.ts`: discovered-only connections/people, side-first progress, no accusation-to-verdict inference, exact evidence gate, progress bounds and tab keyboard mapping.
- `packages/config/test/forest-story-board.test.ts`: reachable physical anchor and every named patrol leg clear.
- `apps/web/lib/story-actions.test.ts`, `packages/simulation/test/forest-story-access.test.ts`, and `tests/unit/shared-story-room.test.ts`: pending-action ownership/timeouts, shared availability/line of sight, correlated discussion outcomes, storage failure, respawn rejection and full-inventory reward recovery.
- `tests/visual/forest-story-board.mjs`: isolated real Chromium rendering of the actual React component. It uses the existing Playwright dependency and esbuild already provided by tsx, with no app server or new dependencies. Fixture: `apps/web/fixtures/forest-story-board.tsx`, never imported by production routes.

Run `node tests/visual/forest-story-board.mjs`. Optional `PLAYWRIGHT_CHROMIUM_EXECUTABLE` selects an already installed browser; `STORY_BOARD_EVIDENCE_DIR` chooses the output folder. Tested locally with installed Chromium 1223. Twelve browser assertions cover focus/keyboard containment, ID-only callbacks, distant-board read-only behavior, Escape focus return, fullscreen ancestry, 390×844 / 320×568 / 844×390 layouts, at least 44px controls, no horizontal overflow, and a side plot discovered before Orin. The actual rendered desktop/mobile/evidence/physical-board PNGs are in `../story-board-evidence/`.

This isolated UI proof does not verify integrated room interaction, SQLite persistence, network rejection behavior, fullscreen shell integration or physical iPhone behavior. Root owns those end-to-end checks.
