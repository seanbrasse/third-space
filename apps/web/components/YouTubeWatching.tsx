"use client";
import {getWorld} from "@third-space/config";
import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import type { Snapshot } from "../lib/types";
type Player = {
    getCurrentTime: () => number;
    getDuration: () => number;
    getPlayerState: () => number;
    playVideo: () => void;
    pauseVideo: () => void;
    seekTo: (seconds: number, allow: boolean) => void;
    setVolume: (volume: number) => void;
    destroy: () => void;
};
type YouTubeWindow = Window & {
    YT?: {
        Player: new (element: HTMLElement, options: Record<string, unknown>) => Player;
    };
    onYouTubeIframeAPIReady?: () => void;
};
export default function YouTubeWatching({ videoId, playbackId, getSnapshot, selfId, volume, expanded, onEnded, onError }: {
    videoId: string;
    playbackId:string;
    getSnapshot: () => Snapshot | null;
    selfId: string;
    volume: number;
    expanded:boolean;
    onEnded:(playbackId:string)=>void;
    onError: (message: string) => void;
}) {
    const clock = useRef({ server: 0, client: 0 });
    const autoplayBlocked = useRef(false);
    const sync = useRef({ anchor: NaN, position: NaN, playing: false, lastSeek: -Infinity, lastPlay: -Infinity, stableSince: 0 });
    const root = useRef<HTMLDivElement>(null), player = useRef<Player | null>(null), latest = useRef({ getSnapshot, selfId, volume, expanded, onEnded, onError }), [ready, setReady] = useState(false), [blocked, setBlocked] = useState(false), [loading, setLoading] = useState(true);
    useEffect(() => { latest.current = { getSnapshot, selfId, volume, expanded, onEnded, onError }; }, [getSnapshot, selfId, volume, expanded, onEnded, onError]);
    useEffect(() => {
        const w = window as YouTubeWindow, previous = w.onYouTubeIframeAPIReady;
        const loaded = () => { previous?.(); setReady(true); };
        w.onYouTubeIframeAPIReady = loaded;
        if (w.YT?.Player)
            setReady(true);
        return () => { if (w.onYouTubeIframeAPIReady === loaded)
            w.onYouTubeIframeAPIReady = previous; };
    }, []);
    useEffect(() => {
        const api = (window as YouTubeWindow).YT;
        if (!ready || !api || !root.current)
            return;
        autoplayBlocked.current = false;
        sync.current = { anchor: NaN, position: NaN, playing: false, lastSeek: -Infinity, lastPlay: -Infinity, stableSince: 0 };
        let stopped = false;
        const target = document.createElement("div");
        root.current.appendChild(target);
        const instance = new api.Player(target, { width: "480", height: "270", videoId, playerVars: { origin: location.origin, playsinline: 1, controls: 0, rel: 0 }, events: {
                onReady: () => { if (!stopped)
                    {player.current = instance;setLoading(false);} },
                onStateChange: (event:{data:number}) => {if(!stopped){setLoading(event.data===3);if(event.data===0)latest.current.onEnded(playbackId);}},
                onAutoplayBlocked: () => { if (!stopped)
                    {autoplayBlocked.current=true;setBlocked(true);setLoading(false);} },
                onError: (e: {
                    data: number;
                }) => { if (!stopped) {setLoading(false);
                    latest.current.onError([101, 150].includes(e.data) ? "This creator does not allow embedded playback. Choose another video." : "YouTube could not play this video. It may be unavailable or restricted.");} }
            } });
        return () => { stopped = true; player.current = null; instance.destroy(); };
    }, [ready, videoId, playbackId]);
    useEffect(() => {
        const timer = setInterval(() => {
            const p = player.current, { getSnapshot, selfId, volume, expanded } = latest.current, s = getSnapshot(), m = s?.media;
            if (!p || !m || !s)
                return;
            if (s.serverTime !== clock.current.server)
                clock.current = { server: s.serverTime, client: Date.now() };
            const serverNow = clock.current.server + Date.now() - clock.current.client, target = m.position + (m.playing ? Math.max(0, serverNow - m.anchorAt) / 1000 : 0), duration = p.getDuration();
            if (duration > 0 && target >= duration) {
                if(m.playing)latest.current.onEnded(playbackId);
                return;
            }
            const now = performance.now(), state = p.getPlayerState(), policy = sync.current;
            // Queue edits change revision but do not change the playback anchor.
            // Buffering must finish before automatic drift correction can seek again.
            const commandChanged = policy.anchor !== m.anchorAt || policy.position !== m.position || policy.playing !== m.playing;
            const drift = Math.abs(p.getCurrentTime() - target);
            if (state !== 1) policy.stableSince = now;
            if ((commandChanged && drift > .35) || (m.playing && state === 1 && drift > 3 && now - policy.stableSince >= 3000 && now - policy.lastSeek >= 10000)) {
                p.seekTo(target, true);
                policy.lastSeek = now;
                policy.stableSince = now;
            }
            if (m.playing && !autoplayBlocked.current && state !== 1 && state !== 3 && (commandChanged || now - policy.lastPlay >= 5000)) {
                p.playVideo();
                policy.lastPlay = now;
            } else if (!m.playing && [1,3].includes(state)) p.pauseVideo();
            policy.anchor = m.anchorAt; policy.position = m.position; policy.playing = m.playing;
            const self=s.players.find(p=>p.id===selfId),surface=getWorld(s.worldId).mediaSurface;const gain=expanded?1:Math.max(0,1-Math.hypot((self?.x??0)-surface.source.x,(self?.y??0)-surface.source.y)/12);
            p.setVolume(volume * gain * 100);
        }, 500);
        return () => clearInterval(timer);
    }, [playbackId]);
    useEffect(()=>{
      const host=root.current,parent=host?.parentElement;if(!host||!parent)return;
      const resize=()=>{const w=parent.clientWidth,h=parent.clientHeight||270,scale=Math.min(w/480,h/270);host.style.transform=`translate(${(w-480*scale)/2}px,${(h-270*scale)/2}px) scale(${scale})`;};
      const observer=new ResizeObserver(resize);observer.observe(parent);resize();return()=>observer.disconnect();
    },[]);
    return <div className="youtube-watching"><Script src="https://www.youtube.com/iframe_api" strategy="afterInteractive" onReady={() => { if ((window as YouTubeWindow).YT?.Player)
        setReady(true); }} onError={() => {setLoading(false);onError("YouTube could not load. Check your connection or browser content blocker.");}}/><div ref={root} className="youtube-player"/>{loading && <div className="media-loading" role="status"><span className="loading-spinner" aria-hidden="true"/>Loading YouTube…</div>}{blocked && <button onClick={() => { autoplayBlocked.current=false; player.current?.playVideo(); setBlocked(false); }}>Tap to enable YouTube playback</button>}</div>;
}
