import type { Snapshot } from "./types";
import { clownStepInterval, werewolfStepInterval, type GameSoundKind } from "./game-sound";
export interface MovementCue { id: string; kind: GameSoundKind; x: number; y: number; interval: number; own: boolean; }
/** Audio shares the listener's physical area, independently of proximity/whole-room voice. */
export function movementAudioCues(snapshot: Snapshot, selfId: string, muted: ReadonlySet<string>): MovementCue[] {
    const self = snapshot.players.find(p => p.id === selfId);
    if (!self || !self.connected || self.respawnAt) return [];
    const cues: MovementCue[] = [];
    for (const p of snapshot.players) {
        if (!p.connected || p.respawnAt || p.seatId || p.mode !== self.mode || p.zone !== self.zone
            || (p.mode === "race" && !p.grounded) || Math.hypot(p.vx, p.vy) < .2 || muted.has(p.id)) continue;
        cues.push({ id: p.id, kind: "player-step", x: p.x, y: p.y, interval: 390, own: p.id === selfId });
    }
    if (self.mode !== "home" || self.zone || snapshot.worldId !== "forest") return cues;
    for (const [id, state, kind, stride] of [
        ["clown", snapshot.stalker, "clown-step", clownStepInterval],
        ["werewolf", snapshot.werewolf, "werewolf-step", werewolfStepInterval],
    ] as const) {
        if (state?.phase !== "chase") continue;
        const target = snapshot.players.find(p => p.id === state.targetId);
        const distance = target ? Math.hypot(state.x - target.x, state.y - target.y) : 10;
        cues.push({ id, kind, x: state.x, y: state.y, interval: stride(distance), own: false });
    }
    return cues;
}
