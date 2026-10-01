export type WerewolfSoundKind = 'howl' | 'growl' | 'claw' | 'werewolf-step';
/** Original procedural cues on the existing unlocked, muted, bounded game bus. */
export function werewolfSoundSamples(kind: WerewolfSoundKind, sampleRate: number) {
    const duration = { howl: 1.6, growl: .65, claw: .26, 'werewolf-step': .13 }[kind];
    const a = new Float32Array(Math.ceil(sampleRate * duration));
    let brown = 0, phase = 0;
    for (let i = 0; i < a.length; i++) {
        const t = i / sampleRate, progress = t / duration, noise = Math.random() * 2 - 1;
        brown = (brown + noise * .13) / 1.13;
        const envelope = Math.sin(Math.PI * progress) ** 2;
        if (kind === 'howl') {
            phase += 2 * Math.PI * (225 + Math.sin(Math.PI * progress) * 125 + Math.sin(t * 24) * 4) / sampleRate;
            a[i] = envelope * (Math.sin(phase) * .4 + Math.sin(phase * 2) * .12 + brown * .06);
        } else if (kind === 'growl') {
            phase += 2 * Math.PI * (72 + Math.sin(t * 14) * 8) / sampleRate;
            a[i] = envelope * (Math.sin(phase) * .27 + Math.sin(phase * 2) * .13 + brown * .45) * (.8 + Math.sin(t * 70) * .2);
        } else if (kind === 'claw') {
            a[i] = noise * Math.exp(-t * 18) * Math.min(1, t / .008) * .36 + Math.sin(t * 2 * Math.PI * 92) * Math.exp(-t * 22) * .23;
        } else {
            a[i] = (Math.sin(t * 2 * Math.PI * 94) * .4 + brown * .35) * Math.exp(-t * 30) * Math.min(1, t / .003);
        }
    }
    return a;
}
