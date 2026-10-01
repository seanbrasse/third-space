/** Resume this device during the tap itself; change room state only if paused. */
export function playFromUserGesture(sharedPlaying: boolean, resume: () => void, playForEveryone: () => void, localOnly = false): void {
  resume();
  if (!sharedPlaying && !localOnly) playForEveryone();
}

/** Explicit recovery uses the current room clock, even after a long blocked wait. */
export function sharedPlaybackPosition(media: { position: number; playing: boolean; anchorAt: number }, serverNow: number): number {
  return media.position + (media.playing ? Math.max(0, serverNow - media.anchorAt) / 1000 : 0);
}
