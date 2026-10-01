/** Browser capabilities are checked at interaction time; rejection is an honest fallback. */
export async function toggleGameFullscreen(element: HTMLElement, doc: Document = document): Promise<void> {
  if (doc.fullscreenElement === element) {
    await doc.exitFullscreen();
    return;
  }
  if (!doc.fullscreenEnabled || typeof element.requestFullscreen !== "function")
    throw new Error("Game fullscreen is unavailable in this browser. You can keep playing here.");
  await element.requestFullscreen();
}
export function fullscreenBlocksGameFocus(fullscreen: Element | null, viewport: Element | null): boolean {
  return !!fullscreen && (!viewport || !fullscreen.contains(viewport));
}
