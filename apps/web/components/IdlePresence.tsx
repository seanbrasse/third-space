'use client';
import { useEffect, useRef, useState } from 'react';
import type { Snapshot } from '../lib/types';
export function useIdleActivity(send: (command: Record<string, unknown>) => void, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    let lastInput = -Infinity, lastWatching = -Infinity;
    const activity = (event: Event) => {
      if (!event.isTrusted || document.hidden || Date.now() - lastInput < 1000) return;
      lastInput = Date.now(); send({ type: 'presence.activity' });
    };
    const watching = (event: Event) => {
      const playbackId = (event as CustomEvent<{ playbackId?: string }>).detail?.playbackId;
      if (document.hidden || !playbackId || Date.now() - lastWatching < 5000) return;
      lastWatching = Date.now(); send({ type: 'presence.watching', playbackId });
    };
    for (const type of ['pointerdown', 'pointermove', 'keydown', 'wheel']) document.addEventListener(type, activity, { passive: true });
    document.addEventListener('third-space:watching', watching);
    return () => {
      for (const type of ['pointerdown', 'pointermove', 'keydown', 'wheel']) document.removeEventListener(type, activity);
      document.removeEventListener('third-space:watching', watching);
    };
  }, [send, enabled]);
}
export default function IdlePresence({ snapshot, send }: { snapshot: Snapshot | null; send: (command: Record<string, unknown>) => void }) {
  const anchor = useRef({ server: 0, client: 0 });
  const [, render] = useState(0);
  useEffect(() => { if (snapshot) anchor.current = { server: snapshot.serverTime, client: Date.now() }; }, [snapshot?.serverTime]);
  useEffect(() => { const timer = setInterval(() => render(value => value + 1), 1000); return () => clearInterval(timer); }, []);
  const now = anchor.current.server + Date.now() - anchor.current.client;
  const idle = snapshot?.idle;
  if (!idle || now < idle.warningAt) return null;
  const seconds = Math.max(0, Math.ceil((idle.kickAt - now) / 1000));
  return <aside role="alert" aria-label="Inactivity warning" style={{ position: 'fixed', zIndex: 10000, left: '50%', bottom: 24, transform: 'translateX(-50%)', width: 'min(440px, calc(100vw - 32px))', padding: 20, borderRadius: 16, background: '#26392d', color: '#f4f4e7', border: '1px solid #bdc6a9', boxShadow: '0 8px 40px #0008' }}>
    <strong>Still here?</strong><p>You have been inactive for 15 minutes. Move, interact, or confirm below to stay. You will leave this session in {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}.</p>
    <button onClick={() => send({ type: 'presence.stay' })}>I’m here — stay in the campsite</button>
  </aside>;
}
