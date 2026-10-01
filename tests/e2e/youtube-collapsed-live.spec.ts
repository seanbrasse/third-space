import { test, expect } from '@playwright/test';
test('LIVE collapsed TV playback stays continuous', async ({browser,page})=>{
 test.skip(process.env.YOUTUBE_LIVE !== '1', 'Opt in to real external-provider playback');test.setTimeout(240000);const context=await browser.newContext(),guest=await context.newPage();
 const errors:string[]=[];
 for(const p of [page,guest])p.on('pageerror',e=>errors.push(e.message));
 try{
 const name='Watching '+Date.now();await page.goto('/');await page.getByLabel('Your name',{exact:true}).fill('Ari');await page.getByLabel('Home name',{exact:true}).fill(name);await page.getByLabel('Choose a private PIN',{exact:true}).fill('123456');await page.getByRole('button',{name:'Create & enter home'}).click();await expect(page.locator('.connection')).toHaveText('Connected');
 const id=await page.evaluate(async n=>(await(await fetch('/api/homes')).json()).homes.find((h:{name:string})=>h.name===n).id,name);
 await guest.goto('http://127.0.0.1:3010');await guest.getByLabel('Your name',{exact:true}).fill('Remy');await guest.getByRole('button',{name:'Join friends',exact:true}).click();await guest.getByLabel('Home ID',{exact:true}).fill(id);await guest.getByLabel('Room PIN',{exact:true}).fill('123456');await guest.getByRole('button',{name:'Join your friends'}).click();await expect(guest.locator('.connection')).toHaveText('Connected');

 // Watching belongs only in the independently entered asylum interior.
 for(const p of [page,guest]){
  await expect(p.locator('.world-canvas')).toHaveAttribute('data-seat-id',/camp-seat-/);
  await p.locator('.world-canvas').focus();
  for(const point of [{x:24,y:28},{x:27,y:28},{x:27,y:24},...Array.from({length:6},(_,i)=>({x:34+i*7,y:24})),{x:69,y:17},{x:69,y:13.5}]){
   const q=await p.locator('.world-canvas').evaluate((el,point)=>{const d=(el as HTMLElement).dataset,b=el.querySelector('canvas')!.getBoundingClientRect();return{x:b.x+(point.x*32-Number(d.cameraScrollX))*Number(d.cameraZoom),y:b.y+(point.y*32-Number(d.cameraScrollY))*Number(d.cameraZoom)}},point);await p.mouse.click(q.x,q.y);await expect.poll(async()=>{const d=await p.locator('.world-canvas').evaluate(el=>(el as HTMLElement).dataset);return d.worldId==="asylum"?0:Math.hypot(Number(d.authoritativeX)-point.x,Number(d.authoritativeY)-point.y)},{timeout:9000}).toBeLessThan(.5);
  }
  await p.keyboard.press('e');await expect(p.locator('.world-canvas')).toHaveAttribute('data-world-id','asylum');
 }

 for(const p of [page,guest])await p.getByRole('button',{name:'▣ Watch together'}).click();
 await page.getByLabel('Video link').fill(process.env.YOUTUBE_VIDEO_URL || 'https://youtu.be/8wUfa7HwuLI');await page.getByRole('button',{name:'Load for everyone'}).click();

 await page.waitForTimeout(10000);
 await page.getByRole('button',{name:'Play video for everyone',exact:true}).click();for(const p of [page,guest])await p.getByRole('button',{name:'Close shared screen'}).click();
 const samples:any[]=[];
 for(let i=0;i<30;i++){
  await page.waitForTimeout(1000);
  const both=await Promise.all([page,guest].map(async p=>{
   const frame=p.frames().find(f=>f.url().includes('youtube.com/embed'));
   return frame?frame.locator('video').evaluate((v:any)=>({time:v.currentTime,paused:v.paused,ready:v.readyState,network:v.networkState,error:v.error?.code??null}),undefined,{timeout:1500}).catch(()=>({unavailable:true})):null;
  }));samples.push({at:i+1,both});
 }
 console.log('LIVE_YOUTUBE_EVIDENCE '+JSON.stringify({samples,errors}));
 await page.screenshot({path:'tests/e2e/artifacts/youtube-live-current.png'});
 for(let client=0;client<2;client++){
  const measured=samples.map(s=>s.both[client]).filter(s=>typeof s?.time==='number');
  expect(measured.length).toBeGreaterThan(25);
  expect(measured.at(-1).time-measured[0].time).toBeGreaterThan(24);
 }
 expect(errors).toEqual([]);
 }finally{await context.close();}
});
