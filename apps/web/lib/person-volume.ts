export function clampVolume(value: unknown, fallback = 1): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : fallback;
}
/** Keep stored listener preferences bounded and safe when upgrading older saves. */
export function readPersonVolumes(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([id]) => /^[a-zA-Z0-9_-]{1,128}$/.test(id))
      .slice(-200)
      .map(([id, volume]) => [id, clampVolume(volume)]),
  );
}
export function listenerGain(
  master: number,
  person: number,
  distance: number,
  muted: boolean,
): number {
  if (muted || !Number.isFinite(distance)) return 0;
  return (
    clampVolume(master, 0) *
    clampVolume(person) *
    Math.max(0, 1 - Math.max(0, distance) / 12) *
    0.13
  );
}
