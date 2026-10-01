"use client";
import { sprintStatus, SPRINT } from "@third-space/simulation";
import type { Snapshot } from "../lib/types";

export default function StaminaBar({ snapshot, selfId }: { snapshot: Snapshot | null; selfId: string }) {
  const player = snapshot?.players.find(p => p.id === selfId);
  if (!snapshot || !player || player.mode !== "home") return null;
  const status = sprintStatus(player, snapshot.serverTime);
  const percent = Math.round(status.fraction * 100);
  const label = status.phase === "boosting" ? "Boosting" : status.phase === "refilling" ? "Refilling" : "Space · Boost";
  return <div className="stamina-hud" data-phase={status.phase}>
    <span>Stamina</span>
    <div className="stamina-track" role="progressbar" aria-label="Sprint stamina" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={status.phase === "ready" ? "Full. Tap Space for a " + SPRINT.durationMs / 1000 + " second boost." : label + " · " + percent + "%"}>
      <div className="stamina-fill" style={{ width: percent + "%" }} />
    </div>
    <span>{label}</span>
  </div>;
}
