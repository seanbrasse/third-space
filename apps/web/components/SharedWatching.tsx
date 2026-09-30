"use client";
import { useEffect, useRef, useState } from "react";
import { getWorld, resolveMediaLink } from "@third-space/config";
import YouTubeWatching from "./YouTubeWatching";
import type { Snapshot } from "../lib/types";
export default function SharedWatching({ snapshot, getSnapshot, selfId, expanded, onExpand, send }: {
    snapshot: Snapshot | null;
    getSnapshot: () => Snapshot | null;
    selfId: string;
    expanded: boolean;
    onExpand: (v: boolean) => void;
    send: (v: Record<string, unknown>) => void;
}) {
    const video = useRef<HTMLVideoElement>(null), anchor = useRef({ server: 0, client: 0 }), [url, setUrl] = useState(""), [seek, setSeek] = useState("0"), [volume, setVolume] = useState(.7), [error, setError] = useState(""), [buffering, setBuffering] = useState(false);
    const screen = useRef<HTMLElement>(null);
    const source = snapshot?.media.url ? resolveMediaLink(snapshot.media.url) : null;
    const self = snapshot?.players.find(p => p.id === selfId), surface = getWorld(snapshot?.worldId).mediaSurface, host = snapshot?.hostId === selfId;
    const latest = useRef({ snapshot, self, expanded, volume, surface, getSnapshot, selfId });
    useEffect(() => { latest.current = { snapshot, self, expanded, volume, surface, getSnapshot, selfId }; }, [snapshot, self, expanded, volume, surface, getSnapshot, selfId]);
    const near = !!self && self.mode === "home" && Math.hypot(self.x - surface.source.x, self.y - surface.source.y) < 12;
    useEffect(() => {
        if (snapshot)
            anchor.current = { server: snapshot.serverTime, client: Date.now() };
    }, [snapshot?.serverTime]);
    useEffect(() => {
        const project = (event: Event) => {
            const el = screen.current;
            if (!el || latest.current.expanded || document.hidden)
                return;
            const world = event.target as HTMLElement, canvas = world.querySelector("canvas"), shell = world.closest(".world-shell");
            if (!canvas || !shell)
                return;
            const d = (event as CustomEvent).detail, b = canvas.getBoundingClientRect(), s = shell.getBoundingClientRect();
            const x = d.x + 6, y = d.y + 6, w = Math.max(1, d.width - 12), h = Math.max(1, d.height - 12);
            el.style.transform = `translate3d(${b.left - s.left + x}px,${b.top - s.top + y}px,0)`;
            el.style.width = w + "px";
            el.style.height = h + "px";
            el.style.clipPath = `inset(${Math.max(0, -y)}px ${Math.max(0, x + w - b.width)}px ${Math.max(0, y + h - b.height)}px ${Math.max(0, -x)}px)`;
        };
        document.addEventListener("third-space:projection", project);
        return () => document.removeEventListener("third-space:projection", project);
    }, []);
    useEffect(() => { if (expanded && screen.current) {
        screen.current.style.transform = "";
        screen.current.style.width = "";
        screen.current.style.height = "";
        screen.current.style.clipPath = "";
    } }, [expanded]);
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
    const control = (action: string, extra: Record<string, unknown> = {}) => {
        const current = getSnapshot() ?? snapshot;
        if (current)
            send({ type: "media.control", action, revision: current.media.revision, commandId: crypto.randomUUID(), ...extra });
    };
    if (!snapshot || self?.mode !== "home")
        return null;
    return <section ref={screen} className={`shared-watching ${expanded ? "expanded" : "surface"}`} style={expanded ? undefined : { left: 0, top: 0, visibility: near ? "visible" : "hidden" }} aria-label="Shared screen">
    {expanded && <header><div><small>WATCHING TOGETHER</small><strong>{snapshot.worldId === "forest" ? "Movie night under the pines" : "The lounge screen"}</strong></div><button onClick={() => onExpand(false)} aria-label="Close shared screen">×</button></header>}
    {source?.kind === "youtube" ? (expanded ? <YouTubeWatching key={source.videoId} videoId={source.videoId} getSnapshot={getSnapshot} selfId={selfId} volume={volume} onError={setError}/> : <button className="screen-placeholder" onClick={() => onExpand(true)}><span>▶</span>YOUTUBE · OPEN SCREEN</button>) : snapshot.media.url ? <video ref={video} src={snapshot.media.url} onLoadStart={()=>setBuffering(true)} onWaiting={()=>setBuffering(true)} onCanPlay={()=>setBuffering(false)} onPlaying={()=>setBuffering(false)} playsInline preload="metadata" onClick={() => { void video.current?.play().catch(() => { }); setError(""); if (!expanded)
        onExpand(true); }} onError={() => {setBuffering(false);setError("This link could not play. Try a YouTube video or another video file.");}}/> : <button className="screen-placeholder" onClick={() => onExpand(true)}><span>▣</span>{expanded ? "Paste a link to start movie night" : "MOVIE NIGHT"}</button>}
    {buffering && source?.kind === "file" && <div className="media-loading" role="status"><span className="loading-spinner" aria-hidden="true"/>Loading video…</div>}
    {expanded && <div className="watching-controls">
      {error && <p role="status">{error}</p>}
      <p>Playback is shared. Your volume is personal. Walking away fades video-file audio. Keep the screen open to watch YouTube.</p>
      <label>Screen volume<input aria-label="Screen volume" type="range" min="0" max="1" step=".05" value={volume} onChange={e => setVolume(Number(e.target.value))}/></label>
      {host ? <><form onSubmit={e => { e.preventDefault(); setError(""); control("source", { url }); }}><label>Paste a video link<input aria-label="Video link" type="url" placeholder="YouTube link or video file link" value={url} onChange={e => setUrl(e.target.value)} required/></label><button>Load for everyone</button></form><div className="watching-actions"><button disabled={!snapshot.media.url} onClick={() => control(snapshot.media.playing ? "pause" : "play")}>{snapshot.media.playing ? "Pause together" : "Play together"}</button><label>Seek (seconds)<input type="number" min="0" max="86400" value={seek} onChange={e => setSeek(e.target.value)}/></label><button disabled={!snapshot.media.url} onClick={() => control("seek", { position: Number(seek) })}>Seek together</button></div></> : <p>The host selects the video and controls playback.</p>}
      <small>Paste a YouTube watch/share/Shorts link, or a link to an MP4, WebM or Ogg file. Other website pages and live screen sharing are not supported yet.</small>
    </div>}
  </section>;
}
