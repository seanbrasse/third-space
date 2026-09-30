"use client";
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
export default function YouTubeWatching({ videoId, getSnapshot, selfId, volume, onError }: {
    videoId: string;
    getSnapshot: () => Snapshot | null;
    selfId: string;
    volume: number;
    onError: (message: string) => void;
}) {
    const clock = useRef({ server: 0, client: 0 });
    const root = useRef<HTMLDivElement>(null), player = useRef<Player | null>(null), latest = useRef({ getSnapshot, selfId, volume, onError }), [ready, setReady] = useState(false), [blocked, setBlocked] = useState(false), [loading, setLoading] = useState(true);
    useEffect(() => { latest.current = { getSnapshot, selfId, volume, onError }; }, [getSnapshot, selfId, volume, onError]);
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
        let stopped = false;
        const target = document.createElement("div");
        root.current.appendChild(target);
        const instance = new api.Player(target, { width: "100%", height: "270", videoId, playerVars: { origin: location.origin, playsinline: 1, controls: 0, rel: 0 }, events: {
                onReady: () => { if (!stopped)
                    {player.current = instance;setLoading(false);} },
                onStateChange: (event:{data:number}) => {if(!stopped)setLoading(event.data===3);},
                onAutoplayBlocked: () => { if (!stopped)
                    {setBlocked(true);setLoading(false);} },
                onError: (e: {
                    data: number;
                }) => { if (!stopped) {setLoading(false);
                    latest.current.onError([101, 150].includes(e.data) ? "This creator does not allow embedded playback. Choose another video." : "YouTube could not play this video. It may be unavailable or restricted.");} }
            } });
        return () => { stopped = true; player.current = null; instance.destroy(); };
    }, [ready, videoId]);
    useEffect(() => {
        const timer = setInterval(() => {
            const p = player.current, { getSnapshot, selfId, volume } = latest.current, s = getSnapshot(), m = s?.media;
            if (!p || !m || !s)
                return;
            if (s.serverTime !== clock.current.server)
                clock.current = { server: s.serverTime, client: Date.now() };
            const serverNow = clock.current.server + Date.now() - clock.current.client, target = m.position + (m.playing ? Math.max(0, serverNow - m.anchorAt) / 1000 : 0), duration = p.getDuration();
            if (duration > 0 && target >= duration) {
                p.pauseVideo();
                return;
            }
            if (Math.abs(p.getCurrentTime() - target) > 1.2)
                p.seekTo(target, true);
            if (m.playing && p.getPlayerState() !== 1 && p.getPlayerState() !== 3)
                p.playVideo();
            else if (!m.playing && p.getPlayerState() !== 2)
                p.pauseVideo();
            p.setVolume(volume * 100);
        }, 500);
        return () => clearInterval(timer);
    }, []);
    return <div className="youtube-watching"><Script src="https://www.youtube.com/iframe_api" strategy="afterInteractive" onReady={() => { if ((window as YouTubeWindow).YT?.Player)
        setReady(true); }} onError={() => {setLoading(false);onError("YouTube could not load. Check your connection or browser content blocker.");}}/><div ref={root} className="youtube-player"/>{loading && <div className="media-loading" role="status"><span className="loading-spinner" aria-hidden="true"/>Loading YouTube…</div>}{blocked && <button onClick={() => { player.current?.playVideo(); setBlocked(false); }}>Tap to enable YouTube playback</button>}</div>;
}
