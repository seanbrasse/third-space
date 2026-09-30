import { test, expect } from '@playwright/test';
test('YouTube adapter follows shared host controls and game mute stays independent', async ({browser,page})=>{
 const context=await browser.newContext(),guest=await context.newPage();
 const errors:string[]=[];
 const mock=`window.YT={Player:class{constructor(el,o){this.t=0;this.s=2;this.v=100;this.at=Date.now();this.el=document.createElement('iframe');this.el.title='YouTube test adapter';el.replaceWith(this.el);window.__yt=this;setTimeout(()=>o.events.onReady(),0)}getCurrentTime(){return this.t+(this.s===1?(Date.now()-this.at)/1000:0)}getDuration(){return 300}getPlayerState(){return this.s}playVideo(){this.t=this.getCurrentTime();this.at=Date.now();this.s=1}pauseVideo(){this.t=this.getCurrentTime();this.s=2}seekTo(t){this.t=t;this.at=Date.now()}setVolume(v){this.v=v}destroy(){this.el.remove();window.__yt=null}}};window.onYouTubeIframeAPIReady?.();`;
 for(const p of [page,guest]){p.on('pageerror',e=>errors.push(e.message));await p.route('https://www.youtube.com/iframe_api',route=>route.fulfill({contentType:'text/javascript',body:mock}));}
 try{
 const name='Watching '+Date.now();await page.goto('/');await page.getByLabel('Your name',{exact:true}).fill('Ari');await page.getByLabel('Home name',{exact:true}).fill(name);await page.getByLabel('Choose a private PIN',{exact:true}).fill('123456');await page.getByRole('button',{name:'Create & enter home'}).click();await expect(page.locator('.connection')).toHaveText('Connected');
 const id=await page.evaluate(async n=>(await(await fetch('/api/homes')).json()).homes.find((h:{name:string})=>h.name===n).id,name);
 await guest.goto('http://127.0.0.1:3010');await guest.getByLabel('Your name',{exact:true}).fill('Remy');await guest.getByRole('button',{name:'Join friends',exact:true}).click();await guest.getByLabel('Home ID',{exact:true}).fill(id);await guest.getByLabel('Room PIN',{exact:true}).fill('123456');await guest.getByRole('button',{name:'Join your friends'}).click();await expect(guest.locator('.connection')).toHaveText('Connected');
 for(const p of [page,guest])await p.getByRole('button',{name:'▣ Watch together'}).click();
 await page.getByLabel('Video link').fill('https://youtu.be/M7lc1UVf-VE?t=12');await page.getByRole('button',{name:'Load for everyone'}).click();
 const state=(p:typeof page)=>p.evaluate(()=>{const w=window as unknown as {__yt?:{getCurrentTime:()=>number;getPlayerState:()=>number;v:number}};return w.__yt?{t:w.__yt.getCurrentTime(),s:w.__yt.getPlayerState(),v:w.__yt.v}:null;});
 await expect.poll(async()=>(await state(guest))?.t).toBe(12);
 await page.getByRole('button',{name:'Play together'}).click();await expect.poll(async()=>(await state(guest))?.s).toBe(1);await page.waitForTimeout(1300);
 await page.getByRole('button',{name:'Pause together'}).click();await expect.poll(async()=>(await state(guest))?.s).toBe(2);
 await page.getByLabel('Seek (seconds)').fill('23');await page.getByRole('button',{name:'Seek together'}).click();await expect.poll(async()=>(await state(guest))?.t).toBe(23);
 await guest.getByRole('button',{name:'Close shared screen'}).click();await expect.poll(()=>state(guest)).toBeNull();
 await page.getByRole('button',{name:'Close shared screen'}).click();
 await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByLabel('Mute game sounds').check();
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('third-space.preferences')!).gameSoundsMuted)).toBe(true);
 await expect(page.getByRole('button',{name:'Native off',exact:true})).toBeVisible();
 expect(errors).toEqual([]);
 }finally{await context.close();}
});
