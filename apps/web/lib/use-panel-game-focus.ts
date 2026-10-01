"use client";
import { useEffect, useLayoutEffect, useRef } from "react";
import { restoreGameFocus } from "./game-focus";

/** Shared close lifecycle for buttons, toggles, Escape and outside dismissal. */
export function usePanelGameFocus(open: boolean, panelSelector: string,
  triggerSelector?: string, restoreFullscreenExit = false): void {
  const previous = useRef(open), owner = useRef<Element | null>(null);
  useLayoutEffect(() => {
    const panel = document.querySelector(panelSelector);
    if (open) owner.current = panel;
    let cancel: (() => void) | undefined;
    if (previous.current && !open)
      cancel = restoreGameFocus([owner.current, panel, triggerSelector ? document.querySelector(triggerSelector) : null]);
    previous.current = open;
    return () => cancel?.();
  }, [open, panelSelector, triggerSelector]);

  useEffect(() => {
    if (!restoreFullscreenExit) return;
    let wasFullscreen = false, cancel: (() => void) | undefined;
    const change = () => {
      const panel = document.querySelector(panelSelector);
      const current = !!panel && document.fullscreenElement === panel;
      if (wasFullscreen && !document.fullscreenElement) cancel = restoreGameFocus([panel]);
      wasFullscreen = current;
    };
    document.addEventListener("fullscreenchange", change);
    return () => { document.removeEventListener("fullscreenchange", change); cancel?.(); };
  }, [panelSelector, restoreFullscreenExit]);
}
