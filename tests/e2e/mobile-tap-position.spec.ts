import {test,expect} from '@playwright/test';
test.use({hasTouch:true,isMobile:true,viewport:{width:390,height:844}});
test('touch floor target stays precise after scrolling and layout shift',async({page})=>{
 await page.goto('/');await page.getByLabel('Your name',{exact:true}).fill('Touch projection QA');await page.getByLabel('Home name',{exact:true}).fill('Touch '+Date.now());await page.getByLabel('Choose a private PIN',{exact:true}).fill('123456');await page.getByRole('button',{name:'Create & enter home'}).click();await expect(page.locator('.connection')).toHaveText('Connected');
 const world=page.locator('.world-canvas');await expect(world.locator('canvas')).toBeVisible();await expect(world).toHaveAttribute('data-camera-zoom',/.+/);await world.scrollIntoViewIfNeeded();
 // Reproduce a DOM-only shift which Phaser's scale resize does not observe.
 await world.evaluate(el=>{(el as HTMLElement).style.transform='translateY(14px)';});
 const point={x:27,y:28};const screen=await world.evaluate((el,p)=>{const d=(el as HTMLElement).dataset,b=el.querySelector('canvas')!.getBoundingClientRect();return{x:b.x+(p.x*32-Number(d.cameraScrollX))*Number(d.cameraZoom),y:b.y+(p.y*32-Number(d.cameraScrollY))*Number(d.cameraZoom)}},point);
 await page.touchscreen.tap(screen.x,screen.y);
 await expect.poll(async()=>Math.hypot(Number(await world.getAttribute('data-move-target-x'))-point.x,Number(await world.getAttribute('data-move-target-y'))-point.y)).toBeLessThan(.06);
 await expect.poll(async()=>Math.hypot(Number(await world.getAttribute('data-authoritative-x'))-point.x,Number(await world.getAttribute('data-authoritative-y'))-point.y),{timeout:8000}).toBeLessThan(.4);
});
