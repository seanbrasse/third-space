import { gameAction } from "./menu-actions";
import { test, expect } from '@playwright/test';
test('YouTube adapter follows shared member controls, persistent TV surface and queue and game mute stays independent', async ({browser,page})=>{
 test.setTimeout(150000);const context=await browser.newContext(),guest=await context.newPage();
 const errors:string[]=[];
 const mock=`window.YT={Player:class{constructor(el,o){this.seeks=0;this.events=o.events;this.t=0;this.s=2;this.v=100;this.at=Date.now();this.el=document.createElement('iframe');this.el.title='YouTube test adapter';el.replaceWith(this.el);window.__yt=this;setTimeout(()=>o.events.onReady(),0)}getCurrentTime(){return this.t+(this.s===1?(Date.now()-this.at)/1000:0)}getDuration(){return 300}getPlayerState(){return this.s}playVideo(){this.t=this.getCurrentTime();this.at=Date.now();this.s=1}pauseVideo(){this.t=this.getCurrentTime();this.s=2}seekTo(t){this.seeks++;this.t=t;this.at=Date.now()}setVolume(v){this.v=v}destroy(){this.el.remove();window.__yt=null}}};window.onYouTubeIframeAPIReady?.();`;
 for(const p of [page,guest]){p.on('pageerror',e=>errors.push(e.message));await p.route('https://www.youtube.com/iframe_api',route=>route.fulfill({contentType:'text/javascript',body:mock}));}
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

 for(const p of [page,guest])await gameAction(p, () => p.getByRole('button',{name:'▣ Watch together'}).click());
 await page.getByLabel('Video link').fill('https://youtu.be/M7lc1UVf-VE?t=12');await page.getByRole('button',{name:'Load for everyone'}).click();
 const state=(p:typeof page)=>p.evaluate(()=>{const w=window as unknown as {__yt?:{getCurrentTime:()=>number;getPlayerState:()=>number;v:number}};return w.__yt?{t:w.__yt.getCurrentTime(),s:w.__yt.getPlayerState(),v:w.__yt.v}:null;});
 await expect.poll(async()=>(await state(guest))?.t).toBe(12);
 await expect(page.locator('.youtube-player')).toHaveCSS('pointer-events','none');await page.getByRole('button',{name:'Play video for everyone',exact:true}).click();await expect.poll(async()=>(await state(guest))?.s).toBe(1);await page.waitForTimeout(6000);await expect.poll(async()=>(await state(page))?.s).toBe(1);
 // A slow decoder stays buffering beyond the old1.2s correction threshold.
 const before=await guest.evaluate(()=>{const p=(window as any).__yt;p.t=p.getCurrentTime();p.s=3;return p.seeks});
 await guest.waitForTimeout(7000);
 expect(await guest.evaluate(()=>(window as any).__yt.seeks)).toBe(before);
 await guest.evaluate(()=>{const p=(window as any).__yt;p.s=1;p.at=Date.now()});
 // Sustained keyframe lag used to cause a new seek every ten seconds.
 await guest.evaluate(()=>{const p=(window as any).__yt;p.t=Math.max(0,p.t-4);p.getDuration=()=>1});
 await guest.waitForTimeout(12000);
 expect(await guest.evaluate(()=>(window as any).__yt.seeks)).toBe(before);
 await expect(page.getByRole('button',{name:'Pause together',exact:true})).toBeVisible();
 await guest.evaluate(()=>{(window as any).__yt.getDuration=()=>300});
 await guest.getByRole('button',{name:'Pause video for everyone',exact:true}).click();await expect.poll(async()=>(await state(page))?.s).toBe(2);
 await page.getByLabel('Seek (seconds)').fill('23');await page.getByRole('button',{name:'Seek together'}).click();await expect.poll(async()=>(await state(guest))?.t).toBe(23);
 await page.getByLabel('Video link').fill('https://youtu.be/dQw4w9WgXcQ');await page.getByRole('button',{name:'Add to queue'}).click();await expect(guest.getByRole('list',{name:'Shared video queue'})).toContainText('dQw4w9WgXcQ');
 await guest.getByLabel('Video link').fill('https://example.com/discard.mp4');await guest.getByRole('button',{name:'Add to queue'}).click();await page.getByLabel('Remove queued video 2').click();await expect(guest.getByRole('list',{name:'Shared video queue'})).not.toContainText('discard.mp4');
 await page.getByRole('button',{name:'Full screen',exact:true}).click();await expect.poll(()=>page.evaluate(()=>!!document.fullscreenElement)).toBe(true);await page.keyboard.press('Escape');await expect.poll(()=>page.evaluate(()=>!!document.fullscreenElement)).toBe(false);await page.getByRole('button',{name:'Play video for everyone',exact:true}).click();await expect.poll(async()=>(await state(guest))?.s).toBe(1);await guest.getByRole('button',{name:'Pause video for everyone',exact:true}).click();await expect.poll(async()=>(await state(page))?.s).toBe(2);
 await guest.getByRole('button',{name:'Play next'}).click();await expect.poll(async()=>(await state(page))?.s).toBe(1);await expect(page.getByRole('list',{name:'Shared video queue'}).locator('li')).toHaveCount(0);
 await guest.getByRole('button',{name:'Close shared screen'}).click();await expect(guest.locator('.shared-watching.surface iframe')).toHaveCount(1);const screenBox=await guest.locator('.shared-watching.surface').boundingBox();expect(screenBox!.width).toBeGreaterThan(150);expect(screenBox!.width/screenBox!.height).toBeCloseTo(16/9,1);const time=(await state(guest))!.t;await guest.waitForTimeout(1200);expect((await state(guest))!.t).toBeGreaterThan(time+.7);await expect.poll(async()=>(await state(guest))?.s).toBe(1);

 await page.mouse.click(20,20);await expect(page.locator('.shared-watching.surface iframe')).toHaveCount(1);await expect.poll(async()=>(await state(page))?.s).toBe(1);
 await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByLabel('Mute game sounds').check();
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('third-space.preferences')!).gameSoundsMuted)).toBe(true);
 await expect(page.getByRole('button',{name:'Native off',exact:true})).toBeVisible();
 expect(errors).toEqual([]);
 }finally{await context.close();}
});
