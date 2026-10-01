import type { PlayerState, RoomSnapshot } from '@third-space/contracts';

export type RaceCue = 'jump' | 'death' | 'pickup';
/** Only authoritative increases cue audio. First/old/reconnected snapshots establish a baseline. */
export class RaceAudioEvents {
  private key = '';
  private at = -1;
  private counts = [0, 0, 0];
  private connected = false;
  observe(snapshot: RoomSnapshot | null, selfId: string): RaceCue[] {
    const self = snapshot?.players.find(p => p.id === selfId);
    if (!snapshot || !self || self.mode !== 'race' || !self.connected) {
      this.key = ''; this.at = -1; this.connected = false; return [];
    }
    const key = `${snapshot.instanceId}:${selfId}`;
    const counts = [self.raceJumpCount ?? 0, self.raceDeathCount ?? 0, self.racePickupCount ?? 0];
    if (key !== this.key || !this.connected) {
      this.key = key; this.counts = counts; this.at = snapshot.serverTime; this.connected = true; return [];
    }
    if (snapshot.serverTime <= this.at) return [];
    const cues: RaceCue[] = [];
    // An impact supersedes a jump in the same snapshot; at most one of each per packet.
    if (counts[1] > this.counts[1]) cues.push('death');
    else if (counts[0] > this.counts[0]) cues.push('jump');
    if (counts[2] > this.counts[2] && !cues.includes('death')) cues.push('pickup');
    this.counts = counts; this.at = snapshot.serverTime;
    return cues;
  }
}

const TAU = Math.PI * 2;
const note = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
/** Original 132 BPM garden chiptune: four chords, bright melody, bass and soft tick. */
export function raceSamples(kind: RaceCue | 'theme', sampleRate: number): Float32Array {
  const beat = 60 / 132;
  const duration = kind === 'theme' ? beat * 16 : kind === 'death' ? .48 : kind === 'jump' ? .16 : .25;
  const data = new Float32Array(Math.ceil(sampleRate * duration));
  const melody = [72, 76, 79, 76, 74, 77, 81, 77, 71, 74, 79, 74, 72, 76, 79, 84,
    81, 79, 76, 72, 77, 81, 84, 81, 79, 77, 74, 71, 76, 74, 72, 79];
  const roots = [48, 53, 55, 48];
  for (let i = 0; i < data.length; i++) {
    const t = i / sampleRate;
    if (kind === 'theme') {
      const step = Math.min(31, Math.floor(t / (beat / 2))), phase = t % (beat / 2);
      const chord = Math.floor(step / 8), root = roots[chord];
      const attack = Math.min(1, phase / .008), release = Math.min(1, (beat / 2 - phase) / .035);
      const freq = note(melody[step]);
      const lead = (Math.sin(TAU * freq * t) + .22 * Math.sin(TAU * freq * 2 * t)) * .15 * attack * release;
      const bassPhase = t % beat;
      const bass = Math.sin(TAU * note(root + (Math.floor(t / beat) % 2 ? 7 : 0)) * t) * .1 * Math.exp(-bassPhase * 5);
      const hat = Math.sin(TAU * 7100 * t) * Math.sin(TAU * 4900 * t) * .025 * Math.exp(-phase * 95);
      const pad = [0, 4, 7].reduce((v, interval) => v + Math.sin(TAU * note(root + 12 + interval) * t) * .014, 0);
      // Integer number of beats and final short edge fades keep the loop click-free.
      const edge = Math.min(1, t / .006, (duration - t) / .012);
      data[i] = (lead + bass + hat + pad) * edge;
    } else {
      const envelope = Math.sin(Math.PI * t / duration) ** 2;
      if (kind === 'jump') data[i] = Math.sin(TAU * (330 * t + 1500 * t * t)) * envelope * .36;
      else if (kind === 'death') data[i] = (Math.sin(TAU * (260 * t - 180 * t * t)) + .22 * Math.sin(TAU * 80 * t)) * envelope * .36;
      else data[i] = Math.sin(TAU * note([76, 79, 84][Math.min(2, Math.floor(t / (duration / 3)))]) * t) * envelope * .34;
    }
  }
  return data;
}
export function raceMusicAllowed(snapshot: RoomSnapshot | null, self: PlayerState | undefined, visible: boolean) {
  return visible && !!self?.connected && self.mode === 'race' && self.finishedAt === undefined &&
    (snapshot?.race?.phase === 'countdown' || snapshot?.race?.phase === 'running');
}

/** Shares the existing gesture-unlocked context, with an independent game-volume bus. */
export class RaceAudio {
  private events = new RaceAudioEvents();
  private context: AudioContext | null = null;
  private output: GainNode | null = null;
  private music: { source: AudioBufferSourceNode; gain: GainNode } | null = null;
  private sources = new Set<AudioBufferSourceNode>();
  private samples = new Map<string, AudioBuffer>();
  private muted = false;
  private volume = 0;
  private visibility = () => { this.events = new RaceAudioEvents(); if (document.hidden) this.stop(false); };
  constructor() { if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.visibility); }
  setMuted(muted: boolean) {
    this.muted = muted;
    if (this.output) this.output.gain.value = muted ? 0 : this.volume;
    if (muted) this.stop(false);
  }
  private buffer(kind: RaceCue | 'theme', ctx: AudioContext) {
    let buffer = this.samples.get(kind);
    if (!buffer) {
      const data = raceSamples(kind, ctx.sampleRate);
      buffer = ctx.createBuffer(1, data.length, ctx.sampleRate);
      buffer.getChannelData(0).set(data); this.samples.set(kind, buffer);
    }
    return buffer;
  }
  setWorld(ctx: AudioContext | null, snapshot: RoomSnapshot | null, selfId: string, volume: number, visible = typeof document === 'undefined' || !document.hidden) {
    const cues = this.events.observe(snapshot, selfId);
    const self = snapshot?.players.find(p => p.id === selfId);
    this.volume = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 0;
    if (!ctx || ctx.state !== 'running' || !visible || this.muted || this.volume === 0 || !self?.connected || self.mode !== 'race') { this.stop(false); return; }
    if (this.context !== ctx) {
      this.stop(false); this.output?.disconnect(); this.samples.clear(); this.context = ctx;
      this.output = ctx.createGain(); this.output.connect(ctx.destination);
    }
    this.output!.gain.value = this.volume;
    if (raceMusicAllowed(snapshot, self, visible)) {
      if (!this.music) {
        const source = ctx.createBufferSource(), gain = ctx.createGain();
        source.buffer = this.buffer('theme', ctx); source.loop = true; gain.gain.value = 0;
        source.connect(gain); gain.connect(this.output!);
        gain.gain.setTargetAtTime(.24, ctx.currentTime, .08);
        source.start(); this.music = { source, gain };
      }
    } else this.stopMusic(true);
    for (const cue of cues) {
      if (this.sources.size >= 4) break;
      const source = ctx.createBufferSource(), gain = ctx.createGain();
      source.buffer = this.buffer(cue, ctx); gain.gain.value = cue === 'death' ? .45 : .28;
      source.connect(gain); gain.connect(this.output!); this.sources.add(source);
      source.onended = () => { this.sources.delete(source); source.disconnect(); gain.disconnect(); };
      source.start();
    }
  }
  private stopMusic(fade: boolean) {
    const music = this.music, ctx = this.context; if (!music || !ctx) return;
    this.music = null;
    if (fade) { music.gain.gain.setTargetAtTime(0, ctx.currentTime, .035); music.source.stop(ctx.currentTime + .15); }
    else music.source.stop();
    music.source.onended = () => { music.source.disconnect(); music.gain.disconnect(); };
  }
  private stop(fade: boolean) { this.stopMusic(fade); for (const source of this.sources) source.stop(); this.sources.clear(); }
  dispose() {
    this.stop(false); this.output?.disconnect(); this.output = null; this.context = null; this.samples.clear();
    this.events = new RaceAudioEvents();
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.visibility);
  }
}
