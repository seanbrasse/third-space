export type ScreenLabelPriority = 'dialogue' | 'engaged-mob' | 'idle-mob' | 'ambient-npc';
export interface ScreenLabelRect { x: number; y: number; width: number; height: number }
export interface ScreenLabelCandidate {
  id: string;
  /** Final screen bounds in CSS pixels, after camera zoom and viewport clamping. */
  rect: ScreenLabelRect;
  priority: ScreenLabelPriority;
  distance: number;
  setVisible: (visible: boolean) => void;
}

const PRIORITY: Record<ScreenLabelPriority, number> = { dialogue: 4, 'engaged-mob': 3, 'idle-mob': 2, 'ambient-npc': 1 };
const GAP = 3;
function overlaps(a: ScreenLabelRect, b: ScreenLabelRect) {
  return a.x < b.x + b.width + GAP && a.x + a.width + GAP > b.x &&
    a.y < b.y + b.height + GAP && a.y + a.height + GAP > b.y;
}

/** One shared pass for NPC and mob text. Only text visibility is changed; world state is untouched. */
export class ScreenLabelLayout {
  private candidates = new Map<string, ScreenLabelCandidate>();

  add(candidate: ScreenLabelCandidate) {
    // Do not briefly show a lower-priority label while the other presenter is still collecting.
    candidate.setVisible(false);
    const { x, y, width, height } = candidate.rect;
    if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return;
    this.candidates.set(candidate.id, { ...candidate, rect: { x, y, width, height }, distance: Number.isFinite(candidate.distance) ? Math.max(0, candidate.distance) : Infinity });
  }

  /** Call after both presenters update. Candidates are released so this collector can be reused next frame. */
  flush(): string[] {
    const candidates = [...this.candidates.values()].sort((a, b) =>
      PRIORITY[b.priority] - PRIORITY[a.priority] || a.distance - b.distance || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    this.candidates.clear();
    const accepted: ScreenLabelCandidate[] = [];
    for (const candidate of candidates) {
      if (accepted.some(other => overlaps(candidate.rect, other.rect))) continue;
      candidate.setVisible(true);
      accepted.push(candidate);
    }
    return accepted.map(candidate => candidate.id);
  }
}
