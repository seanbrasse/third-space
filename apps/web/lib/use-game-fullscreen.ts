"use client";
import { useEffect, useRef, useState } from "react";
import { toggleGameFullscreen } from "./game-fullscreen";
import { restoreGameFocus } from "./game-focus";

export function useGameFullscreen(enabled: boolean) {
  const ref = useRef<HTMLElement>(null);
  const [active, setActive] = useState(false), [supported, setSupported] = useState(false), [error, setError] = useState("");
  useEffect(() => {
    setSupported(!!document.fullscreenEnabled && typeof ref.current?.requestFullscreen === "function");
    let previous = false, cancel: (()=>void) | undefined;
    const change = () => {
      const next = document.fullscreenElement === ref.current;
      setActive(next);
      if (previous && !document.fullscreenElement) cancel = restoreGameFocus([ref.current]);
      previous = next;
    };
    document.addEventListener("fullscreenchange", change);
    change();
    return () => { document.removeEventListener("fullscreenchange", change); cancel?.(); };
  }, []);
  useEffect(() => {
    if (!enabled && ref.current && document.fullscreenElement === ref.current)
      void document.exitFullscreen().catch(() => { /* Browser may have exited already. */ });
  }, [enabled]);
  const toggle = async () => {
    setError("");
    if (!ref.current) return;
    try { await toggleGameFullscreen(ref.current); }
    catch { setError("Fullscreen could not open. Keep playing here, or try your browser’s fullscreen option."); }
  };
  return { ref, active, supported, error, toggle };
}
