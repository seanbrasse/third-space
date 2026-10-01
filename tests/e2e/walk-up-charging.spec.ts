import {test,expect,type Page} from '@playwright/test';
async function walk(page:Page,x:number,y:number){
 const world=page.locator('.world-canvas');const p=await world.evaluate((el,point)=>{const d=(el as HTMLElement).dataset,b=el.querySelector('canvas')!.getBoundingClientRect();return{x:b.x+(point.x*32-Number(d.cameraScrollX))*Number(d.cameraZoom),y:b.y+(point.y*32-Number(d.cameraScrollY))*Number(d.cameraZoom)}},{x,y});await page.mouse.click(p.x,p.y);
 await expect.poll(async()=>{const d=await world.evaluate(el=>(el as HTMLElement).dataset);return Math.hypot(Number(d.authoritativeX)-x,Number(d.authoritativeY)-y)},{timeout:8000}).toBeLessThan(.4);
}
test('fresh camper retains charge at spawn and walking into dock charges without sitting',async({page})=>{
 await page.goto('/');await page.getByLabel('Your name',{exact:true}).fill('Charger QA');await page.getByLabel('Home name',{exact:true}).fill('Charging '+Date.now());await page.getByLabel('Choose a private PIN',{exact:true}).fill('123456');await page.getByRole('button',{name:'Create & enter home'}).click();await expect(page.locator('.connection')).toHaveText('Connected');
 const world=page.locator('.world-canvas');await expect(world).toHaveAttribute('data-flashlight-on','false');await expect(world).toHaveAttribute('data-flashlight-battery','1');await page.waitForTimeout(1200);await expect(world).toHaveAttribute('data-flashlight-battery','1');
 await world.focus();await page.keyboard.press('f');await page.waitForTimeout(1200);expect(Number(await world.getAttribute('data-flashlight-battery'))).toBeLessThan(.98);await page.keyboard.press('f');
 await walk(page,27,28);await walk(page,30.5,25.2);await world.focus();await page.keyboard.down('ArrowUp');await page.waitForTimeout(500);await page.keyboard.up('ArrowUp');
 await expect(world).toHaveAttribute('data-flashlight-battery','1');await expect(world).toHaveAttribute('data-flashlight-on','false');await expect(world).not.toHaveAttribute('data-seat-id','charger-seat');
 await page.reload();await expect(page.locator('.connection')).toHaveText('Connected');await expect(world).toHaveAttribute('data-flashlight-battery','1');await expect(world).toHaveAttribute('data-flashlight-on','false');
});
