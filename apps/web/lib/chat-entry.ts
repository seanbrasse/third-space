import { isGameInputBlocked } from "./game-keyboard";

type ChatKey = Pick<KeyboardEvent, "key" | "code" | "target" | "repeat" | "defaultPrevented" | "isComposing" | "ctrlKey" | "metaKey" | "altKey">;
export function shouldOpenChatWithSlash(event: ChatKey, disabled: boolean): boolean {
  return !disabled && event.key === "/" &&
    !event.defaultPrevented && !event.repeat && !event.isComposing &&
    !event.ctrlKey && !event.metaKey && !event.altKey && !isGameInputBlocked(event.target);
}

type Submission = { draft: string; revision: number; owners: readonly (Element | null)[]; pending: boolean };
/** Transport acceptance, not the Enter key, decides when a composer is done. */
export class ChatSubmissions {
  private entries = new Map<string, Submission>();
  hasPending(revision: number): boolean {
    return [...this.entries.values()].some(entry => entry.pending && entry.revision === revision);
  }
  begin(commandId: string, draft: string, revision: number, owners: readonly (Element | null)[]): boolean {
    if (!draft.trim() || this.hasPending(revision)) return false;
    this.entries.set(commandId, { draft, revision, owners, pending: true });
    if (this.entries.size > 64) this.entries.delete(this.entries.keys().next().value!);
    return true;
  }
  fail(commandId: string): void { const entry=this.entries.get(commandId); if(entry)entry.pending=false; }
  clear(): void { this.entries.clear(); }
  complete(commandId: string, draft: string, revision: number, active: Element | null) {
    const entry=this.entries.get(commandId); this.entries.delete(commandId);
    const clear=!!entry && entry.revision===revision && entry.draft===draft;
    return { clear, focus:clear && !!active && entry!.owners.some(owner=>!!owner&&owner===active), owners:entry?.owners??[] };
  }
}
