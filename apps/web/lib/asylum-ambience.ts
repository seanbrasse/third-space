import { getWorld } from '@third-space/config';
import type { Snapshot } from './types';
import { asylumSamples, asylumStaticGain, type AsylumSoundKind } from './asylum-sound';
export interface AsylumAudioLocation { inside: boolean; playing: boolean; x: number; y: number; volume: number; }
export function asylumAudioLocation(snapshot: Snapshot | null, selfId: string, volume: number): AsylumAudioLocation {
    const self = snapshot?.players.find(p => p.id === selfId);
    return {
        inside: !!self?.connected && self.mode === 'home' && (self.zone === 'asylum' || snapshot?.worldId === 'asylum'),
        // Shared play intent also suppresses the bed during buffering, so it
        // cannot compete with the first audible frame. Pause/end restores idle.
        playing: !!snapshot?.media?.url && snapshot.media.playing,
        x: self?.x ?? 0, y: self?.y ?? 0, volume,
    };
}
type Loop = { kind: AsylumSoundKind; source: AudioBufferSourceNode | null; gain: GainNode; filter: BiquadFilterNode; pan: StereoPannerNode; target: number; };
/** At most two active voices. Playback fades to zero; leaving frees all nodes. */
export class AsylumAmbience {
    private buffers = new Map<AsylumSoundKind, AudioBuffer>();
    private loops: Loop[] = [];
    constructor(private ctx: AudioContext, private output: AudioNode) {}
    update(location: AsylumAudioLocation) {
        if (!location.inside) { this.clear(); return; }
        if (this.ctx.state === 'closed') return;
        if (!location.playing && this.ctx.state === 'running') {
            if (!this.loops.length) this.loops = (['room', 'static'] as const).map(kind => {
                const gain = this.ctx.createGain(), filter = this.ctx.createBiquadFilter(), pan = this.ctx.createStereoPanner();
                gain.gain.value = 0;
                filter.type = kind === 'room' ? 'lowpass' : 'bandpass';
                filter.frequency.value = kind === 'room' ? 900 : 2200;
                filter.Q.value = .6;
                filter.connect(gain); gain.connect(pan); pan.connect(this.output);
                return { kind, source: null, gain, filter, pan, target: -1 };
            });
            for (const loop of this.loops) if (!loop.source) this.start(loop);
        }
        const tv = getWorld('asylum').mediaSurface.source, level = Math.max(0, Math.min(1, location.volume));
        for (const loop of this.loops) {
            loop.pan.pan.value = loop.kind === 'static' ? Math.max(-1, Math.min(1, (tv.x - location.x) / 8)) : 0;
            const target = location.playing ? 0 : loop.kind === 'room' ? level * .08
                : asylumStaticGain(Math.hypot(location.x - tv.x, location.y - tv.y), level);
            if (Math.abs(target - loop.target) < .0005) continue;
            loop.target = target;
            loop.gain.gain.cancelScheduledValues(this.ctx.currentTime);
            loop.gain.gain.setTargetAtTime(target, this.ctx.currentTime, location.playing ? .015 : .3);
        }
    }
    private start(loop: Loop) {
        let buffer = this.buffers.get(loop.kind);
        if (!buffer) {
            const data = asylumSamples(loop.kind, this.ctx.sampleRate);
            buffer = this.ctx.createBuffer(1, data.length, this.ctx.sampleRate);
            buffer.getChannelData(0).set(data); this.buffers.set(loop.kind, buffer);
        }
        const source = this.ctx.createBufferSource(); source.buffer = buffer; source.loop = true;
        source.connect(loop.filter); loop.source = source;
        source.onended = () => { source.disconnect(); if (loop.source === source) loop.source = null; };
        source.start();
    }
    clear() {
        for (const loop of this.loops) {
            const source = loop.source; loop.source = null;
            if (source) { source.onended = null; source.stop(); source.disconnect(); }
            loop.filter.disconnect(); loop.gain.disconnect(); loop.pan.disconnect();
        }
        this.loops = [];
    }
    dispose() { this.clear(); this.buffers.clear(); }
}
