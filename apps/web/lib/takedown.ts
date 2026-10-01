/** Presentation only. Authority still owns catches, movement locks and respawn. */
export const TAKEDOWN_DURATION_MS = 1800;
export type TakedownCreature = 'clown' | 'werewolf';
export function takedownWindow(caughtAt: number | undefined, serverTime: number) {
  if (caughtAt === undefined || !Number.isFinite(caughtAt) || !Number.isFinite(serverTime)) return null;
  const elapsed = Math.max(0, serverTime - caughtAt);
  return elapsed >= TAKEDOWN_DURATION_MS ? null : { elapsed, remaining: TAKEDOWN_DURATION_MS - elapsed };
}
export function takedownCreature(value: unknown): TakedownCreature | undefined {
  return value === 'clown' || value === 'werewolf' ? value : undefined;
}
