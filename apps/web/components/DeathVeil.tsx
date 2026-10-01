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
        <div className="takedown-grasp"/>
        <canvas className="takedown-player" ref={player} width={24} height={32}/>
        <div className="takedown-caption">{creature === 'werewolf' ? 'A shadow springs from the pines.' : creature === 'mimic' ? 'That was never your friend.' : 'A familiar grin in the dark.'}<span>Returning to the fire…</span></div>
      </div>}
      <style>{`
        .takedown-veil{overflow:hidden}
        .takedown-veil.active:not(.gentle){animation-name:takedown-blackout;animation-timing-function:linear}
        .takedown-jumpscare{position:absolute;left:50%;top:50%;width:min(78vw,76vh,680px);aspect-ratio:1;transform:translate(-50%,-50%);opacity:0;pointer-events:none}
        .takedown-jolt,.takedown-jumpscare svg{width:100%;height:100%;display:block}
        .takedown-veil.active.shock:not(.gentle) .takedown-jumpscare{animation:takedown-lunge 1800ms linear both;animation-delay:var(--takedown-delay)}
        .takedown-veil.active.shock:not(.gentle) .takedown-jolt{animation:takedown-jolt 170ms linear both;animation-delay:var(--takedown-delay)}
        .takedown-stage{position:absolute;left:50%;top:50%;width:min(360px,90vw);height:240px;transform:translate(-50%,-50%);opacity:0}
        .takedown-veil.active .takedown-stage{animation:takedown-stage 1800ms linear both;animation-delay:var(--takedown-delay)}
        .takedown-veil.gentle.active{opacity:.88;animation:none!important}
        .takedown-veil.gentle.active .takedown-stage{animation:none;opacity:1}
        .takedown-veil.gentle .takedown-jumpscare,.takedown-veil.gentle .takedown-grasp{display:none}
        .takedown-player{position:absolute;left:52%;top:46px;width:72px;height:96px;image-rendering:pixelated;transform-origin:50% 92%}
        .takedown-attacker{position:absolute;left:12%;top:30px;width:96px;height:120px;transform-origin:50% 92%}
        .takedown-attacker svg{width:100%;height:100%;display:block}
        .takedown-grasp{position:absolute;left:47%;top:76px;width:96px;height:64px;opacity:0;clip-path:polygon(0 10%,30% 0,40% 32%,70% 12%,100% 30%,85% 50%,60% 48%,45% 100%,20% 80%);background:#301b25;transform-origin:20% 50%}.takedown-veil.active:not(.gentle) .takedown-grasp{animation:takedown-snatch 1800ms steps(1,end) both;animation-delay:var(--takedown-delay)}
        .takedown-caption{position:absolute;left:0;right:0;top:172px;text-align:center;color:#b8b6bb;font:14px/1.5 system-ui,sans-serif}
        .takedown-caption span{display:block;color:#858c80;font-size:12px}
        .takedown-veil.active:not(.gentle) .takedown-attacker{animation:takedown-approach 1800ms ease-out both;animation-delay:var(--takedown-delay)}
        .takedown-veil.active:not(.gentle) .takedown-player{animation:takedown-fall 1800ms ease-out both;animation-delay:var(--takedown-delay)}
        .takedown-veil[data-creature=werewolf] .takedown-attacker{width:132px;height:96px;top:52px}
        @keyframes takedown-approach{0%,21%{transform:translateX(-60px);opacity:0}25%{transform:translateX(-20px);opacity:1}32%,58%{transform:translateX(72px) rotate(12deg);opacity:1}72%,100%{transform:translateX(82px);opacity:0}}
        @keyframes takedown-fall{0%,30%{transform:rotate(0deg);opacity:1}34%{transform:rotate(-14deg) translate(-8px,-8px);opacity:1}43%,65%{transform:rotate(88deg) translate(26px,24px);opacity:.65}78%,100%{transform:rotate(88deg) translate(26px,24px);opacity:0}}
        @keyframes takedown-snatch{0%,29%{opacity:0;transform:scale(.7)}30%,43%{opacity:1;transform:scale(1.18) rotate(-8deg)}44%,100%{opacity:0;transform:scale(1.18)}}
        @keyframes takedown-blackout{0%,65%{opacity:1}100%{opacity:0}}
        @keyframes takedown-lunge{0%{opacity:1;transform:translate(-50%,-44%) scale(.72)}3%{opacity:1;transform:translate(-50%,-50%) scale(1.20)}17%{opacity:1;transform:translate(-50%,-50%) scale(1.24)}22%,100%{opacity:0;transform:translate(-50%,-50%) scale(1.18)}}
        @keyframes takedown-jolt{0%{transform:translate(0,0)}22%{transform:translate(-8px,3px) rotate(-.7deg)}48%{transform:translate(6px,-2px) rotate(.5deg)}74%{transform:translate(-3px,1px)}100%{transform:translate(0,0)}}
        @keyframes takedown-stage{0%,20%{opacity:0}24%,65%{opacity:1}78%,100%{opacity:0}}
        @media(prefers-reduced-motion:reduce){.takedown-veil .takedown-jumpscare,.takedown-veil .takedown-grasp{display:none!important}.takedown-veil.active .takedown-stage{animation:none!important;opacity:1}.takedown-veil.active{opacity:.88!important;animation:none!important}.takedown-veil.active .takedown-player,.takedown-veil.active .takedown-attacker{animation:none!important}}
      `}</style>
    </div>;
}
