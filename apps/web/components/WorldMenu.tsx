"use client";
import { useEffect, useRef, useState } from "react";
import { usePanelGameFocus } from "../lib/use-panel-game-focus";
import { WORLDS } from "@third-space/config";
import type { Snapshot } from "../lib/types";
export default function WorldMenu({ snapshot, send }: {
    snapshot: Snapshot | null;
    send: (v: Record<string, unknown>) => void;
}) {
    const [open, setOpen] = useState(false), [now, setNow] = useState(Date.now());
    const toggle=useRef<HTMLButtonElement>(null),panel=useRef<HTMLElement>(null);
    usePanelGameFocus(open,".world-destinations",".world-menu-toggle");
    useEffect(()=>{if(!open)return;const escape=(event:KeyboardEvent)=>{const active=document.activeElement;if(event.key==="Escape"&&!event.defaultPrevented&&(panel.current?.contains(active)||toggle.current===active)){event.preventDefault();setOpen(false);}};document.addEventListener("keydown",escape);return()=>document.removeEventListener("keydown",escape);},[open]);
    useEffect(()=>{if(!open)return;const dismiss=(event:PointerEvent)=>{const target=event.target as Node|null;if(target&&!panel.current?.contains(target)&&!toggle.current?.contains(target))setOpen(false);};document.addEventListener("pointerdown",dismiss,true);return()=>document.removeEventListener("pointerdown",dismiss,true);},[open]);
    const anchor = useRef({ server: snapshot?.serverTime ?? Date.now(), client: Date.now() });
    useEffect(() => { if (snapshot)
        anchor.current = { server: snapshot.serverTime, client: Date.now() }; }, [snapshot?.serverTime]);
    const proposal = snapshot?.worldProposal;
    useEffect(() => { if (!proposal)
        return; const timer = setInterval(() => setNow(Date.now()), 200); return () => clearInterval(timer); }, [proposal?.id]);
    const remaining = proposal ? Math.max(0, Math.ceil((proposal.endsAt - (anchor.current.server + now - anchor.current.client)) / 1000)) : 0;
    return <>
    <button ref={toggle} className="world-menu-toggle" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls="world-destinations">☷ Worlds</button>
    {open && <aside ref={panel} className="world-destinations" id="world-destinations" aria-label="Choose a world">
      <div className="world-menu-heading"><span>Somewhere together</span><button aria-label="Close worlds" onClick={() => setOpen(false)}>×</button></div>
      <p>Midnight Pines is our campsite for now.</p>
      {Object.values(WORLDS).filter(w=>w.id==="forest").map(w => <button key={w.id} className={`world-destination ${w.id === (snapshot?.rootWorldId??snapshot?.worldId) ? "selected" : ""}`} disabled={!snapshot || !!proposal || w.id === (snapshot.rootWorldId??snapshot.worldId)} onClick={() => send({ type: "world.propose", worldId: w.id, revision: snapshot!.worldRevision, commandId: crypto.randomUUID() })}>
        <span className="world-destination-icon">{w.dark ? "☾" : "⌂"}</span><strong>{w.name}</strong><small>{w.description}</small><em>{w.id === (snapshot?.rootWorldId??snapshot?.worldId) ? "You are here" : "Travel here →"}</em>
      </button>)}
    </aside>}
    {proposal && <div className="world-proposal" role="status"><div><small>A FRIEND SUGGESTED</small><strong>{WORLDS[proposal.worldId].name}</strong><span>Everyone moves together in {remaining}s</span></div><button onClick={() => send({ type: "world.object", proposalId: proposal.id })}>Stay here · object</button></div>}
  </>;
}
