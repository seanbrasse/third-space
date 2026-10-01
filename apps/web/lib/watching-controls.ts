/** Resume this device during the tap itself; change room state only if paused. */
export function playFromUserGesture(sharedPlaying: boolean, resume: () => void, playForEveryone: () => void): void {
  resume();
  if (!sharedPlaying) playForEveryone();
}
