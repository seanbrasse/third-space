"use client";
import { sprintStatus } from "@third-space/simulation";
import type { Snapshot } from "../lib/types";

export default function StaminaBar({ snapshot, selfId }: { snapshot: Snapshot | null; selfId: string }) {
  const player = snapshot?.players.find(p => p.id === selfId);
  if (!snapshot || !player || player.mode !== "home") return null;
  const status = sprintStatus(player, snapshot.serverTime);
  const percent = Math.round(status.fraction * 100);
  const label = status.phase === "exhausted" ? "Out of breath" : status.phase === "boosting" ? "Sprinting" : status.phase === "refilling" ? "Refilling" : "Hold Space · Sprint";
  return <div className="stamina-hud" data-phase={status.phase}>
    <span>Stamina</span>
    <div className="stamina-track" role="progressbar" aria-label="Sprint stamina" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={status.phase === "ready" ? "Full. Hold Space while moving to sprint. Release to keep your remaining stamina." : label + " · " + percent + "%"}>
      <div className="stamina-fill" style={{ width: percent + "%" }} />
    </div>
    <span>{label}</span>
  </div>;
}
