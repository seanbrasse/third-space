/** Publish the rendered inventory bounds, including transient effect/attack rows.
 * No React render or per-frame polling is needed when only a countdown changes. */
export function observeSurvivalHUD(hud: HTMLElement): () => void {
  const canvas = hud.parentElement;
  const scope = canvas?.closest<HTMLElement>('.world-shell') ?? canvas;
  if (!canvas || !scope) return () => {};
  const properties = ['--survival-hud-clearance', '--survival-hud-width', '--survival-talk-height'] as const;
  const previous = properties.map(key => scope.style.getPropertyValue(key));
  let stopped = false;
  let prompt: HTMLElement | null = null;
  const measure = () => {
    if (stopped) return;
    const bounds = hud.getBoundingClientRect(), world = canvas.getBoundingClientRect();
    scope.style.setProperty(properties[0], `${Math.ceil(Math.max(0, world.bottom - bounds.top) + 8)}px`);
    scope.style.setProperty(properties[1], `${Math.ceil(bounds.width)}px`);
    const next = canvas.querySelector<HTMLElement>('.nearby-npc-prompt');
    if (next !== prompt) {
      if (prompt) observer?.unobserve(prompt);
      prompt = next;
      if (prompt) observer?.observe(prompt);
    }
    scope.style.setProperty(properties[2], `${Math.ceil(Math.max(44, prompt?.getBoundingClientRect().height ?? 0))}px`);
  };
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
  observer?.observe(hud); observer?.observe(canvas);
  // The prompt mounts independently of the always-present inventory.
  const children = typeof MutationObserver === 'undefined' ? null : new MutationObserver(measure);
  children?.observe(canvas, {childList: true});
  measure();
  window.addEventListener('resize', measure);
  return () => {
    stopped = true; observer?.disconnect(); children?.disconnect(); window.removeEventListener('resize', measure);
    properties.forEach((key, i) => previous[i] ? scope.style.setProperty(key, previous[i]!) : scope.style.removeProperty(key));
  };
}
