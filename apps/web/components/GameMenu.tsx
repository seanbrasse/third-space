"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePanelGameFocus } from "../lib/use-panel-game-focus";

export default function GameMenu({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLElement>(null);
  usePanelGameFocus(open, ".game-menu-panel", ".game-menu-toggle");
  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setOpen(false); }
      if (event.key !== "Tab" || !panel.current) return;
      const nodes = [...panel.current.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href],[tabindex="0"]')].filter(node=>node.getClientRects().length>0);
      const first = nodes[0], last = nodes[nodes.length-1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [open]);
  return <>
    <button className="secondary game-menu-toggle" aria-expanded={open} aria-controls="game-menu-panel" onClick={()=>setOpen(v=>!v)}>☰ Game menu</button>
    {open && <div className="game-menu-backdrop" onPointerDown={e=>{if(e.target===e.currentTarget)setOpen(false);}}>
      <aside ref={panel} id="game-menu-panel" className="game-menu-panel" role="dialog" aria-modal="true" aria-label="Game menu">
        <header><h2>Around the campfire</h2><button aria-label="Close game menu" onClick={()=>setOpen(false)}>×</button></header>
        <div onClick={e=>{if((e.target as Element).closest('[data-close-game-menu="true"]'))setOpen(false);}}>{children}</div>
      </aside>
    </div>}
  </>;
}
