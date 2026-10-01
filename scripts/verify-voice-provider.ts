import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { chromium } from '@playwright/test';
import { LiveKitVoiceProvider } from '../apps/game-server/src/voice-provider';
const require=createRequire(import.meta.url);
const provider=new LiveKitVoiceProvider({url:'ws://127.0.0.1:7880',key:'devkey',secret:'secret'});
const name='third-space-local-privacy-probe-'+Date.now();
const html=`<button id="start">Synthetic audio test</button><script src="/client.js"></script><script>
window.events=[];
window.setup=async(token,publish)=>{
 const room=new LivekitClient.Room();window.room=room;
 room.on('trackSubscribed',(track)=>{events.push('subscribed');window.received=track;const el=track.attach();el.muted=true;document.body.append(el);});
 room.on('trackUnsubscribed',()=>{events.push('unsubscribed');window.received=null;});
 await room.connect('ws://127.0.0.1:7880',token,{autoSubscribe:false});
 if(publish){room.localParticipant.setTrackSubscriptionPermissions(false,[]);const ctx=new AudioContext();window.audioContext=ctx;await ctx.resume();const oscillator=ctx.createOscillator();oscillator.frequency.value=440;const output=ctx.createMediaStreamDestination();window.output=output;oscillator.connect(output);const silent=ctx.createGain();silent.gain.value=0;oscillator.connect(silent);silent.connect(ctx.destination);oscillator.start();const track=new LivekitClient.LocalAudioTrack(output.stream.getAudioTracks()[0]);await room.localParticipant.publishTrack(track,{source:LivekitClient.Track.Source.Microphone});}
};</script>`;
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/client.js'?'text/javascript':'text/html');res.end(req.url==='/client.js'?readFileSync(require.resolve('livekit-client',{paths:['apps/web']})):html);});
await new Promise<void>(r=>server.listen(7970,'127.0.0.1',r));
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try{
 browser=await chromium.launch({headless:true,...(process.env.VOICE_TEST_BROWSER ? { executablePath: process.env.VOICE_TEST_BROWSER } : {})});
 await provider.create(name);
 const a=await browser.newPage(),b=await browser.newPage();await Promise.all([a.goto('http://127.0.0.1:7970'),b.goto('http://127.0.0.1:7970')]);
 await a.evaluate(token=>{document.querySelector('button')!.addEventListener('click',()=>{(window as any).ready=(window as any).setup(token,true);});},provider.token(name,'publisher',true));
 await a.click('#start');await a.evaluate(()=> (window as any).ready);
 await b.evaluate(token=>(window as any).setup(token,false),provider.token(name,'listener',false));
 const peers=await provider.list(name);
 console.log(JSON.stringify({step:'published synthetic audio',participants:peers.map(p=>({identity:p.identity,tracks:p.tracks?.map(t=>({sid:t.sid,type:t.type,source:t.source}))}))}));
 await b.evaluate(()=>{for(const p of (window as any).room.remoteParticipants.values())for(const t of p.trackPublications.values())t.setSubscribed(true);});
 await new Promise(r=>setTimeout(r,1500));console.log(JSON.stringify({step:'client subscription denied',events:await b.evaluate(()=>(window as any).events)}));
 if(await b.evaluate(()=>(window as any).events.includes('subscribed')))throw Error('Listener bypassed initial deny-all ACL');
 await a.evaluate(()=> (window as any).room.localParticipant.setTrackSubscriptionPermissions(false,[{participantIdentity:'listener',allowAll:true}]));
 await b.waitForFunction(()=> (window as any).events.includes('subscribed'),{},{timeout:5000});
 console.log(JSON.stringify({step:'publisher ACL allows authorized listener',events:await b.evaluate(()=>(window as any).events)}));
 await b.click('#start');
 console.log(JSON.stringify({step:'publisher audio state',state:await a.evaluate(async()=>{const w=window as any,an=w.audioContext.createAnalyser();w.audioContext.createMediaStreamSource(w.output.stream).connect(an);await new Promise(r=>setTimeout(r,500));const d=new Float32Array(an.fftSize);an.getFloatTimeDomainData(d);return {state:w.audioContext.state,rms:Math.sqrt(d.reduce((a:number,v:number)=>a+v*v,0)/d.length),track:w.output.stream.getTracks().map((t:MediaStreamTrack)=>({enabled:t.enabled,muted:t.muted,ready:t.readyState}))};})}));
 console.log(JSON.stringify({step:'receiver track state',state:await b.evaluate(()=>{const t=(window as any).received.mediaStreamTrack;return {enabled:t.enabled,muted:t.muted,ready:t.readyState};})}));
 const rms=await b.evaluate(async()=>{const w=window as any,ctx=new AudioContext();await ctx.resume();const source=ctx.createMediaStreamSource(new MediaStream([w.received.mediaStreamTrack]));const analyser=ctx.createAnalyser();source.connect(analyser);const data=new Float32Array(analyser.fftSize);await new Promise(r=>setTimeout(r,2000));analyser.getFloatTimeDomainData(data);const rms=Math.sqrt(data.reduce((sum,v)=>sum+v*v,0)/data.length);await ctx.close();return rms;});
 console.log(JSON.stringify({step:'audio sample',rms,stats:await b.evaluate(async()=>Array.from((await (window as any).received.getRTCStatsReport()).values()).filter((s:any)=>s.type==='inbound-rtp').map((s:any)=>({bytesReceived:s.bytesReceived,packetsReceived:s.packetsReceived,totalAudioEnergy:s.totalAudioEnergy})))}));
 if(rms<.01)throw Error('No decoded synthetic audio');
 console.log(JSON.stringify({step:'decoded synthetic audio',rms}));
 await a.evaluate(()=> (window as any).room.localParticipant.setTrackSubscriptionPermissions(false,[]));
 await b.waitForFunction(()=> (window as any).events.includes('unsubscribed'),{},{timeout:5000});
 await b.evaluate(()=>{for(const p of (window as any).room.remoteParticipants.values())for(const t of p.trackPublications.values())t.setSubscribed(true);});
 await new Promise(r=>setTimeout(r,1000));
 const revoked=await b.evaluate(()=>(window as any).received===null);if(!revoked)throw Error('Listener bypassed revoked ACL');
 console.log(JSON.stringify({step:'ACL revoke denies malicious resubscription',revoked}));
 console.log('PASS');
}finally{await browser?.close();server.close();await provider.delete(name);}
