"use client";
import { useEffect, useRef } from 'react';
import type { AvatarConfig } from '@third-space/contracts';
import { drawAvatarCanvas } from '../lib/pixel-art';
import { takedownCreature, takedownWindow, TAKEDOWN_DURATION_MS, type TakedownCreature as Creature } from '../lib/takedown';
import TakedownCreature from './TakedownCreature';
/** One finite local presentation, aligned to authoritative catch time. No game loop. */
export default function DeathVeil({ caughtAt, caughtBy, avatar, serverTime, worldRevision, epoch, reducedMotion }: {
    caughtAt?: number;
    caughtBy?: Creature;
    avatar?: AvatarConfig;
    serverTime: number;
    worldRevision: number;
    epoch: string;
    reducedMotion: boolean;
}) {
    const root = useRef<HTMLDivElement>(null), player = useRef<HTMLCanvasElement>(null), latest = useRef(serverTime);
    latest.current = serverTime;
    const creature = takedownCreature(caughtBy);
    useEffect(() => {
        if (avatar && player.current) drawAvatarCanvas(player.current, avatar, 'down', 0);
    }, [avatar, creature]);
    useEffect(() => {
        const el = root.current;
        if (!el) return;
        el.classList.remove('active');
        const window = takedownWindow(caughtAt, latest.current);
        if (!window) return;
        el.style.animationDelay = `-${window.elapsed}ms`;
        el.style.animationDuration = TAKEDOWN_DURATION_MS + 'ms';
        el.style.setProperty('--takedown-delay', `-${window.elapsed}ms`);
        el.classList.add('active');
        const timer = setTimeout(() => el.classList.remove('active'), window.remaining);
        return () => { clearTimeout(timer); el.classList.remove('active'); };
    }, [caughtAt, worldRevision, epoch, reducedMotion]);
    return <div ref={root} className={`death-veil takedown-veil ${reducedMotion ? 'gentle' : ''}`} style={{ pointerEvents: 'none', background: '#000' }} aria-hidden="true" data-caught-at={caughtAt ?? 0} data-creature={creature ?? 'unknown'}>
      {creature && avatar && <div className="takedown-stage">
        <div className="takedown-attacker"><TakedownCreature kind={creature}/></div>
        <canvas className="takedown-player" ref={player} width={24} height={32}/>
        <div className="takedown-caption">{creature === 'werewolf' ? 'A shadow springs from the pines.' : 'A familiar grin in the dark.'}<span>Returning to the fire…</span></div>
      </div>}
      <style>{`
        .takedown-stage{position:absolute;left:50%;top:50%;width:min(360px,90vw);height:240px;transform:translate(-50%,-50%);opacity:0}
        .takedown-veil.active .takedown-stage{opacity:1}
        .takedown-player{position:absolute;left:52%;top:46px;width:72px;height:96px;image-rendering:pixelated;transform-origin:50% 92%}
        .takedown-attacker{position:absolute;left:12%;top:30px;width:96px;height:120px;transform-origin:50% 92%}
        .takedown-attacker svg{width:100%;height:100%;display:block}
        .takedown-caption{position:absolute;left:0;right:0;top:172px;text-align:center;color:#b8b6bb;font:14px/1.5 system-ui,sans-serif}
        .takedown-caption span{display:block;color:#858c80;font-size:12px}
        .takedown-veil.active:not(.gentle) .takedown-attacker{animation:takedown-approach 1800ms ease-out both;animation-delay:var(--takedown-delay)}
        .takedown-veil.active:not(.gentle) .takedown-player{animation:takedown-fall 1800ms ease-out both;animation-delay:var(--takedown-delay)}
        .takedown-veil[data-creature=werewolf] .takedown-attacker{width:132px;height:96px;top:52px}
        @keyframes takedown-approach{0%,12%{transform:translateX(-38px);opacity:0}26%{opacity:1}40%,58%{transform:translateX(66px) rotate(5deg);opacity:1}85%,100%{transform:translateX(66px);opacity:0}}
        @keyframes takedown-fall{0%,35%{transform:rotate(0deg);opacity:1}52%,68%{transform:rotate(65deg) translateY(12px);opacity:.65}85%,100%{transform:rotate(65deg) translateY(12px);opacity:0}}
        @media(prefers-reduced-motion:reduce){.takedown-veil.active .takedown-player,.takedown-veil.active .takedown-attacker{animation:none!important}}
      `}</style>
    </div>;
}
