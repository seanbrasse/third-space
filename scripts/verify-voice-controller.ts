import { createServer } from 'node:http';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from '@playwright/test';
import { RoomVoiceService, type VoiceRoomView } from '../apps/game-server/src/voice-service';
import { LiveKitVoiceProvider } from '../apps/game-server/src/voice-provider';
import type { VoiceState } from '@third-space/contracts';
const require=createRequire(import.meta.url);
const { build } = require(require.resolve('esbuild', { paths: [dirname(require.resolve('tsx'))] }));
const fixtureDirectory = mkdtempSync(join(tmpdir(), 'third-space-voice-test-'));
const fixturePath = join(fixtureDirectory, 'fixture.js');
await build({ entryPoints: ['scripts/fixtures/voice-browser.ts'], outfile: fixturePath, bundle: true, platform: 'browser', format: 'iife', nodePaths: [resolve('apps/web/node_modules')] });
const provider=new LiveKitVoiceProvider({url:'ws://127.0.0.1:7880',key:'devkey',secret:'secret'}),states=new Map<string,VoiceState>();
const view:VoiceRoomView={context:{worldRevision:0,mode:'proximity',race:{id:'race',phase:'lobby'}},peers:['a','b'].map((id,i)=>({sessionId:'tab-'+id,accessValid:true,player:{id,x:i,y:0,mode:'home',nativeMode:'enabled',connected:true,manualMute:false,deafened:false}}))};
const service=new RoomVoiceService('controller-probe-'+Date.now(),provider,'ws://127.0.0.1:7880',()=>view,(id,state)=>states.set(id,state));service.publishStates();
let auditing=true;
const timer=setInterval(()=>{if(auditing)void service.sync();},500);
const server=createServer(async(req,res)=>{const url=new URL(req.url!,'http://localhost'),id=url.searchParams.get('id')!,sessionId=url.searchParams.get('session')??'tab-'+id;res.setHeader('Content-Type','application/json');try{
 if(url.pathname==='/token')res.end(JSON.stringify(await service.join(id,sessionId,'fixture')));
 else if(url.pathname==='/state')res.end(JSON.stringify(states.get(id)));
 else if(url.pathname==='/ack'){let raw='';for await(const part of req)raw+=part;const ack=JSON.parse(raw);service.acknowledge(id,sessionId,ack.identity,ack.version);res.end('{}');}
 else if(url.pathname==='/fixture.js'){res.setHeader('Content-Type','text/javascript');res.end(readFileSync(fixturePath));}
 else {res.setHeader('Content-Type','text/html');res.end('<button id="start">Start synthetic test</button><script src="/fixture.js"></script>');}
 }catch(error){console.log('FIXTURE_ERROR',String(error));res.statusCode=500;res.end('{}');}});await new Promise<void>(resolve=>server.listen(7970,'127.0.0.1',resolve));
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const wait=async(page:any,count:number)=>{await page.waitForFunction((n:number)=>document.querySelectorAll('body > audio').length===n,count,{timeout:6000});};
try{
 browser = await chromium.launch({ headless: true, ...(process.env.VOICE_TEST_BROWSER ? { executablePath: process.env.VOICE_TEST_BROWSER } : {}) });
 const a=await browser.newPage(),b=await browser.newPage();for(const page of [a,b])page.on('pageerror',e=>console.log('BROWSER_ERROR:'+e.message));await Promise.all([a.goto('http://127.0.0.1:7970'),b.goto('http://127.0.0.1:7970')]);
 for(const [page,id,mode] of [[b,'b','enabled'],[a,'a','enabled']] as const){await page.evaluate(({id,mode})=>document.querySelector('button')!.addEventListener('click',()=>{(window as any).ready=(window as any).setup(id,mode);}),{id,mode});await page.click('#start');await page.evaluate(()=>(window as any).ready);}
 await wait(b,1);console.log('PASS near pair receives one audio track');
 view.peers[1]!.player.x=20;await wait(b,0);
 await b.evaluate(()=>{const room=(window as any).voice.room;for(const p of room.remoteParticipants.values())for(const t of p.trackPublications.values())t.setSubscribed(true);});
 await new Promise(r=>setTimeout(r,700));if(await b.locator('body > audio').count())throw Error('far listener bypass');console.log('PASS far transition and malicious listener denial');
 view.peers[1]!.player.x=1;await wait(b,1);console.log('PASS near restoration without duplicate track');
 view.peers[1]!.player.zone='asylum';await wait(b,0);view.context.mode='room';await wait(b,1);console.log('PASS interior isolation and whole-room override');
 view.context.mode='proximity';view.peers[1]!.player.zone=undefined;view.peers[1]!.player.mode='race';view.peers[1]!.player.x=100;view.context.race.phase='waiting';view.context.race.joinedIds=['b'];await wait(b,1);
 view.context.race.phase='running';await wait(b,0);console.log('PASS waiting bridge and active race isolation');
 view.context.mode='room';await wait(b,1);
 await a.evaluate(()=>{const w=window as any;w.retiredToken=w.voice.room.engine.token;const claims=JSON.parse(atob(w.retiredToken.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));w.refreshLifetime=claims.exp-Math.floor(Date.now()/1000);w.refreshCanPublish=claims.video.canPublish===true;});
 if(!await a.evaluate(()=>Number.isFinite((window as any).refreshLifetime)&&(window as any).refreshLifetime>590&&(window as any).refreshCanPublish))throw Error('Expected a real provider-refreshed token');
 console.log('PASS provider refreshed-token lifetime observed without logging token');
 await a.evaluate(()=>{const w=window as any;w.voice.stop();w.rejoining=w.voice.start('enabled');});await a.evaluate(()=>(window as any).rejoining);await wait(b,1);await new Promise(r=>setTimeout(r,700));if(await b.locator('body > audio').count()!==1)throw Error('duplicate after rejoin');console.log('PASS voice rejoin uses one current peer track');
 // Stop roster sweeps briefly: current publishers must deny the retired identity independently.
 auditing=false;
 const replay=await browser.newPage();await replay.goto('http://127.0.0.1:7970');
 const retiredToken=await a.evaluate(()=>(window as any).retiredToken);
 const replayPermissions=await replay.evaluate(token=>(window as any).replay(token),retiredToken);
 await new Promise(r=>setTimeout(r,700));
 if(await replay.evaluate(()=>(window as any).replaySubscriptions)!==0)throw Error('Retired identity regained hearing authorization');
 console.log('PASS retired identity cannot hear current publishers between roster sweeps');
 if(!replayPermissions.canPublish)throw Error('Local fixture no longer reproduces documented self-host refresh replay risk');
 console.log('EXPECTED_LOCAL_LIMITATION refreshed token can rejoin with old publishing grant; production requires strict provider revocation');
 auditing=true;await replay.waitForFunction(()=>(window as any).replayed.state==='disconnected',{},{timeout:6000});await replay.close();
 console.log('PASS unknown retired identity removed by roster controller');
 // Replace the game admission, reject its old tab, and require a fresh voice lease.
 view.peers[0]!.sessionId='tab-a-replacement';service.publishStates();await wait(b,0);
 let rejected=false;try{await service.join('a','tab-a','retired-tab');}catch{rejected=true;}if(!rejected)throw Error('Old tab regained voice admission');
 await a.waitForFunction(()=>(window as any).lastUI.phase==='error',{},{timeout:6000});
 await a.evaluate(()=>{const w=window as any;w.sessionId='tab-a-replacement';w.rejoining=w.voice.start('enabled');});await a.evaluate(()=>(window as any).rejoining);await wait(b,1);
 console.log('PASS active-tab replacement rejects old tab and rejoins with fresh lease');
 view.peers[0]!.accessValid=false;service.publishStates();await wait(b,0);
 rejected=false;try{await service.join('a','tab-a-replacement','revoked');}catch{rejected=true;}if(!rejected)throw Error('Revoked user regained voice admission');
 await a.waitForFunction(()=>(window as any).lastUI.phase==='error',{},{timeout:6000});
 view.peers[0]!.accessValid=true;
 await a.evaluate(()=>{const w=window as any;w.rejoining=w.voice.start('enabled');});await a.evaluate(()=>(window as any).rejoining);await wait(b,1);
 console.log('PASS kick ends forwarding and authorized re-admission creates fresh lease');
 view.peers[0]!.player.connected=false;service.publishStates();await wait(b,0);
 await a.waitForFunction(()=>(window as any).lastUI.phase==='error',{},{timeout:6000});
 view.peers[0]!.player.connected=true;
 await a.evaluate(()=>{const w=window as any;w.rejoining=w.voice.start('enabled');});await a.evaluate(()=>(window as any).rejoining);await wait(b,1);
 console.log('PASS game-session leave stops media and fresh admission rejoins once');
 await a.evaluate(()=>(window as any).paused=true);await wait(b,0);await a.waitForFunction(()=>(window as any).lastUI.phase==='error',{},{timeout:6000});console.log('PASS stale publisher watchdog disconnects media');
 console.log('PASS');
}finally{await browser?.close();clearInterval(timer);server.close();await service.dispose();rmSync(fixtureDirectory,{recursive:true,force:true});}
