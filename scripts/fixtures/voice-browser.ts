import { NativeVoice } from '../../apps/web/lib/native-voice';
import { Room, LocalAudioTrack } from 'livekit-client';
const w=window as any; w.lastUI=null; w.paused=false; w.voice=null;
w.replay=async(token:string)=>{const room=new Room();w.replayed=room;w.replaySubscriptions=0;room.on('trackSubscribed',()=>w.replaySubscriptions++);await room.connect('ws://127.0.0.1:7880',token,{autoSubscribe:false});for(const p of room.remoteParticipants.values())for(const t of p.trackPublications.values())t.setSubscribed(true);return {canPublish:room.localParticipant.permissions?.canPublish===true};};
w.setup=async(id:string,mode:'listen'|'enabled')=>{
 w.sessionId='tab-'+id;
 const voice=new NativeVoice(()=>fetch('/token?id='+id+'&session='+w.sessionId).then(r=>r.json()),state=>w.lastUI=state,{
  createRoom:()=>new Room(),devices:async()=>[],capture:async()=>{const ctx=new AudioContext();await ctx.resume();const osc=ctx.createOscillator(),out=ctx.createMediaStreamDestination(),silent=ctx.createGain();silent.gain.value=0;osc.frequency.value=440;osc.connect(out);osc.connect(silent);silent.connect(ctx.destination);osc.start();return new LocalAudioTrack(out.stream.getAudioTracks()[0]!);}
 },(identity,version)=>{void fetch('/ack?id='+id+'&session='+w.sessionId,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({identity,version})});});
 voice.setMix(0,{},new Set());w.voice=voice;
 setInterval(()=>{if(!w.paused)void fetch('/state?id='+id).then(r=>r.json()).then(state=>voice.updateState(state));voice.checkFreshness();},250);
 await voice.start(mode);
};
