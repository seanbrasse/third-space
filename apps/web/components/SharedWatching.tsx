"use client";
import { useEffect, useRef, useState } from "react";
import { usePanelGameFocus } from "../lib/use-panel-game-focus";
import { getWorld, resolveMediaLink } from "@third-space/config";
import { reportVisiblePlayback } from "../lib/watching-presence";
import YouTubeWatching, { type YouTubePlaybackHandle } from "./YouTubeWatching";
import { playFromUserGesture, sharedPlaybackPosition } from "../lib/watching-controls";
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
    usePanelGameFocus(expanded, ".shared-watching", undefined, true);
    const youtube = useRef<YouTubePlaybackHandle>(null), fileBlocked = useRef<string | null>(null);
    const [blockedPlayback, setBlockedPlayback] = useState<string | null>(null);
    const playbackId = snapshot?.media.playbackId ?? snapshot?.media.url ?? "";
    const deviceBlocked = !!playbackId && blockedPlayback === playbackId;
    const source = snapshot?.media.url ? resolveMediaLink(snapshot.media.url) : null;
    const self = snapshot?.players.find(p => p.id === selfId), surface = getWorld(snapshot?.worldId).mediaSurface;
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
            const x = d.x, y = d.y, w = Math.max(1, d.width), h = Math.max(1, d.height);
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
            reportVisiblePlayback(v, !v.paused && !v.ended && !v.seeking && v.readyState >= 3, m.playbackId);
            const serverNow = anchor.current.server + Date.now() - anchor.current.client;
            const target = m.position + (m.playing ? Math.max(0, serverNow - m.anchorAt) / 1000 : 0);
            if (v.readyState > 0 && Math.abs(v.currentTime - target) > .6)
                v.currentTime = Math.min(target, Number.isFinite(v.duration) ? Math.max(0, v.duration - .05) : target);
            if (m.playing && v.paused && fileBlocked.current !== (m.playbackId ?? m.url))
                void v.play().catch(() => {fileBlocked.current=m.playbackId??m.url;setBlockedPlayback(m.playbackId??m.url);});
            else if (!m.playing && !v.paused)
                v.pause();
            v.volume = Math.max(0, Math.min(1, volume * (expanded ? 1 : Math.max(0, 1 - Math.hypot((self?.x ?? 0) - surface.source.x, (self?.y ?? 0) - surface.source.y) / 12))));
        }, 250);
        return () => clearInterval(timer);
    }, []);
    useEffect(()=>{
      if(!expanded)return;
      const outside=(event:PointerEvent)=>{if(screen.current&&!screen.current.contains(event.target as Node)&&document.fullscreenElement!==screen.current)onExpand(false);};
      const escape=(event:KeyboardEvent)=>{if(event.key!=="Escape")return;if(document.fullscreenElement===screen.current){event.preventDefault();void document.exitFullscreen().catch(()=>{});return;}onExpand(false);};
      document.addEventListener("pointerdown",outside);document.addEventListener("keydown",escape);
      return()=>{document.removeEventListener("pointerdown",outside);document.removeEventListener("keydown",escape);};
    },[expanded,onExpand]);
    useEffect(()=>{if(!expanded&&screen.current&&document.fullscreenElement===screen.current)void document.exitFullscreen().catch(()=>{});},[expanded]);
    const control = (action: string, extra: Record<string, unknown> = {}) => {
        const current = getSnapshot() ?? snapshot;
        if (!current) return;
        const sendCommand = () =>
            send({ type: "media.control", action, revision: current.media.revision, commandId: crypto.randomUUID(), ...extra });
        if (action === "play" || action === "resume") {
            const localOnly = action === "resume";
            action = "play";
            playFromUserGesture(current.media.playing, () => {
                setError("");
                if (youtube.current) {
                    if (!youtube.current.playFromGesture()) setError("The player is still loading. Tap play again when it is ready.");
                } else if (video.current) {
                    const id = current.media.playbackId ?? current.media.url;
                    // Align this explicit recovery tap, then play while its gesture is active.
                    const serverNow = current.serverTime === anchor.current.server ? anchor.current.server + Date.now() - anchor.current.client : current.serverTime;
                    const target = sharedPlaybackPosition(current.media, serverNow);
                    if (video.current.readyState > 0 && Math.abs(video.current.currentTime - target) > .35)
                        video.current.currentTime = Math.min(target, Number.isFinite(video.current.duration) ? Math.max(0, video.current.duration - .05) : target);
                    void video.current.play().catch(() => {fileBlocked.current=id;setBlockedPlayback(id);});
                }
            }, sendCommand, localOnly);
            return;
        }
        sendCommand();
    };
    if (!snapshot || self?.mode !== "home" || getWorld(snapshot.worldId).mediaEnabled===false)
        return null;
    return <section ref={screen} className={`shared-watching ${expanded ? "expanded" : "surface"}`} style={expanded ? undefined : { left: 0, top: 0, visibility: near ? "visible" : "hidden" }} aria-label="Shared screen">
    {expanded && <header><div><small>WATCHING TOGETHER</small><strong>{snapshot.worldId === "asylum" ? "The asylum projector" : "The campsite TV"}</strong></div><button onClick={() => onExpand(false)} aria-label="Close shared screen">×</button></header>}
    {source?.kind === "youtube" ? <YouTubeWatching ref={youtube} key={snapshot.media.playbackId??source.videoId} videoId={source.videoId} playbackId={snapshot.media.playbackId??source.videoId} getSnapshot={getSnapshot} selfId={selfId} volume={volume} expanded={expanded} playing={snapshot.media.playing} onPlayback={action=>control(action)} onBlockedChange={blocked=>setBlockedPlayback(blocked?playbackId:null)} onEnded={(playbackId)=>control("ended",{playbackId})} onError={setError}/> : snapshot.media.url ? <video key={snapshot.media.playbackId??snapshot.media.url} ref={video} src={snapshot.media.url} onLoadStart={()=>setBuffering(true)} onWaiting={()=>setBuffering(true)} onCanPlay={()=>setBuffering(false)} onPlaying={()=>{setBuffering(false);fileBlocked.current=null;setBlockedPlayback(null);}} onEnded={()=>control("ended",{playbackId:snapshot.media.playbackId})} playsInline preload="metadata" onClick={() => { setError(""); if (!expanded)onExpand(true); else control(deviceBlocked?"resume":snapshot.media.playing?"pause":"play"); }} onError={() => {setBuffering(false);setError("This link could not play. Try a YouTube video or another video file.");}}/> : <button className={`screen-placeholder ${snapshot.worldId==="asylum"?"creepy-static":""}`} onClick={() => onExpand(true)}><span>▣</span>{expanded ? "Paste a link to start movie night" : snapshot.worldId==="asylum"?"STATIC · CLICK TO WATCH":"MOVIE NIGHT"}</button>}
    {buffering && source?.kind === "file" && <div className="media-loading" role="status"><span className="loading-spinner" aria-hidden="true"/>Loading video…</div>}
    {!expanded&&source&&<button className="tv-open-controls" aria-label={deviceBlocked?"Enable playback on this device and open shared watching controls":"Open shared watching controls"} onClick={()=>{if(deviceBlocked)control("resume");onExpand(true);}}>{deviceBlocked?"▶":"↗"}</button>}
    {expanded && <div className="watching-controls">
      {error && <p role="status">{error}</p>}
      {deviceBlocked && <p className="device-playback-status" role="status">This browser needs a tap to start audio and video on this device. Your friends’ playback keeps going.</p>}
      {snapshot.media.url && <p className="active-video-link">Now watching: <a href={snapshot.media.url} target="_blank" rel="noopener noreferrer">{snapshot.media.url}</a></p>}
      <p>Playback is shared. Your volume is personal. Walking away fades screen audio. Anyone here can play, pause or skip to a time for the group.</p>
      <label>Screen volume<input aria-label="Screen volume" type="range" min="0" max="1" step=".05" value={volume} onChange={e => setVolume(Number(e.target.value))}/></label>
      <><form onSubmit={e => { e.preventDefault(); setError(""); control("source", { url }); }}><label>Paste a video link<input aria-label="Video link" type="url" placeholder="YouTube link or video file link" value={url} onChange={e => setUrl(e.target.value)} required/></label><button>{snapshot.media.url ? "Replace current video" : "Load for everyone"}</button><button type="button" onClick={()=>{if(url){setError("");control("queue.add",{url});}}}>Add to queue</button></form><div className="watching-actions"><button disabled={!snapshot.media.url} onClick={() => control(deviceBlocked ? "resume" : snapshot.media.playing ? "pause" : "play")}>{deviceBlocked ? "Enable playback on this device" : snapshot.media.playing ? "Pause together" : "Play together"}</button><label>Go to time (seconds)<input type="number" min="0" max="86400" value={seek} onChange={e => setSeek(e.target.value)}/></label><button disabled={!snapshot.media.url} onClick={() => control("seek", { position: Number(seek) })}>Skip everyone to this time</button></div></>
      <button onClick={()=>{if(screen.current?.requestFullscreen)void screen.current.requestFullscreen().catch(()=>setError("Fullscreen is unavailable in this browser. You can keep watching in this panel."));else setError("Fullscreen is unavailable in this browser. You can keep watching in this panel.");}}>Full screen</button>
      <button disabled={!snapshot.media.queue?.length} onClick={()=>control("next")}>Play next</button>
      <ol className="video-queue" aria-label="Shared video queue">{snapshot.media.queue?.map((item,i)=><li key={item.id}><span>{i+1}. {item.url}</span><button aria-label={`Remove queued video ${i+1}`} onClick={()=>control("queue.remove",{itemId:item.id})}>Remove</button></li>)}</ol>
      <small>Paste a YouTube watch/share/Shorts link, or a link to an MP4, WebM or Ogg file. Other website pages and live screen sharing are not supported yet.</small>
    </div>}
  </section>;
}
