export type GameSoundKind = 'player-step' | 'clown-step' | 'giggle' | 'slash';
/** Short game cues sit below conversation; smooth falloff has a hard hearing cutoff. */
export function gameSoundGain(kind: GameSoundKind, distance: number, volume: number) {
    const range = kind === 'player-step' ? 8 : 12, level = { 'player-step': .018, 'clown-step': .14, giggle: .075, slash: .24 }[kind];
    return level * Math.max(0, Math.min(1, volume)) * Math.pow(Math.max(0, 1 - Math.max(0, distance) / range), 2);
}
export function clownStepInterval(distanceToTarget: number) { return 520 - 300 * Math.max(0, Math.min(1, 1 - distanceToTarget / 8)); }
/** Cached original procedural samples: dull soft steps, heavy boot crunch, giggle and knife swish/impact. */
export function gameSoundSamples(kind: GameSoundKind, sampleRate: number) {
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
