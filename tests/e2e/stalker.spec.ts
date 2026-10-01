import {test,expect,type Page} from '@playwright/test';
async function untilCoordinate(page:Page,key:string,test:(n:number)=>boolean){await expect.poll(async()=>test(Number(await page.locator('.world-canvas').getAttribute('data-'+key))),{timeout:10000}).toBe(true);}
test('one local-area clown peeks, chases, catches and respawns with a fading halo',async({browser,page})=>{
 test.setTimeout(90000);
 await page.addInitScript(()=>{
   const w=window as unknown as {gameCueStarts:number[]};w.gameCueStarts=[];
   const original=AudioBufferSourceNode.prototype.start;
   AudioBufferSourceNode.prototype.start=function(...args:Parameters<typeof original>){if(this.buffer)w.gameCueStarts.push(this.buffer.duration);return original.apply(this,args);};
 });
 const c=await browser.newContext(),camp=await c.newPage(),errors:string[]=[];for(const p of [page,camp])p.on('pageerror',e=>errors.push(e.message));
 try{
 const name='Stalker '+Date.now();await page.goto('/');await page.getByLabel('Your name',{exact:true}).fill('Explorer');await page.getByLabel('Home name',{exact:true}).fill(name);await page.getByLabel('Choose a private PIN',{exact:true}).fill('123456');await page.getByRole('button',{name:'Create & enter home'}).click();await expect(page.locator('.connection')).toHaveText('Connected');
 const id=await page.evaluate(async n=>(await(await fetch('/api/homes')).json()).homes.find((h:{name:string})=>h.name===n).id,name);
 await camp.goto('http://127.0.0.1:3010');await camp.getByLabel('Your name',{exact:true}).fill('Camper');await camp.getByRole('button',{name:'Join friends',exact:true}).click();await camp.getByLabel('Home ID',{exact:true}).fill(id);await camp.getByLabel('Room PIN',{exact:true}).fill('123456');await camp.getByRole('button',{name:'Join your friends'}).click();await expect(camp.locator('.connection')).toHaveText('Connected');
 await expect(page.locator('.world-canvas')).toHaveAttribute('data-world-id','forest',{timeout:12000});
 async function walk(x:number,y:number){await page.locator('.world-canvas canvas').scrollIntoViewIfNeeded();const b=await page.locator('.world-canvas canvas').boundingBox();const d=await page.locator('.world-canvas').evaluate(el=>({...((el as HTMLElement).dataset)}));await page.mouse.click(b!.x+(x*32-Number(d.cameraScrollX))*Number(d.cameraZoom),b!.y+(y*32-Number(d.cameraScrollY))*Number(d.cameraZoom));await expect.poll(async()=>{const p=await page.locator('.world-canvas').evaluate(el=>({x:Number((el as HTMLElement).dataset.authoritativeX),y:Number((el as HTMLElement).dataset.authoritativeY)}));return Math.hypot(p.x-x,p.y-y);},{timeout:12000}).toBeLessThan(.3);}
 // Visible waypoints route from the default southern spawn around the fire.
 await walk(24,22);await walk(24,18);await walk(24,10.5);
 await expect(page.locator('.world-canvas')).toHaveAttribute('data-stalker-phase','peek',{timeout:40000});
 await expect(camp.locator('.world-canvas')).toHaveAttribute('data-stalker-id','');
 await expect(page.locator('.world-canvas')).toHaveAttribute('data-clown-greeting',/\S/);
 expect(Number(await page.locator('.world-canvas').getAttribute('data-clown-greeting-resolution'))).toBeGreaterThanOrEqual(1);

 await page.screenshot({path:'tests/e2e/artifacts/stalker-peek.png',fullPage:true});
 await expect(page.locator('.world-canvas')).toHaveAttribute('data-stalker-phase','chase',{timeout:5000});
 // Escape away from the pursuer briefly; the room-owned entity keeps tracking us.
 await page.keyboard.down('w');await page.waitForTimeout(400);await page.keyboard.up('w');
 await expect(page.locator('.world-canvas')).toHaveAttribute('data-respawn-count','1',{timeout:17000});
 const cues=await page.evaluate(()=>(window as unknown as {gameCueStarts:number[]}).gameCueStarts);expect(cues.some(d=>Math.abs(d-.21)<.002)).toBe(true);expect(cues.some(d=>Math.abs(d-.3)<.002)).toBe(true);expect(cues.some(d=>Math.abs(d-.11)<.002)).toBe(true);
 await expect(page.locator('.death-veil')).toHaveClass(/active/);
 expect(cues.some(d=>Math.abs(d-.32)<.002)).toBe(true);
 await expect(page.locator('.death-veil')).toHaveAttribute('data-creature','clown');
 await page.screenshot({path:test.info().outputPath('clown-takedown.png')});
 await expect.poll(()=>page.locator('.death-veil').evaluate(el=>Number(getComputedStyle(el).opacity)),{timeout:1000}).toBeGreaterThan(.8);
 await expect(page.locator('.world-canvas')).toHaveAttribute('data-halo-visible','true');
 await expect(page.locator('.death-veil')).not.toHaveClass(/active/,{timeout:3000});
 const p=await page.locator('.world-canvas').evaluate(el=>({x:Number((el as HTMLElement).dataset.authoritativeX),y:Number((el as HTMLElement).dataset.authoritativeY)}));expect(Math.hypot(p.x-24,p.y-24)).toBeLessThan(9);
 await expect(page.locator('.world-canvas')).toHaveAttribute('data-halo-visible','true');
 await expect(page.locator('.world-canvas')).toHaveAttribute('data-move-target-x','');
 await page.screenshot({path:'tests/e2e/artifacts/stalker-respawn.png',fullPage:true});
 await expect(page.locator('.world-canvas')).toHaveAttribute('data-halo-visible','false',{timeout:7000});
 await page.reload();await expect(page.locator('.connection')).toHaveText('Connected');await expect(page.locator('.world-canvas')).toHaveAttribute('data-respawn-count','1');
 expect(errors).toEqual([]);
 }finally{await c.close();}
});
