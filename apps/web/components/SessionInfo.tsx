"use client";
import { useEffect, useState } from "react";
import { api, type Home } from "../lib/types";
import { rememberSessionPin, readSessionPin, sessionPinStorage } from "../lib/session-pin";

export default function SessionInfo({ home, profileId }: { home: Home; profileId: string }) {
  const [open, setOpen] = useState(false);
  const [known, setKnown] = useState("");
  const [draft, setDraft] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(true);
  const [enabled, setEnabled] = useState(home.pinEnabled !== false);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setChecking(true);
    setKnown("");
    setRevealed(false);
    setMessage("");
    void api<{ home: Home }>(`/homes/${home.id}`).then(({ home: current }) => {
      if (!active) return;
      setEnabled(current.pinEnabled !== false);
      setKnown(readSessionPin(sessionPinStorage(), profileId, home.id, current.settingsRevision));
    }).catch(() => {
      if (active) setMessage("Could not check the current PIN. Try reopening session info.");
    }).finally(() => {
      if (active) setChecking(false);
    });
    return () => { active = false; };
  }, [open, home.id, home.settingsRevision, profileId]);

  async function verify() {
    setBusy(true);
    setMessage("");
    try {
      const { home: current } = await api<{ home: Home }>(`/homes/${home.id}/join`, "POST", { pin: draft });
      rememberSessionPin(sessionPinStorage(), profileId, home.id, current.settingsRevision, draft);
      setKnown(draft);
      setDraft("");
      setMessage("PIN verified for sharing.");
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setMessage("Copied.");
    } catch {
      setMessage("Copy is unavailable here. Reveal the PIN to share it manually.");
    }
  }

  return (
    <div style={{ position: "relative" }}>
      <button className="secondary" onClick={() => setOpen(v => !v)} aria-expanded={open}>Session info</button>
      {open && (
        <section aria-label="Session info" style={{ position: "absolute", right: 0, top: "100%", zIndex: 60, width: "min(320px,85vw)", padding: 16, background: "var(--surface, #24382c)", border: "1px solid currentColor", borderRadius: 12, display: "grid", gap: 10 }}>
          <h3>{home.name}</h3>
          <label>Home ID<input readOnly value={home.id}/></label>
          <button onClick={() => void copy(home.id)}>Copy home ID</button>
          {checking ? <p role="status">Checking session info…</p> : !enabled ? (
            <p>This campsite uses invitations instead of a room PIN.</p>
          ) : known ? (
            <>
              <label>Room PIN<input readOnly type={revealed ? "text" : "password"} value={known}/></label>
              <button onClick={() => setRevealed(v => !v)}>{revealed ? "Hide PIN" : "Reveal PIN"}</button>
              <button onClick={() => void copy(known)}>Copy PIN</button>
              <small>Share only with friends you want to admit. Remembered in this browser tab.</small>
            </>
          ) : (
            <>
              <p>The PIN is not remembered in this tab. Re-enter it to verify and remember it here, or ask the owner for the PIN or an invite.</p>
              <label>Room PIN<input type="password" inputMode="numeric" maxLength={12} value={draft} onChange={e => setDraft(e.target.value)} autoComplete="off"/></label>
              <button disabled={busy || !/^\d{6,12}$/.test(draft)} onClick={() => void verify()}>{busy ? "Verifying…" : "Verify PIN"}</button>
            </>
          )}
          {message && <p role="status">{message}</p>}
          <button onClick={() => setOpen(false)}>Close</button>
        </section>
      )}
    </div>
  );
}
