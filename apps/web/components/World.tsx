"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { WorldBridge } from "../lib/types";
export default function World({ bridge, children }: { bridge: WorldBridge; children?: ReactNode }) {
  const parent = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  const [rendered, setRendered] = useState("");
  const renderedId = useRef("");
  const expected = bridge.snapshot?.instanceId ?? "";
  useEffect(() => {
    const el = parent.current;
    const ready = (event: Event) => { const id = (event as CustomEvent).detail.instanceId as string; if(renderedId.current !== id){renderedId.current=id;setRendered(id);} };
    el?.addEventListener("third-space:projection", ready);
    return () => el?.removeEventListener("third-space:projection", ready);
  }, []);
  useEffect(() => {
    let disposed = false;
    let game: { destroy: (removeCanvas: boolean) => void } | undefined;
    void import("../lib/scene")
      .then(async ({ createWorld }) => {
        if (!disposed && parent.current) {
          const created = await createWorld(parent.current, bridge);
          if (disposed) created.destroy(true);
          else game = created;
        }
      })
      .catch((error: Error) => {
        if (!disposed)
          setError(
            error.message ||
              "The world renderer did not start. Reload to retry.",
          );
      });
    return () => {
      disposed = true;
      game?.destroy(true);
    };
  }, [bridge]);
  return (
    <div
      className="world-canvas"
      ref={parent}
      role="application"
      tabIndex={0}
      aria-label="Multiplayer pixel world. Use arrow keys or WASD to move and the mouse to aim. E interacts with nearby objects and seats. Touch controls and taps on open floor move on touch screens. Hover over a friend to see their name, or click their avatar to interact. The people menu offers the same controls with a keyboard."
    >
      {children}
      {!error && (!expected || rendered !== expected) && <div className="world-busy" role="status"><span className="loading-spinner" aria-hidden="true"/>Preparing your space…</div>}
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
