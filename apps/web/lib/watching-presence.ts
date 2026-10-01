/** Checks the real player surface, not the room's shared playing flag. */
export function hasVisiblePlayback(element: HTMLElement | null, playing: boolean): boolean {
  if (!element || !playing || document.hidden || !element.isConnected) return false;
  const rect = element.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1 || rect.bottom <= 0 || rect.right <= 0 || rect.top >= innerHeight || rect.left >= innerWidth) return false;
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || Number(style.opacity) === 0 || node.hidden) return false;
  }
  return true;
}
export function reportVisiblePlayback(element: HTMLElement | null, playing: boolean, playbackId?: string) {
  if (playbackId && hasVisiblePlayback(element, playing))
    document.dispatchEvent(new CustomEvent('third-space:watching', { detail: { playbackId } }));
}
