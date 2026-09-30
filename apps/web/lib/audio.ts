import type { Effect, Snapshot } from "./types";
import { listenerGain } from "./person-volume";
export class SoundboardAudio {
  private context: AudioContext | null = null;
  private environment: {wind:AudioBufferSourceNode;fire:AudioBufferSourceNode;windGain:GainNode;fireGain:GainNode;filter:BiquadFilterNode} | null=null;
  private lastEnvironmentAt=0;
  private howlBucket=0;
  setWorld(snapshot: Snapshot|null,selfId:string,volume:number){
    const ctx=this.context,self=snapshot?.players.find(p=>p.id===selfId);
    if(!ctx||ctx.state!=="running"||!self||self.mode!=="home"||snapshot?.worldId!=="forest"){
      if(this.environment){this.environment.wind.stop();this.environment.fire.stop();this.environment.wind.disconnect();this.environment.fire.disconnect();this.environment.windGain.disconnect();this.environment.fireGain.disconnect();this.environment.filter.disconnect();this.environment=null;}return;
    }
    if(!this.environment){
      const noise=()=>{const b=ctx.createBuffer(1,ctx.sampleRate*2,ctx.sampleRate);const a=b.getChannelData(0);for(let i=0;i<a.length;i++)a[i]=(Math.random()*2-1)*.3;const source=ctx.createBufferSource();source.buffer=b;source.loop=true;return source;};
      const wind=noise(),fire=noise(),windGain=ctx.createGain(),fireGain=ctx.createGain(),filter=ctx.createBiquadFilter();filter.type="lowpass";filter.frequency.value=500;wind.connect(windGain);windGain.connect(filter);filter.connect(ctx.destination);fire.connect(fireGain);fireGain.connect(ctx.destination);wind.start();fire.start();this.environment={wind,fire,windGain,fireGain,filter};this.howlBucket=Math.floor(snapshot.serverTime/65000);
    }
    if(Date.now()-this.lastEnvironmentAt<200)return;this.lastEnvironmentAt=Date.now();
    const level=Math.max(0,Math.min(1,volume));this.environment.windGain.gain.setTargetAtTime(level*.12,ctx.currentTime,.2);this.environment.fireGain.gain.setTargetAtTime(level*.22*Math.max(0,1-Math.hypot(self.x-24,self.y-24)/9),ctx.currentTime,.15);
    const bucket=Math.floor(snapshot.serverTime/65000);
    if(bucket!==this.howlBucket){this.howlBucket=bucket;if(level>0){const o=ctx.createOscillator(),g=ctx.createGain(),pan=ctx.createStereoPanner();o.type="sine";o.frequency.setValueAtTime(340,ctx.currentTime);o.frequency.exponentialRampToValueAtTime(540,ctx.currentTime+.7);o.frequency.exponentialRampToValueAtTime(260,ctx.currentTime+2.4);g.gain.setValueAtTime(.001,ctx.currentTime);g.gain.linearRampToValueAtTime(level*.065,ctx.currentTime+.6);g.gain.exponentialRampToValueAtTime(.001,ctx.currentTime+2.5);pan.pan.value=bucket%2?.8:-.8;o.connect(g);g.connect(pan);pan.connect(ctx.destination);o.start();o.stop(ctx.currentTime+2.6);o.onended=()=>{o.disconnect();g.disconnect();pan.disconnect();};}}
  }
  private count = 0;
  private personVolumes: Record<string, number> = {};
  private master = 0.7;
  private muted = new Set<string>();
  private active = new Set<{
    sourceId: string;
    distance: number;
    output: GainNode;
  }>();
  setMix(
    master: number,
    personVolumes: Record<string, number>,
    muted: Set<string>,
  ) {
    this.master = master;
    this.personVolumes = personVolumes;
    this.muted = muted;
    for (const sound of this.active) {
      sound.output.gain.value = listenerGain(
        master,
        personVolumes[sound.sourceId] ?? 1,
        sound.distance,
        muted.has(sound.sourceId),
      );
    }
  }
  async unlock() {
    this.context ??= new AudioContext();
    await this.context.resume();
  }
  play(effect: Effect, snapshot: Snapshot, selfId: string) {
    const context = this.context;
    if (
      !context ||
      context.state !== "running" ||
      this.count >= 4 ||
      this.muted.has(effect.sourceId) ||
      this.master <= 0
    )
      return;
    const self = snapshot.players.find((p) => p.id === selfId);
    if (!self) return;
    const distance = Math.hypot(self.x - effect.x, self.y - effect.y);
    const gain = listenerGain(
      this.master,
      this.personVolumes[effect.sourceId] ?? 1,
      distance,
      false,
    );
    if (gain <= 0) return;
    this.count++;
    const tones: Record<string, number[]> = {
      chime: [523, 659, 784],
      pop: [280, 140],
      "ta-da": [392, 494, 587, 784],
      boop: [520, 420],
    };
    const frequencies = tones[effect.assetId] || tones.chime;
    const output = context.createGain();
    output.connect(context.destination);
    const sound = { sourceId: effect.sourceId, distance, output };
    this.active.add(sound);
    const envelope = context.createGain();
    envelope.connect(output);
    const pan = context.createStereoPanner();
    pan.pan.value = Math.max(-1, Math.min(1, (effect.x - self.x) / 12));
    pan.connect(envelope);
    const now = context.currentTime;
    output.gain.value = gain;
    envelope.gain.setValueAtTime(1, now);
    envelope.gain.exponentialRampToValueAtTime(0.001, now + 0.65);
    frequencies.forEach((frequency, i) => {
      const tone = context.createOscillator();
      tone.type = effect.assetId === "pop" ? "sine" : "triangle";
      tone.frequency.value = frequency;
      tone.connect(pan);
      tone.start(now + i * 0.09);
      tone.stop(now + 0.65);
      tone.onended = () => tone.disconnect();
    });
    window.setTimeout(() => {
      pan.disconnect();
      envelope.disconnect();
      output.disconnect();
      this.active.delete(sound);
      this.count--;
    }, 800);
  }
  dispose() {
    void this.context?.close();
    this.context = null;
    this.active.clear();
  }
}
