export type AsylumSoundKind = 'room' | 'static';
/** Original seamless textures, generated once per AudioContext. No downloaded audio. */
export function asylumSamples(kind: AsylumSoundKind, rate: number) {
    const duration = kind === 'room' ? 24 : 11, length = Math.ceil(rate * duration), overlap = Math.ceil(rate * .12);
    const raw = new Float32Array(length + overlap); let seed = 431, brown = 0;
    for (let i = 0; i < raw.length; i++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        const noise = seed / 4294967296 * 2 - 1, t = i / rate;
        brown = (brown + noise * .025) / 1.025;
        if (kind === 'room') {
            const breath = .65 + .35 * Math.cos(2 * Math.PI * t / duration);
            const resonance = Math.sin(2 * Math.PI * 47 * t) * .075 + Math.sin(2 * Math.PI * 71 * t) * .035
                + Math.sin(2 * Math.PI * 113 * t) * .018 * (.5 + .5 * Math.sin(4 * Math.PI * t / duration));
            raw[i] = brown * .45 + resonance * breath;
        } else raw[i] = noise * .3 + brown * .08;
    }
    const samples = raw.slice(0, length);
    // Crossfade the continuation into the head so wrapping never clicks.
    for (let i = 0; i < overlap; i++) {
        const mix = .5 - .5 * Math.cos(Math.PI * i / overlap);
        samples[i] = raw[length + i]! * (1 - mix) + raw[i]! * mix;
    }
    return samples;
}
/** Quiet hiss from the configured TV, completely inaudible ten tiles away. */
export function asylumStaticGain(distance: number, volume: number) {
    return Math.max(0, Math.min(1, volume)) * .055 * Math.max(0, 1 - distance / 10) ** 1.5;
}
