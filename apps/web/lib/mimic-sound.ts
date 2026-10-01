export type MimicSoundKind = 'mimic-roar' | 'mimic-hit' | 'mimic-step';
/** Original deterministic, short, smooth-envelope creature cues. Peak <= .65; no samples or speech. */
export function mimicSoundSamples(kind: MimicSoundKind, rate: number) {
    const duration = kind === 'mimic-roar' ? 1.1 : kind === 'mimic-hit' ? .28 : .18;
    const data = new Float32Array(Math.floor(rate * duration));
    let seed = 92731, smooth = 0;
    for (let i = 0; i < data.length; i++) {
        const t = i / rate, progress = t / duration;
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        smooth += ((seed / 4294967296 * 2 - 1) - smooth) * .13;
        const envelope = Math.min(1, t / .012) * Math.pow(Math.max(0, 1 - progress), kind === 'mimic-roar' ? 1.3 : 3);
        const tone = Math.sin(2 * Math.PI * (kind === 'mimic-roar' ? 65 * t + 12 * t * t : 43 * t));
        const flutter = kind === 'mimic-roar' ? .75 + .25 * Math.sin(t * 45) : 1;
        data[i] = (tone * .42 + smooth * .22) * envelope * flutter;
    }
    return data;
}
