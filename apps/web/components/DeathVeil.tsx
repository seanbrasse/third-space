"use client";
import { useEffect, useRef } from 'react';
/** One finite CSS animation, aligned to room time. No idle animation/game loop. */
export default function DeathVeil({ caughtAt, serverTime, worldRevision, epoch, reducedMotion }: {
    caughtAt?: number;
    serverTime: number;
    worldRevision: number;
    epoch: string;
    reducedMotion: boolean;
}) {
    const root = useRef<HTMLDivElement>(null), latest = useRef(serverTime);
    latest.current = serverTime;
    useEffect(() => {
        const el = root.current;
        if (!el)
            return;
        el.classList.remove('active');
        if (!caughtAt)
            return;
        const elapsed = Math.max(0, latest.current - caughtAt), duration = 1800;
        if (elapsed >= duration)
            return;
        el.style.animationDelay = `-${elapsed}ms`;
        el.style.animationDuration = duration + 'ms';
        el.classList.add('active');
        const timer = setTimeout(() => el.classList.remove('active'), duration - elapsed);
        return () => { clearTimeout(timer); el.classList.remove('active'); };
    }, [caughtAt, worldRevision, epoch]);
    return <div ref={root} className={`death-veil ${reducedMotion ? 'gentle' : ''}`} aria-hidden="true" data-caught-at={caughtAt ?? 0}/>;
}
