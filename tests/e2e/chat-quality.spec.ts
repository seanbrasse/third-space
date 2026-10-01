import { test, expect } from "@playwright/test";
for (const dpr of [1,2]) test(`chat timestamps survive refresh with crisp canvas text at DPR ${dpr}`,async({browser})=>{
 const context=await browser.newContext({viewport:{width:1200,height:900},deviceScaleFactor:dpr}),page=await context.newPage();
 try{
  await page.goto('/');await page.getByLabel('Your name',{exact:true}).fill('Chat QA');await page.getByLabel('Home name',{exact:true}).fill('Chat QA '+Date.now());await page.getByLabel('Choose a private PIN',{exact:true}).fill('123456');await page.getByRole('button',{name:'Create & enter home'}).click();await expect(page.locator('.connection')).toHaveText('Connected');
  const input=page.getByLabel('Message friends');if(!await input.isVisible())await page.locator('.chat-heading').click();
  await input.fill('A readable message by the campfire.');await input.press('Enter');
  const accepted=page.locator('.chat-messages p').filter({hasText:'A readable message by the campfire.'});await expect(accepted.locator('time')).toHaveAttribute('datetime',/^\d{4}-/);
  const timestamp=await accepted.locator('time').getAttribute('datetime');await expect(accepted).toHaveCSS('font-size','13px');await expect(accepted.locator('b')).toHaveCSS('font-size','12px');
  const world=page.locator('.world-canvas');await expect(world).toHaveAttribute('data-chat-text-resolution','2');await expect(world).toHaveAttribute('data-chat-texture-resolution','2');const values=await world.evaluate(el=>(el as HTMLElement).dataset);expect(Number(values.chatScreenWidth)).toBeLessThanOrEqual(150);expect(Number(values.chatTextScale)*Number(values.cameraZoom)).toBeCloseTo(1,4);
  await page.screenshot({path:test.info().outputPath('chat-dpr-'+dpr+'.png')});
  await page.reload();await expect(page.locator('.connection')).toHaveText('Connected');if(!await input.isVisible())await page.locator('.chat-heading').click();await expect(accepted.locator('time')).toHaveAttribute('datetime',timestamp!);
 }finally{await context.close();}
});
