"use client";
import { useEffect, useRef, useState } from "react";
import { WORLDS } from "@third-space/config";
import type { Snapshot } from "../lib/types";
export default function WorldMenu({ snapshot, send }: {
    snapshot: Snapshot | null;
    send: (v: Record<string, unknown>) => void;
}) {
    const [open, setOpen] = useState(false), [now, setNow] = useState(Date.now());
    const anchor = useRef({ server: snapshot?.serverTime ?? Date.now(), client: Date.now() });
    useEffect(() => { if (snapshot)
        anchor.current = { server: snapshot.serverTime, client: Date.now() }; }, [snapshot?.serverTime]);
    const proposal = snapshot?.worldProposal;
    useEffect(() => { if (!proposal)
        return; const timer = setInterval(() => setNow(Date.now()), 200); return () => clearInterval(timer); }, [proposal?.id]);
    const remaining = proposal ? Math.max(0, Math.ceil((proposal.endsAt - (anchor.current.server + now - anchor.current.client)) / 1000)) : 0;
    return <>
    <button className="world-menu-toggle" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls="world-destinations">☷ Worlds</button>
    {open && <aside className="world-destinations" id="world-destinations" aria-label="Choose a world">
      <div className="world-menu-heading"><span>Somewhere together</span><button aria-label="Close worlds" onClick={() => setOpen(false)}>×</button></div>
      <p>Suggest a change. Everyone gets eight seconds to object.</p>
      {Object.values(WORLDS).map(w => <button key={w.id} className={`world-destination ${w.id === snapshot?.worldId ? "selected" : ""}`} disabled={!snapshot || !!proposal || w.id === snapshot.worldId} onClick={() => send({ type: "world.propose", worldId: w.id, revision: snapshot!.worldRevision, commandId: crypto.randomUUID() })}>
        <span className="world-destination-icon">{w.dark ? "☾" : "⌂"}</span><strong>{w.name}</strong><small>{w.description}</small><em>{w.id === snapshot?.worldId ? "You are here" : "Suggest this world →"}</em>
      </button>)}
    </aside>}
    {proposal && <div className="world-proposal" role="status"><div><small>A FRIEND SUGGESTED</small><strong>{WORLDS[proposal.worldId].name}</strong><span>Everyone moves together in {remaining}s</span></div><button onClick={() => send({ type: "world.object", proposalId: proposal.id })}>Stay here · object</button></div>}
  </>;
}
