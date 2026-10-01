import { fullscreenBlocksGameFocus } from "./game-fullscreen";
/** Closing a panel returns game keys, but never steals another interaction. */
export function mayRestoreGameFocus(
  active: Element | null,
  body: Element,
  owners: readonly (Element | null)[],
  modalOpen: boolean,
  fullscreen: boolean,
): boolean {
  if (modalOpen || fullscreen) return false;
  return !active || active === body || !active.isConnected ||
    owners.some(owner => !!owner && (owner === active || owner.contains(active)));
}

export function restoreGameFocus(owners: readonly (Element | null)[]): () => void {
  let observer: MutationObserver | null = null, scope: Element | null = null;
  let disposed = false, frame = 0;
  const eligible = () => mayRestoreGameFocus(document.activeElement, document.body, owners,
    !!document.querySelector('[aria-modal="true"]'), fullscreenBlocksGameFocus(document.fullscreenElement, document.querySelector(".world-shell")));
  const cancel = () => {
    disposed = true; cancelAnimationFrame(frame); observer?.disconnect();
    document.removeEventListener("focusin", focusChanged);
  };
  const focusChanged = () => { if (!eligible()) cancel(); };
  const restore = () => {
    if (disposed) return;
    if ((scope && !scope.isConnected) || !eligible()) { cancel(); return; }
    const viewport = document.querySelector<HTMLElement>(".world-canvas");
    if (viewport?.isConnected) {
      viewport.focus({ preventScroll: true }); cancel(); return;
    }
    // The renderer is lazy-loaded. Keep the close request only for this shell,
    // without a timed retry or taking focus from a subsequent interaction.
    scope ??= document.querySelector(".world-shell");
    if (!scope?.isConnected) { cancel(); return; }
    if (!observer) {
      observer = new MutationObserver(restore);
      observer.observe(document.body, { childList: true, subtree: true });
      document.addEventListener("focusin", focusChanged);
    }
  };
  frame = requestAnimationFrame(restore);
  return cancel;
}
