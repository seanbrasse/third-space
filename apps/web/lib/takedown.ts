/** Presentation only. Authority still owns catches, movement locks and respawn. */
export const TAKEDOWN_DURATION_MS = 1800;
export type TakedownCreature = 'clown' | 'werewolf' | 'mimic';
export function takedownWindow(caughtAt: number | undefined, serverTime: number) {
  if (caughtAt === undefined || !Number.isFinite(caughtAt) || !Number.isFinite(serverTime)) return null;
  const elapsed = Math.max(0, serverTime - caughtAt);
  return elapsed >= TAKEDOWN_DURATION_MS ? null : { elapsed, remaining: TAKEDOWN_DURATION_MS - elapsed };
}
export function takedownCreature(value: unknown): TakedownCreature | undefined {
  return value === 'clown' || value === 'werewolf' || value === 'mimic' ? value : undefined;
}

/** Survives component remounts; the same catch may finish, but cannot start another lunge. */
export class CatchPresentation {
  private seen = new Set<string>();
  begin(key: string, caughtAt: number | undefined, serverTime: number) {
    const window = takedownWindow(caughtAt, serverTime);
    if (!window) return null;
    const fresh = !this.seen.has(key) && window.elapsed <= 350;
    this.seen.add(key);
    if (this.seen.size > 64) this.seen.delete(this.seen.values().next().value!);
    return { ...window, jumpScare: fresh };
  }
}
