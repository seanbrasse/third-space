import {fileURLToPath} from 'node:url';import {createRequire} from 'node:module';import {spawn} from 'node:child_process';import {mkdtemp,open,mkdir,writeFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {createServer} from 'node:net';import {once} from 'node:events';
const root=fileURLToPath(new URL('..',import.meta.url)).replace(/\/$/,''),require=createRequire(root+'/package.json'),{chromium}=require('@playwright/test');
async function port(){const s=createServer();s.listen(0,'127.0.0.1');await once(s,'listening');const p=s.address().port;await new Promise(resolve=>s.close(resolve));return p;}
const web=await port(),game=await port(),base=`http://127.0.0.1:${web}`,dir=await mkdtemp(tmpdir()+'/third-space-recovery-'),log=await open(dir+'/test.log','a');
const env={...process.env,WEB_PORT:String(web),GAME_PORT:String(game),WEB_ORIGIN:base,GAME_HTTP_URL:`http://127.0.0.1:${game}`,NEXT_PUBLIC_GAME_SERVER_URL:`ws://127.0.0.1:${game}`,DATA_PATH:dir+'/data.sqlite',NEXT_BUILD_DIR:'.next-recovery'};
function backend(){return spawn(process.execPath,[require.resolve('tsx/cli'),'apps/game-server/src/index.ts'],{cwd:root,env,stdio:['ignore',log.fd,log.fd]});}
let server=backend();const frontend=spawn(process.execPath,[require.resolve('next/dist/bin/next',{paths:[root+'/apps/web']}),'dev','--webpack','--hostname','127.0.0.1','--port',String(web)],{cwd:root+'/apps/web',env,stdio:['ignore',log.fd,log.fd]});let browser;
async function ready(url){const until=Date.now()+30000;while(Date.now()<until){try{if((await fetch(url)).ok)return;}catch{}await new Promise(r=>setTimeout(r,100));}throw Error('Isolated service did not start');}
try{
 await mkdir(root+'/tests/e2e/artifacts',{recursive:true});
 await ready(`http://127.0.0.1:${game}/health`);await ready(base);
 browser=await chromium.launch({executablePath:process.env.CHROME_EXECUTABLE||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});const page=await browser.newPage();
 await page.goto(base);await page.getByLabel('Your name',{exact:true}).fill('Restart tester');await page.getByLabel('Home name',{exact:true}).fill('Restart isolated');await page.getByLabel('Choose a private PIN',{exact:true}).fill('123456');await page.getByRole('button',{name:'Create & enter home'}).click();
 const {expect}=require('@playwright/test');await expect(page.locator('.connection')).toHaveText('Connected');
 const homes=await page.evaluate(async()=> (await(await fetch('/api/homes')).json()).homes);const homeId=homes[0].id;
 const stopped=once(server,'exit');server.kill('SIGTERM');await stopped;
 await expect(page.locator('.connection')).not.toHaveText('Connected');await expect(page.getByRole('heading',{name:'Midnight Pines'})).toBeVisible();
 server=backend();await ready(`http://127.0.0.1:${game}/health`);
 await expect(page.locator('.connection')).toHaveText('Connected',{timeout:20000});await expect(page.locator('.world-canvas')).toHaveAttribute('data-world-id','forest');
 const restored=await page.evaluate(async()=>{const s=JSON.parse(sessionStorage.getItem('third-space.session')||'null');return s?.homeId;});if(restored!==homeId)throw Error('Wrong room after restart');
 await page.screenshot({path:root+'/tests/e2e/artifacts/recovery-restart.png',fullPage:true});
 await writeFile(root+'/tests/e2e/artifacts/recovery-verification.json',JSON.stringify({backendRestart:true,stayedInGame:true,sameHome:true,returnedToSafeForestSpawn:true,isolatedPorts:true},null,2));console.log('PASS: isolated graceful backend restart retains game view and rejoins the same home.');
}finally{await browser?.close();server.kill('SIGTERM');frontend.kill('SIGTERM');await log.close();}
