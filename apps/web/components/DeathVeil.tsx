"use client";
import { useEffect, useRef } from 'react';
import type { AvatarConfig } from '@third-space/contracts';
import { drawAvatarCanvas } from '../lib/pixel-art';
import { takedownCreature, CatchPresentation, TAKEDOWN_DURATION_MS, type TakedownCreature as Creature } from '../lib/takedown';
import TakedownCreature from './TakedownCreature';
import TakedownCloseup from './TakedownCloseup';
const presentations = new CatchPresentation();
/** One finite local presentation, aligned to authoritative catch time. No game loop. */
export default function DeathVeil({ caughtAt, caughtBy, avatar, victimId, serverTime, worldRevision, epoch, reducedMotion }: {
    victimId?: string;
    caughtAt?: number;
    caughtBy?: Creature;
    avatar?: AvatarConfig;
    serverTime: number;
    worldRevision: number;
    epoch: string;
    reducedMotion: boolean;
}) {
    const prepared = useRef<{key:string;window:ReturnType<CatchPresentation["begin"]>} | null>(null);
    const root = useRef<HTMLDivElement>(null), player = useRef<HTMLCanvasElement>(null), latest = useRef(serverTime);
    latest.current = serverTime;
    const creature = takedownCreature(caughtBy);
    useEffect(() => {
        if (avatar && player.current) drawAvatarCanvas(player.current, avatar, 'down', 0);
    }, [avatar, creature]);
    useEffect(() => {
        const el = root.current;
        if (!el) return;
        el.classList.remove('active', 'shock');
        const key=`${epoch}:${worldRevision}:${victimId}:${caughtAt}`;
        const window = prepared.current?.key===key ? prepared.current.window : presentations.begin(key, caughtAt, latest.current);
        prepared.current = window ? {key,window} : null;
        if (!window) return;
        el.style.animationDelay = `-${window.elapsed}ms`;
        el.style.animationDuration = TAKEDOWN_DURATION_MS + 'ms';
        el.style.setProperty('--takedown-delay', `-${window.elapsed}ms`);
        el.classList.add('active');
        if(window.jumpScare)el.classList.add('shock');
        const timer = setTimeout(() => el.classList.remove('active'), window.remaining);
        return () => { clearTimeout(timer); el.classList.remove('active', 'shock'); };
    }, [caughtAt, worldRevision, epoch, victimId]);
    return <div ref={root} className={`death-veil takedown-veil ${reducedMotion ? 'gentle' : ''}`} style={{ pointerEvents: 'none', background: '#000' }} aria-hidden="true" data-caught-at={caughtAt ?? 0} data-creature={creature ?? 'unknown'}>
      {creature && <div className="takedown-jumpscare"><div className="takedown-jolt"><TakedownCloseup kind={creature}/></div></div>}
      {creature && avatar && <div className="takedown-stage">
        <div className="takedown-attacker"><TakedownCreature kind={creature}/></div>
        <canvas className="takedown-player" ref={player} width={24} height={32}/>
        <div className="takedown-caption">{creature === 'werewolf' ? 'A shadow springs from the pines.' : creature === 'mimic' ? 'That was never your friend.' : 'A familiar grin in the dark.'}<span>Returning to the fire…</span></div>
      </div>}
      <style>{`
        .takedown-veil{overflow:hidden}
        .takedown-veil.active:not(.gentle){animation-name:takedown-blackout;animation-timing-function:linear}
        .takedown-jumpscare{position:absolute;left:50%;top:46%;width:min(78vw,76vh,680px);aspect-ratio:1;transform:translate(-50%,-50%);opacity:0;pointer-events:none}
        .takedown-jolt,.takedown-jumpscare svg{width:100%;height:100%;display:block}
        .takedown-veil.active.shock:not(.gentle) .takedown-jumpscare{animation:takedown-lunge 1800ms linear both;animation-delay:var(--takedown-delay)}
        .takedown-veil.active.shock:not(.gentle) .takedown-jolt{animation:takedown-jolt 170ms linear both;animation-delay:var(--takedown-delay)}
        .takedown-stage{position:absolute;left:50%;top:50%;width:min(360px,90vw);height:240px;transform:translate(-50%,-50%);opacity:0}
        .takedown-veil.active .takedown-stage{animation:takedown-stage 1800ms linear both;animation-delay:var(--takedown-delay)}
        .takedown-veil.gentle.active .takedown-stage{animation:none;opacity:1}
        .takedown-veil.gentle .takedown-jumpscare{display:none}
        .takedown-player{position:absolute;left:52%;top:46px;width:72px;height:96px;image-rendering:pixelated;transform-origin:50% 92%}
        .takedown-attacker{position:absolute;left:12%;top:30px;width:96px;height:120px;transform-origin:50% 92%}
        .takedown-attacker svg{width:100%;height:100%;display:block}
        .takedown-caption{position:absolute;left:0;right:0;top:172px;text-align:center;color:#b8b6bb;font:14px/1.5 system-ui,sans-serif}
        .takedown-caption span{display:block;color:#858c80;font-size:12px}
        .takedown-veil.active:not(.gentle) .takedown-attacker{animation:takedown-approach 1800ms ease-out both;animation-delay:var(--takedown-delay)}
        .takedown-veil.active:not(.gentle) .takedown-player{animation:takedown-fall 1800ms ease-out both;animation-delay:var(--takedown-delay)}
        .takedown-veil[data-creature=werewolf] .takedown-attacker{width:132px;height:96px;top:52px}
        @keyframes takedown-approach{0%,30%{transform:translateX(-38px);opacity:0}38%{opacity:1}48%,65%{transform:translateX(66px) rotate(5deg);opacity:1}85%,100%{transform:translateX(66px);opacity:0}}
        @keyframes takedown-fall{0%,42%{transform:rotate(0deg);opacity:1}58%,72%{transform:rotate(65deg) translateY(12px);opacity:.65}85%,100%{transform:rotate(65deg) translateY(12px);opacity:0}}
        @keyframes takedown-blackout{0%,65%{opacity:1}100%{opacity:0}}
        @keyframes takedown-lunge{0%{opacity:1;transform:translate(-50%,-44%) scale(.72)}9%{opacity:1;transform:translate(-50%,-50%) scale(1.12)}25%{opacity:1;transform:translate(-50%,-50%) scale(1.18)}30%,100%{opacity:0;transform:translate(-50%,-50%) scale(1.18)}}
        @keyframes takedown-jolt{0%{transform:translate(0,0)}22%{transform:translate(-8px,3px) rotate(-.7deg)}48%{transform:translate(6px,-2px) rotate(.5deg)}74%{transform:translate(-3px,1px)}100%{transform:translate(0,0)}}
        @keyframes takedown-stage{0%,28%{opacity:0}33%,74%{opacity:1}92%,100%{opacity:0}}
        @media(prefers-reduced-motion:reduce){.takedown-veil .takedown-jumpscare{display:none!important}.takedown-veil.active .takedown-stage{animation:none!important;opacity:1}.takedown-veil.active{animation-name:forest-respawn-fade!important}.takedown-veil.active .takedown-player,.takedown-veil.active .takedown-attacker{animation:none!important}}
      `}</style>
    </div>;
}
