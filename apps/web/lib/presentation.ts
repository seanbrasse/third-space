/** Visual correction never changes authoritative simulation or score. */
export function decayCorrection(
  value: number,
  deltaMs: number,
  reducedMotion = false,
) {
  return reducedMotion ? 0 : value * Math.exp(-Math.max(0, deltaMs) / 110);
}
export function cameraFollowX(
  playerX: number,
  mapWidth: number,
  viewportWidth: number,
) {
  const half = Math.min(mapWidth / 2, viewportWidth / 2);
  return Math.max(half, Math.min(mapWidth - half, playerX));
}
