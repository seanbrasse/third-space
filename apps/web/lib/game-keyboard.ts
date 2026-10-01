type KeyEvent = Pick<KeyboardEvent, "key" | "code" | "repeat" | "altKey" | "ctrlKey" | "metaKey" | "target">;
type Target = { isContentEditable?: boolean; closest?: (selector: string) => unknown } | null;
const EDITING = 'input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]';
// Watching is nonmodal; only its focused playback controls own game keys.
const COMPOSITE = 'dialog,iframe,video,audio,[aria-modal="true"],[role="radiogroup"],[role="radio"],[role="dialog"],[role="menu"],[role="menubar"],[role="listbox"],[role="combobox"],[role="slider"],[role="spinbutton"],[role="tablist"],[role="tree"],[role="grid"],[data-game-input="off"]';
const ACTIVATION = 'button,a[href],summary,[role="button"],[role="link"],[role="checkbox"],[role="switch"],[role="radio"],[role="tab"],[role="menuitem"]';
export function isEditingTarget(target: EventTarget | null): boolean {
  const element = target as Target;
  return !!(element?.isContentEditable || element?.closest?.(EDITING));
}
export function isGameInputBlocked(target: EventTarget | null): boolean {
  const element = target as Target;
  return isEditingTarget(target) || !!element?.closest?.(COMPOSITE) ||
    !!(element?.closest?.(".shared-watching") && element.closest?.(ACTIVATION));
}
export function ownsActivation(target: EventTarget | null): boolean {
  return isGameInputBlocked(target) || !!(target as Target)?.closest?.(ACTIVATION);
}
export function shouldOpenChat(event: Pick<KeyboardEvent, "key" | "repeat" | "target" | "defaultPrevented">, blocked: boolean): boolean {
  return event.key === "Enter" && !event.repeat && !event.defaultPrevented && !blocked && !ownsActivation(event.target);
}
export function gameHotkey(event: KeyEvent & Pick<KeyboardEvent, "defaultPrevented">, blocked: boolean): "flashlight" | null {
  if (blocked || event.defaultPrevented || event.repeat || event.altKey || event.ctrlKey || event.metaKey ||
      isGameInputBlocked(event.target)) return null;
  return event.code === "KeyF" || (!event.code && event.key.toLowerCase() === "f") ? "flashlight" : null;
}
function gameKey(event: KeyEvent): string {
  if (event.altKey || event.ctrlKey || event.metaKey) return "";
  if (["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(event.code)) return event.code;
  return ({ w: "KeyW", a: "KeyA", s: "KeyS", d: "KeyD", " ": "Space" } as Record<string, string>)[event.key.toLowerCase()] ?? "";
}
export class GameKeyboard {
  private held = new Set<string>();
  private pendingSprint = false;
  keydown(event: KeyEvent, blocked: boolean): boolean {
    const code = gameKey(event);
    if (!code || blocked || isGameInputBlocked(event.target) || (code === "Space" && ownsActivation(event.target))) return false;
    // A held key cannot rearm after a focus/visibility reset through auto-repeat.
    if (event.repeat && !this.held.has(code)) return false;
    if (code === "Space" && !event.repeat && !this.held.has(code)) this.pendingSprint = true;
    this.held.add(code);
    return true;
  }
  keyup(event: KeyEvent): void { this.held.delete(event.code); }
  reset(): void { this.held.clear(); this.pendingSprint = false; }
  read() {
    return {
      axisX: Number(this.held.has("KeyD") || this.held.has("ArrowRight")) - Number(this.held.has("KeyA") || this.held.has("ArrowLeft")),
      axisY: Number(this.held.has("KeyS") || this.held.has("ArrowDown")) - Number(this.held.has("KeyW") || this.held.has("ArrowUp")),
      jump: this.held.has("Space"), sprint: this.held.has("Space") || this.pendingSprint,
    };
  }
  takeSprintTap(): boolean { const tap = this.pendingSprint; this.pendingSprint = false; return tap; }
}
