/** Server timestamps only: transport pings and room updates are never activity. */
export const IDLE_POLICY = { warningMs: 15 * 60_000, graceMs: 3 * 60_000 } as const;
export interface IdlePresence { lastActivityAt: number }
export function createIdlePresence(now: number): IdlePresence { return { lastActivityAt: now }; }
export function recordActivity(state: IdlePresence, now: number): void { state.lastActivityAt = now; }
export function recordWatching(state: IdlePresence, now: number): void {
  recordActivity(state, now);
}
export function idleStatus(state: IdlePresence, now: number) {
  const warningAt = state.lastActivityAt + IDLE_POLICY.warningMs;
  const kickAt = warningAt + IDLE_POLICY.graceMs;
  return { warningAt, kickAt, warned: now >= warningAt, expired: now >= kickAt };
}
