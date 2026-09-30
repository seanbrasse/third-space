"use client";
import { useEffect, useRef, useState } from "react";
import type { WorldBridge } from "../lib/types";
export default function World({ bridge }: { bridge: WorldBridge }) {
  const parent = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
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
      aria-label="Multiplayer pixel world. Click or tap open floor to walk there, or use arrow keys and WASD. Click a seat to sit; E interacts with nearby objects. Hover over a friend to see their name, or click their avatar to interact. The people menu offers the same controls with a keyboard."
    >
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
