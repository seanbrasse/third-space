import { getWorld } from "@third-space/config";
import { ambienceSamples, fireAmbienceGain } from './ambience';
export interface ForestAudioLocation { outside: boolean; x: number; y: number; volume: number; }
type Loop = { kind: 'night' | 'fire'; source: AudioBufferSourceNode | null; gain: GainNode; filter: BiquadFilterNode; target: number; };
/** Two pooled loops. Browser suspension pauses its clock; it never means leaving
 * the forest. Indoor transitions fade to silence without replacing sources. */
export class ForestAmbience {
    private buffers = new Map<'night' | 'fire', AudioBuffer>();
    private loops: Loop[] = [];
    constructor(private ctx: AudioContext, private output: AudioNode) {}
    update(location: ForestAudioLocation) {
        if (this.ctx.state === 'closed') return;
        if (location.outside && this.ctx.state === 'running') {
            if (!this.loops.length) this.loops = (['night', 'fire'] as const).map(kind => {
                const gain = this.ctx.createGain(), filter = this.ctx.createBiquadFilter();
                gain.gain.value = 0; filter.type = 'lowpass'; filter.frequency.value = kind === 'night' ? 6500 : 4000;
                filter.connect(gain); gain.connect(this.output);
                return { kind, source: null, gain, filter, target: -1 };
            });
            for (const loop of this.loops) if (!loop.source) this.start(loop);
        }
        const level = Math.max(0, Math.min(1, location.volume));
        const fire = getWorld("forest").fire!;
        for (const loop of this.loops) {
            const target = !location.outside ? 0 : loop.kind === 'night' ? level * .14
                : fireAmbienceGain(Math.hypot(location.x - fire.x, location.y - fire.y), level);
            // Never suppress reaching silence: a tiny edge gain must not persist at distance.
            if (Math.abs(target - loop.target) < .002 && !(target === 0 && loop.target !== 0)) continue;
            loop.target = target;
            loop.gain.gain.cancelScheduledValues(this.ctx.currentTime);
            loop.gain.gain.setTargetAtTime(target, this.ctx.currentTime, target === 0 ? .045 : .15);
            // setTarget approaches zero asymptotically. Finish the short fade at exact silence.
            if (target === 0) loop.gain.gain.setValueAtTime(0, this.ctx.currentTime + .18);
        }
    }
    private start(loop: Loop) {
        let buffer = this.buffers.get(loop.kind);
        if (!buffer) {
            const samples = ambienceSamples(loop.kind, this.ctx.sampleRate);
            buffer = this.ctx.createBuffer(1, samples.length, this.ctx.sampleRate);
            buffer.getChannelData(0).set(samples); this.buffers.set(loop.kind, buffer);
        }
        const source = this.ctx.createBufferSource(); source.buffer = buffer; source.loop = true;
        source.connect(loop.filter); loop.source = source;
        source.onended = () => { source.disconnect(); if (loop.source === source) loop.source = null; };
        source.start();
    }
    /** Disconnect/unmount: stop both voices; samples remain cached for reconnect. */
    clear() {
        for (const loop of this.loops) {
            const source = loop.source; loop.source = null;
            if (source) { source.onended = null; source.stop(); source.disconnect(); }
            loop.filter.disconnect(); loop.gain.disconnect();
        }
        this.loops = [];
    }
    dispose() { this.clear(); this.buffers.clear(); }
}
