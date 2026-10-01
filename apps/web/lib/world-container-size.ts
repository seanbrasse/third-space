/** CSS grid, HUD rows and panels can resize the renderer without a window event.
 * Coalesce measurements outside the observer callback and release on game exit. */
export function observeWorldContainer(parent: HTMLElement, resize: () => void): () => void {
  let stopped = false, frame: number | null = null, width = -1, height = -1;
  const measure = () => {
    frame = null;
    if (stopped) return;
    const bounds = parent.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0 || !Number.isFinite(bounds.width + bounds.height)) {
      width = height = -1; // Reappearing at the old size still needs a refresh.
      return;
    }
    if (bounds.width === width && bounds.height === height) return;
    width = bounds.width; height = bounds.height;
    resize();
  };
  const schedule = () => { if (!stopped && frame === null) frame = requestAnimationFrame(measure); };
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
  observer?.observe(parent);
  window.addEventListener('resize', schedule);
  schedule();
  return () => {
    stopped = true; observer?.disconnect(); window.removeEventListener('resize', schedule);
    if (frame !== null) cancelAnimationFrame(frame);
  };
}
