import { movementAudioCues } from "./movement-audio";
import { ForestAmbience } from "./forest-ambience";
import { AsylumAmbience, asylumAudioLocation } from "./asylum-ambience";
import {ambienceSamples} from "./ambience";
import { RaceAudio } from "./race-audio";
import { gameSoundGain,gameSoundSamples,type GameSoundKind } from "./game-sound";
import type { WorldSoundEvent } from "@third-space/contracts";
import type { Effect, Snapshot } from "./types";
import { listenerGain } from "./person-volume";
export class SoundboardAudio {
  private race = new RaceAudio();
  private context: AudioContext | null = null;
  private environmentOutput: GainNode | null = null;
  private gameMuted = false;
  private samples=new Map<GameSoundKind,AudioBuffer>();
  private stepAt=new Map<string,number>();
  private heard=new Set<string>();
  private soundInstance="";
  private gameNodes=0;
  private gameOutput(ctx:AudioContext){if(!this.environmentOutput){this.environmentOutput=ctx.createGain();this.environmentOutput.gain.value=this.gameMuted?0:1;this.environmentOutput.connect(ctx.destination);}return this.environmentOutput;}
  private cue(kind:GameSoundKind,x:number,y:number,self:{x:number;y:number},volume:number,own=false){
    const ctx=this.context;if(!ctx||ctx.state!=="running"||this.gameMuted||this.gameNodes>=16)return;
    const d=Math.hypot(x-self.x,y-self.y),level=gameSoundGain(kind,d,volume)*(own ? .45 : 1);if(level<=0)return;
    let buffer=this.samples.get(kind);if(!buffer){const data=gameSoundSamples(kind,ctx.sampleRate);buffer=ctx.createBuffer(1,data.length,ctx.sampleRate);buffer.getChannelData(0).set(data);this.samples.set(kind,buffer);}
    const source=ctx.createBufferSource(),gain=ctx.createGain(),pan=ctx.createStereoPanner();source.buffer=buffer;gain.gain.value=level;pan.pan.value=Math.max(-1,Math.min(1,(x-self.x)/8));
    source.connect(gain);gain.connect(pan);pan.connect(this.gameOutput(ctx));this.gameNodes++;source.start();source.onended=()=>{source.disconnect();gain.disconnect();pan.disconnect();this.gameNodes=Math.max(0,this.gameNodes-1);};
  }
  playWorld(event:WorldSoundEvent,snapshot:Snapshot,selfId:string,volume:number){
    if(event.expiresAt<snapshot.serverTime||this.heard.has(event.id)
      ||(event.epoch!==undefined&&event.epoch!==snapshot.epoch)
      ||(event.worldRevision!==undefined&&event.worldRevision!==snapshot.worldRevision))return;
    this.heard.add(event.id);if(this.heard.size>256)this.heard.delete(this.heard.values().next().value!);
    const self=snapshot.players.find(p=>p.id===selfId);if(!self||self.mode!=="home"||self.zone||(snapshot.worldId!=="forest"&&["howl","growl","claw"].includes(event.kind)))return;
    // The victim hears the impact at full personal game level, before their respawn.
    this.cue(event.kind,event.x,event.y,event.victimId===selfId?event:self,volume);
  }
  private movement(snapshot:Snapshot|null,selfId:string,volume:number){
    if(!snapshot){this.stepAt.clear();this.soundInstance="";return;}
    const ctx=this.context,self=snapshot?.players.find(p=>p.id===selfId);if(!ctx||ctx.state!=="running"||!snapshot||!self)return;
    if(this.soundInstance!==snapshot.instanceId){this.soundInstance=snapshot.instanceId;this.stepAt.clear();}
    const now=snapshot.serverTime;
    const live=new Set(snapshot.players.map(p=>p.id));live.add("clown");live.add("werewolf");for(const id of this.stepAt.keys())if(!live.has(id))this.stepAt.delete(id);
    const cues=movementAudioCues(snapshot,selfId,this.muted);
    const moving=new Set(cues.map(cue=>cue.id));
    for(const id of this.stepAt.keys())if(!moving.has(id))this.stepAt.delete(id);
    for(const cue of cues){
      if(now-(this.stepAt.get(cue.id)??-Infinity)<cue.interval)continue;
      this.stepAt.set(cue.id,now);this.cue(cue.kind,cue.x,cue.y,self,volume,cue.own);
    }
  }
  private forestAmbience: ForestAmbience | null = null;
  private asylumAmbience: AsylumAmbience | null = null;
  private lastWorld: {snapshot:Snapshot|null;selfId:string;volume:number} | null = null;
  private wasOutside = false;
  private lastEnvironmentAt=0;
  private howlBucket=0;
  private natureNodes=new Set<AudioBufferSourceNode>();
  setWorld(snapshot: Snapshot|null,selfId:string,volume:number){
    this.lastWorld={snapshot,selfId,volume};
    this.race.setWorld(this.context,snapshot,selfId,volume);
    this.movement(snapshot,selfId,volume);
    const ctx=this.context,self=snapshot?.players.find(p=>p.id===selfId);
    const outside=!!self&&self.connected&&self.mode==="home"&&!self.zone&&snapshot?.worldId==="forest";
    if(ctx)this.forestAmbience??=new ForestAmbience(ctx,this.gameOutput(ctx));
    if(!snapshot)this.forestAmbience?.clear();
    else this.forestAmbience?.update({outside,x:self?.x??0,y:self?.y??0,volume});
    const indoor = asylumAudioLocation(snapshot,selfId,volume);
    if(ctx&&indoor.inside)this.asylumAmbience??=new AsylumAmbience(ctx,this.gameOutput(ctx));
    this.asylumAmbience?.update(indoor);
    if(!outside){
      for(const source of this.natureNodes){source.stop();source.disconnect();}this.natureNodes.clear();
      this.wasOutside=false;return;
    }
    if(!ctx||ctx.state!=="running")return;
    if(!this.wasOutside){this.wasOutside=true;this.howlBucket=Math.floor(snapshot.serverTime/95000);}
    if(Date.now()-this.lastEnvironmentAt<200)return;this.lastEnvironmentAt=Date.now();
    const level=Math.max(0,Math.min(1,volume));
    const bucket=Math.floor(snapshot.serverTime/95000);
    if(bucket!==this.howlBucket){this.howlBucket=bucket;if(level>0&&!this.gameMuted){const kind=bucket%3===0?'wolf':'owl',data=ambienceSamples(kind,ctx.sampleRate,bucket),buffer=ctx.createBuffer(1,data.length,ctx.sampleRate);buffer.getChannelData(0).set(data);const source=ctx.createBufferSource(),gain=ctx.createGain(),pan=ctx.createStereoPanner();source.buffer=buffer;gain.gain.value=level*(kind==='wolf'?.12:.08);pan.pan.value=kind==='wolf'?0:bucket%2?.65:-.65;source.connect(gain);gain.connect(pan);pan.connect(this.gameOutput(ctx));this.natureNodes.add(source);source.start();source.onended=()=>{this.natureNodes.delete(source);source.disconnect();gain.disconnect();pan.disconnect();};}}

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
    gameMuted = false,
  ) {
    this.gameMuted = gameMuted;
    this.race.setMuted(gameMuted);
    if(this.environmentOutput)this.environmentOutput.gain.value=gameMuted?0:1;
    this.master = gameMuted ? 0 : master;
    this.personVolumes = personVolumes;
    this.muted = muted;
    for (const sound of this.active) {
      sound.output.gain.value = listenerGain(
        this.master,
        personVolumes[sound.sourceId] ?? 1,
        sound.distance,
        muted.has(sound.sourceId),
      );
    }
  }
  async resumeAfterGesture() {
    // A real gesture may recover browser suspension; never create audio or change mute here.
    if (this.context && this.context.state !== "running" && this.context.state !== "closed") await this.unlock();
  }
  async unlock() {
    this.context ??= new AudioContext();
    await this.context.resume();
    if(this.lastWorld){const {snapshot,selfId,volume}=this.lastWorld;this.setWorld(snapshot,selfId,volume);}
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
    this.asylumAmbience?.dispose();this.asylumAmbience=null;
    this.forestAmbience?.dispose();this.forestAmbience=null;this.lastWorld=null;this.wasOutside=false;
    for(const source of this.natureNodes){source.stop();source.disconnect();}this.natureNodes.clear();
    this.race.dispose();
    void this.context?.close();
    this.context = null;
    this.environmentOutput = null;
    this.active.clear();this.samples.clear();this.stepAt.clear();this.heard.clear();this.gameNodes=0;
  }
}
