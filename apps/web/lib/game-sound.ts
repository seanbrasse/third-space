import { mimicSoundSamples, type MimicSoundKind } from "./mimic-sound";
import { catchStingSamples, type CatchStingKind } from "./catch-sting";
import { werewolfSoundSamples, type WerewolfSoundKind } from "./werewolf-sound";
export type GameSoundKind = 'player-step' | 'clown-step' | 'giggle' | 'slash' | WerewolfSoundKind | CatchStingKind | MimicSoundKind;
/** Short game cues sit below conversation; smooth falloff has a hard hearing cutoff. */
export function gameSoundGain(kind: GameSoundKind, distance: number, volume: number) {
    const approach = kind === 'clown-step' || kind === 'werewolf-step' || kind === 'mimic-step';
    const range = kind === 'player-step' ? 8 : kind === 'howl' ? 32 : approach ? 16 : 12;
    const level = { 'player-step': .07, 'clown-step': .24, giggle: .075, slash: .24, howl: .20, growl: .18, claw: .24, 'werewolf-step': .22, 'clown-scare': .16, 'werewolf-scare': .16, 'mimic-scare': .16, 'mimic-step': .24, 'mimic-roar': .18, 'mimic-hit': .24 }[kind];
    return level * Math.max(0, Math.min(1, volume)) * Math.pow(Math.max(0, 1 - Math.max(0, distance) / range), approach ? 1.4 : 2);
}
export function clownStepInterval(distanceToTarget: number) { return 520 - 300 * Math.max(0, Math.min(1, 1 - distanceToTarget / 8)); }
export function werewolfStepInterval(distanceToTarget: number) { return 320 - 160 * Math.max(0, Math.min(1, 1 - distanceToTarget / 10)); }
/** Cached original procedural samples: dull soft steps, heavy boot crunch, giggle and knife swish/impact. */
export function gameSoundSamples(kind: GameSoundKind, sampleRate: number) {
    if (kind === "mimic-step" || kind === "mimic-roar" || kind === "mimic-hit") return mimicSoundSamples(kind, sampleRate);
    if (kind === "clown-scare" || kind === "werewolf-scare" || kind === "mimic-scare") return catchStingSamples(kind, sampleRate);
    if (kind === 'howl' || kind === 'growl' || kind === 'claw' || kind === 'werewolf-step') return werewolfSoundSamples(kind, sampleRate);
    const duration = kind === 'giggle' ? .8 : kind === 'slash' ? .3 : kind === 'clown-step' ? .21 : .11, a = new Float32Array(Math.ceil(sampleRate * duration));
    let brown = 0;
    for (let i = 0; i < a.length; i++) {
        const t = i / sampleRate, noise = Math.random() * 2 - 1;
        brown = (brown + noise * .11) / 1.11;
        if (kind === 'giggle') {
            const pulse = Math.floor(t / .22), phase = t % .22, envelope = pulse < 3 ? Math.pow(Math.sin(Math.PI * Math.min(1, phase / .17)), 2) * Math.exp(-phase * 9) : 0;
            const pitch = 190 - pulse * 20 + Math.sin(t * 39) * 10;
            a[i] = envelope * (Math.sin(2 * Math.PI * pitch * t) * .42 + Math.sin(2 * Math.PI * 540 * t) * .16 + brown * .2);
        }
        else if (kind === 'slash') {
            const swish = Math.sin(Math.PI * Math.min(1, t / .16)) * Math.exp(-t * 14), impact = t > .08 ? Math.exp(-(t - .08) * 35) : 0;
            a[i] = noise * swish * .35 + Math.sin(2 * Math.PI * 120 * t) * impact * .36 + Math.sin(2 * Math.PI * 2100 * t) * Math.exp(-t * 42) * .08;
        }
        else {
            const heavy = kind === 'clown-step', envelope = Math.exp(-t * (heavy ? 20 : 42)) * Math.min(1, t / .003);
            a[i] = (Math.sin(2 * Math.PI * (heavy ? 68 : 135) * t) * .55 + brown * .3) * envelope;
        }
    }
    return a;
}
