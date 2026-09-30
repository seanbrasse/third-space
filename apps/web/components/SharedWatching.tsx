"use client";
import { useEffect, useRef, useState } from "react";
import { getWorld } from "@third-space/config";
import type { Snapshot } from "../lib/types";
export default function SharedWatching({ snapshot, getSnapshot, selfId, expanded, onExpand, send }: {
    snapshot: Snapshot | null;
    getSnapshot: () => Snapshot | null;
    selfId: string;
    expanded: boolean;
    onExpand: (v: boolean) => void;
    send: (v: Record<string, unknown>) => void;
}) {
    const video = useRef<HTMLVideoElement>(null), anchor = useRef({ server: 0, client: 0 }), [box, setBox] = useState({ left: 0, top: 0, width: 0, height: 0, clip: "inset(0px)" }), [url, setUrl] = useState(""), [seek, setSeek] = useState("0"), [volume, setVolume] = useState(.7), [error, setError] = useState("");
    const self = snapshot?.players.find(p => p.id === selfId), surface = getWorld(snapshot?.worldId).mediaSurface, host = snapshot?.hostId === selfId;
    const latest = useRef({ snapshot, self, expanded, volume, surface, getSnapshot, selfId });
    useEffect(() => { latest.current = { snapshot, self, expanded, volume, surface, getSnapshot, selfId }; }, [snapshot, self, expanded, volume, surface, getSnapshot, selfId]);
    const near = !!self && self.mode === "home" && Math.hypot(self.x - surface.source.x, self.y - surface.source.y) < 12;
    useEffect(() => { if (snapshot)
        anchor.current = { server: snapshot.serverTime, client: Date.now() }; }, [snapshot?.serverTime]);
    useEffect(() => {
        const project = () => {
            if (document.hidden)
                return;
            const world = document.querySelector<HTMLElement>(".world-canvas"), canvas = world?.querySelector("canvas"), shell = world?.closest(".world-shell");
            if (!world || !canvas || !shell)
                return;
            const b = canvas.getBoundingClientRect(), s = shell.getBoundingClientRect(), d = world.dataset, z = Number(d.cameraZoom), t = Number(d.tileSize);
            const x = (surface.x * t - Number(d.cameraScrollX)) * z, y = (surface.y * t - Number(d.cameraScrollY)) * z, w = surface.width * t * z, h = (surface.height * t - 12) * z;
            if (![x, y, w, h].every(Number.isFinite) || !z || !t)
                return;
            const clip = `inset(${Math.max(0, -y)}px ${Math.max(0, x + w - b.width)}px ${Math.max(0, y + h - b.height)}px ${Math.max(0, -x)}px)`;
            setBox({ left: b.left - s.left + x, top: b.top - s.top + y, width: w, height: h, clip });
        };
        project();
        const timer = setInterval(project, 100);
        return () => clearInterval(timer);
    }, [surface.id]);
    useEffect(() => {
        const timer = setInterval(() => {
            const { expanded, volume, getSnapshot, selfId } = latest.current;
            const snapshot = getSnapshot(), self = snapshot?.players.find(p => p.id === selfId), surface = getWorld(snapshot?.worldId).mediaSurface;
            if (snapshot && snapshot.serverTime !== anchor.current.server)
                anchor.current = { server: snapshot.serverTime, client: Date.now() };
            const v = video.current, m = snapshot?.media;
            if (!v || !m?.url)
                return;
            const serverNow = anchor.current.server + Date.now() - anchor.current.client;
            const target = m.position + (m.playing ? Math.max(0, serverNow - m.anchorAt) / 1000 : 0);
            if (v.readyState > 0 && Math.abs(v.currentTime - target) > .6)
                v.currentTime = Math.min(target, Number.isFinite(v.duration) ? Math.max(0, v.duration - .05) : target);
            if (m.playing && v.paused)
                void v.play().catch(() => setError("Tap the screen to enable playback in this browser."));
            else if (!m.playing && !v.paused)
                v.pause();
            v.volume = Math.max(0, Math.min(1, volume * (expanded ? 1 : Math.max(0, 1 - Math.hypot((self?.x ?? 0) - surface.source.x, (self?.y ?? 0) - surface.source.y) / 12))));
        }, 250);
        return () => clearInterval(timer);
    }, []);
    const control = (action: string, extra: Record<string, unknown> = {}) => { if (snapshot)
        send({ type: "media.control", action, revision: snapshot.media.revision, commandId: crypto.randomUUID(), ...extra }); };
    if (!snapshot || self?.mode !== "home")
        return null;
    return <section className={`shared-watching ${expanded ? "expanded" : "surface"}`} style={expanded ? undefined : { left: box.left + 6, top: box.top + 6, width: Math.max(1, box.width - 12), height: Math.max(1, box.height - 12), visibility: near ? "visible" : "hidden", clipPath: box.clip }} aria-label="Shared screen">
    {expanded && <header><div><small>WATCHING TOGETHER</small><strong>{snapshot.worldId === "forest" ? "Movie night under the pines" : "The lounge screen"}</strong></div><button onClick={() => onExpand(false)} aria-label="Close shared screen">×</button></header>}
    {snapshot.media.url ? <video ref={video} src={snapshot.media.url} playsInline preload="metadata" onClick={() => { void video.current?.play().catch(() => { }); setError(""); if (!expanded)
        onExpand(true); }} onError={() => setError("This video could not play. Choose a supported direct video URL.")}/> : <button className="screen-placeholder" onClick={() => onExpand(true)}><span>▣</span>{expanded ? "Choose something to watch together" : "MOVIE NIGHT"}</button>}
    {expanded && <div className="watching-controls">
      {error && <p role="status">{error}</p>}
      <p>Playback is shared. Your volume is personal. Walking away fades the screen audio.</p>
      <label>Screen volume<input aria-label="Screen volume" type="range" min="0" max="1" step=".05" value={volume} onChange={e => setVolume(Number(e.target.value))}/></label>
      {host ? <><form onSubmit={e => { e.preventDefault(); setError(""); control("source", { url }); }}><label>Direct HTTPS video URL<input aria-label="Direct video URL" type="url" placeholder="https://…/movie.mp4" value={url} onChange={e => setUrl(e.target.value)} required/></label><button>Load for everyone</button></form><div className="watching-actions"><button disabled={!snapshot.media.url} onClick={() => control(snapshot.media.playing ? "pause" : "play")}>{snapshot.media.playing ? "Pause together" : "Play together"}</button><label>Seek (seconds)<input type="number" min="0" max="86400" value={seek} onChange={e => setSeek(e.target.value)}/></label><button disabled={!snapshot.media.url} onClick={() => control("seek", { position: Number(seek) })}>Seek together</button></div></> : <p>The host selects the video and controls playback.</p>}
      <small>Direct MP4, WebM and Ogg video are supported. YouTube and live screen sharing need separate adapters.</small>
    </div>}
  </section>;
}
