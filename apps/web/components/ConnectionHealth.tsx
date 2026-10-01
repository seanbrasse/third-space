"use client";
import { useEffect, useRef, useState } from "react";
import type { Room } from "@colyseus/sdk";
import { connectionQuality, type ConnectionQuality } from "../lib/connection-health";
const labels: Record<ConnectionQuality, string> = { checking: "Checking connection…", good: "Connection healthy", slow: "High delay", unstable: "Uneven connection", stalled: "Updates stalled", offline: "Offline", background: "Tab in background", reconnecting: "Reconnecting…" };
export default function ConnectionHealth({ room, connection }: {
    room: Room | null;
    connection: string;
}) {
    const nonce = useRef(0);
    const [status, setStatus] = useState<{
        quality: ConnectionQuality;
        ms: number | null;
    }>({ quality: "checking", ms: null });
    useEffect(() => {
        if (!room)
            return;
        let lastSnapshot = performance.now(), sent = 0, pending: number | null = null, timeouts = 0, lastProbe = -Infinity;
        const samples: number[] = [];
        const offSnapshot = room.onMessage("snapshot", () => { lastSnapshot = performance.now(); });
        const offDelta = room.onMessage("snapshot.delta", () => { lastSnapshot = performance.now(); });
        const offPong = room.onMessage("connection.pong", (nonce: unknown) => {
            if (nonce !== pending || pending === null)
                return;
            samples.push(performance.now() - sent);
            if (samples.length > 5)
                samples.shift();
            pending = null;
            timeouts = 0;
        });
        const tick = () => {
            const now = performance.now(), online = navigator.onLine, hidden = document.hidden, connected = connection === "Connected";
            if (!hidden && connected) {
                if (pending !== null && now - sent > 4000) {
                    pending = null;
                    timeouts++;
                }
                if (pending === null && now - lastProbe >= 2000) {
                    pending = ++nonce.current;
                    sent = lastProbe = now;
                    try {
                        room.send("connection.ping", pending);
                    }
                    catch {
                        pending = null;
                        timeouts++;
                    }
                }
            }
            const quality = connectionQuality({ online, hidden, connected, age: now - lastSnapshot, samples, timeouts });
            const sorted = [...samples].sort((a, b) => a - b), ms = sorted.length ? Math.round(sorted[Math.floor(sorted.length / 2)]!) : null;
            setStatus(previous => previous.quality === quality && previous.ms === ms ? previous : { quality, ms });
        };
        const resume = () => { lastSnapshot = performance.now(); samples.length = 0; pending = null; timeouts = 0; lastProbe = -Infinity; tick(); };
        const timer = setInterval(tick, 500);
        tick();
        window.addEventListener("online", resume);
        window.addEventListener("offline", tick);
        document.addEventListener("visibilitychange", resume);
        return () => { clearInterval(timer); offSnapshot(); offDelta(); offPong(); window.removeEventListener("online", resume); window.removeEventListener("offline", tick); document.removeEventListener("visibilitychange", resume); };
    }, [room, connection]);
    const label = room ? labels[status.quality] : "Not connected";
    return <span className="network-health" data-quality={status.quality} title="Round-trip delay and incoming room updates. Lag can come from your network, this device, or the server; this does not measure Wi-Fi signal strength."><span aria-live="polite">{label}</span>{status.ms !== null && room && status.quality !== "offline" && status.quality !== "background" ? ` · ${status.ms} ms` : ""}</span>;
}
