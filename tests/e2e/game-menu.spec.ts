import {test,expect} from '@playwright/test';

test('whole-game fullscreen keeps dialogs, map and chat reachable',async({page})=>{
 await page.goto('/');
 await page.getByLabel('Your name',{exact:true}).fill('Fullscreen friend');
 await page.getByLabel('Choose a private PIN',{exact:true}).fill('123456');
 await page.getByRole('button',{name:'Create & enter home'}).click();
 await expect(page.locator('.connection')).toHaveText('Connected');
 await page.getByRole('button',{name:'Game menu',exact:false}).click();
 const menu=page.getByRole('dialog',{name:'Game menu',exact:true});
 const supported=await menu.getByRole('button',{name:'Game fullscreen',exact:true}).isEnabled();
 if(!supported){await expect(menu).toContainText('does not offer game fullscreen');return;}
 await menu.getByRole('button',{name:'Game fullscreen',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>document.fullscreenElement?.matches('main.app'))).toBe(true);
 await menu.getByRole('button',{name:'Settings',exact:true}).click();
 const settings=page.getByRole('dialog',{name:'settings controls'});
 await expect(settings).toBeVisible();
 expect(await settings.evaluate(el=>!!document.fullscreenElement?.contains(el))).toBe(true);
 await settings.getByRole('button',{name:'Close dialog'}).click();
 await expect(page.locator('.world-canvas')).toBeFocused();
 await page.getByRole('button',{name:'Game menu',exact:false}).click();
 await menu.getByRole('button',{name:'Map',exact:true}).click();
 await expect(page.locator('#world-map-card')).toBeVisible();
 await page.getByRole('button',{name:'Close map',exact:true}).click();
 await page.getByRole('button',{name:'Game menu',exact:false}).click();
 await menu.getByRole('button',{name:'Chat',exact:true}).click();
 await page.getByLabel('Message friends').fill('Fullscreen keeps chat typing available');
 await page.getByLabel('Message friends').press('Enter');
 await expect(page.locator('.chat-messages')).toContainText('Fullscreen keeps chat typing available');
 await page.getByRole('button',{name:'Game menu',exact:false}).click();
 await menu.getByRole('button',{name:'Exit game fullscreen',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>!document.fullscreenElement)).toBe(true);
});

for (const width of [390,1440]) test(`side drawers fit and keep close controls reachable ${width}`,async({page})=>{
 await page.setViewportSize({width,height:width===390?844:1000});await page.goto('/');
 await page.getByLabel('Your name',{exact:true}).fill('Drawer friend');await page.getByLabel('Choose a private PIN',{exact:true}).fill('123456');
 await page.getByRole('button',{name:'Create & enter home'}).click();await expect(page.locator('.connection')).toHaveText('Connected');
 await page.locator('.game-menu-toggle').click();const menu=page.getByRole('dialog',{name:'Game menu',exact:true});
 const sounds=menu.getByRole('button',{name:/Sounds/});await expect(sounds).toBeVisible();expect((await sounds.locator('span').boundingBox())?.width).toBeGreaterThan(20);
 await menu.getByRole('button',{name:'Settings',exact:true}).click();const dialog=page.getByRole('dialog',{name:'settings controls'});
 const box=(await dialog.boundingBox())!;expect(box.x+box.width).toBeCloseTo(width,0);expect(box.height).toBeGreaterThan((width===390?844:1000)-2);
 await dialog.evaluate(el=>el.scrollTop=el.scrollHeight);await expect(dialog.getByRole('button',{name:'Close dialog'})).toBeInViewport();
 await dialog.getByRole('button',{name:'Close dialog'}).click();await expect(page.locator('.world-canvas')).toBeFocused();
 await page.locator('.game-menu-toggle').click();await menu.getByRole('button',{name:'Map',exact:true}).click();
 const map=page.locator('#world-map-card');await expect(map).toBeVisible();const mapBox=(await map.boundingBox())!;expect(mapBox.x+mapBox.width).toBeLessThanOrEqual(width);expect(mapBox.y).toBeGreaterThanOrEqual(0);
 await page.getByRole('button',{name:'Close map',exact:true}).click();await expect(page.locator('.world-canvas')).toBeFocused();
 await page.screenshot({path:`tests/e2e/artifacts/game-menu-drawers-${width}.png`});
});
