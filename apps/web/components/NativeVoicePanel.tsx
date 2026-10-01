"use client";
import { useEffect, useRef, useState } from "react";
import type { Room } from "@colyseus/sdk";
import { VOICE_OFF, type NativeMode, type VoiceSettings, type VoiceState, type VoiceToken, type RoomSnapshot } from "@third-space/contracts";
import { NativeVoice, type VoiceUIState } from "../lib/native-voice";
import styles from "./NativeVoicePanel.module.css";
import { usePanelGameFocus } from "../lib/use-panel-game-focus";

const INITIAL: VoiceUIState = { phase: "off", microphone: "off", playbackBlocked: false, error: "", devices: [] };
export default function NativeVoicePanel({ room, connected, snapshot, personVolumes, mutedIds }: {
  room: Room | null; connected: boolean; snapshot: RoomSnapshot | null;
  personVolumes: Record<string, number>; mutedIds: string[];
}) {
  const [ui, setUI] = useState(INITIAL), [state, setState] = useState<VoiceState | null>(null);
  const [settings, setSettings] = useState<VoiceSettings>({ ...VOICE_OFF });
  const [master, setMaster] = useState(.8), [device, setDevice] = useState("");
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDetailsElement>(null);
  usePanelGameFocus(open, "[data-native-voice-panel]", '[aria-label="Native voice controls"]');
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => { if (!panel.current?.contains(event.target as Node) && panel.current) panel.current.open = false; };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && panel.current) { event.preventDefault(); panel.current.open = false; } };
    document.addEventListener("pointerdown", dismiss); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("keydown", escape); };
  }, [open]);
  const controller = useRef<NativeVoice | null>(null);
  const settingsRef = useRef(settings);
  const pending = useRef<{ id: string; resolve(value: VoiceToken): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> } | null>(null);
  const names = new Map((snapshot?.members ?? snapshot?.players ?? []).map(p => [p.id, p.name]));

  useEffect(() => {
    if (!room || !connected) return;
    let disposed = false;
    const voice = new NativeVoice(() => new Promise<VoiceToken>((resolve, reject) => {
      const id = crypto.randomUUID();
      const timer = setTimeout(() => { if (pending.current?.id === id) pending.current = null; reject(new Error("Voice token timed out.")); }, 8000);
      pending.current = { id, resolve, reject, timer }; room.send("voice.join", { requestId: id });
    }), value => { if (!disposed) setUI(value); }, undefined,
      (identity, version) => room.send("voice.policy.ack", { identity, version }));
    controller.current = voice;
    const token = room.onMessage("voice.token", (value: VoiceToken & { error?: string }) => {
      const request = pending.current; if (!request || value.requestId !== request.id) return;
      clearTimeout(request.timer); pending.current = null;
      if (value.error) request.reject(new Error(value.error)); else request.resolve(value);
    });
    const status = room.onMessage("voice.state", (value: VoiceState) => { setState(value); voice.updateState(value); });
    const timer = setInterval(() => voice.checkFreshness(), 500);
    const devices = () => { void voice.refreshDevices(); };
    navigator.mediaDevices?.addEventListener("devicechange", devices);
    void voice.refreshDevices();
    room.send("voice.refresh");
    return () => {
      disposed = true; token(); status(); clearInterval(timer);
      navigator.mediaDevices?.removeEventListener("devicechange", devices);
      voice.stop(); if (controller.current === voice) controller.current = null;
      if (pending.current) { clearTimeout(pending.current.timer); pending.current.reject(new Error("Room connection ended.")); pending.current = null; }
    };
  }, [room, connected]);
  useEffect(() => { controller.current?.setMix(master, personVolumes, new Set(mutedIds)); }, [master, personVolumes, mutedIds]);
  useEffect(() => {
    if (!connected) { setUI(INITIAL); setState(null); setSettings({ ...VOICE_OFF }); settingsRef.current = { ...VOICE_OFF }; }
  }, [connected]);
  useEffect(() => {
    if (ui.phase === "error" && settingsRef.current.nativeMode !== "off") {
      const off = { ...settingsRef.current, nativeMode: "off" as const }; settingsRef.current = off; setSettings(off);
      if (connected) room?.send("command", { type: "voice.status", ...off });
    }
  }, [ui.phase, room, connected]);
  const change = (value: VoiceSettings) => {
    settingsRef.current = value; setSettings(value); controller.current?.setSettings(value);
    room?.send("command", { type: "voice.status", ...value });
  };
  const start = (mode: Exclude<NativeMode, "off">) => {
    const value = { ...settingsRef.current, nativeMode: mode, manualMute: false, deafened: false };
    change(value); void controller.current?.start(mode, device || undefined);
  };
  const busy = ui.phase === "permission" || ui.phase === "connecting";
  const available = connected && state?.available === true;
  const heardBy = state?.heardBy ?? [];
  const mic = ui.microphone === "live" ? "Microphone live" : ui.microphone === "pending" ? "Waiting for microphone permission" : ui.microphone === "muted" ? "Microphone muted" : "Microphone off";
  return <details ref={panel} className={styles.voice} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary aria-label="Native voice controls">{mic} · Voice</summary>
    <section className={styles.panel} aria-label="Native voice" data-native-voice-panel data-game-input="off">
    <strong>{mic}</strong> <span role="status">{ui.phase === "reconnecting" ? "Reconnecting voice…" : busy ? "Connecting voice…" : ui.phase === "connected" ? "Voice connected" : "Native voice off"}</span>
    <div className="segmented">
      <button aria-pressed={settings.nativeMode === "off"} onClick={() => change({ ...VOICE_OFF })}>Off · use Discord</button>
      <button disabled={!available || busy} aria-pressed={settings.nativeMode === "listen"} onClick={() => start("listen")}>Listen only</button>
      <button disabled={!available || busy} aria-pressed={settings.nativeMode === "enabled"} onClick={() => start("enabled")}>{ui.phase === "error" ? "Retry microphone" : "Enable microphone"}</button>
    </div>
    <div className="segmented">
      <button disabled={settings.nativeMode !== "enabled" || busy} aria-pressed={settings.manualMute} onClick={() => change({ ...settingsRef.current, manualMute: !settingsRef.current.manualMute })}>{settings.manualMute ? "Unmute microphone" : "Mute microphone"}</button>
      <button disabled={settings.nativeMode === "off" || busy} aria-pressed={settings.deafened} onClick={() => change({ ...settingsRef.current, deafened: !settingsRef.current.deafened })}>{settings.deafened ? "Undeafen" : "Deafen"}</button>
      {busy && <button onClick={() => change({ ...VOICE_OFF })}>Cancel</button>}
      {ui.playbackBlocked && <button onClick={() => { void controller.current?.resumePlayback(); }}>Resume voice audio</button>}
    </div>
    <p className="voice-reach">{!available ? state?.reason ?? "Checking native voice service…" : ui.microphone === "live" ? heardBy.length ? `In hearing range: ${heardBy.map(id => names.get(id) ?? "Friend").join(", ")}` : "No listening friends in range. Move closer or ask the host for room-wide voice." : "Enable your microphone to speak. Listen only never opens it."}</p>
    {!!state?.receive.length && <small>Hearing: {state.receive.map(p => names.get(p.id) ?? "Friend").join(", ")}</small>}
    {ui.error && <p role="alert">{ui.error}</p>}
    <label>Voice volume <input aria-label="Native voice volume" type="range" min="0" max="1" step=".05" value={master} onChange={e => setMaster(Number(e.target.value))}/></label>
    <label>Microphone <select aria-label="Voice microphone device" value={device} onChange={e => setDevice(e.target.value)}><option value="">System default</option>{ui.devices.map((d, i) => <option key={d.deviceId || i} value={d.deviceId}> {d.label || `Microphone ${i + 1}`}</option>)}</select></label>
    <small>After changing devices, choose Enable microphone. Voice volume is separate from game and movie audio. Room-wide voice includes everyone in this party, including interiors and races. Mobile browsers may pause calls when locked; return here to reconnect.</small>
  </section></details>;
}
