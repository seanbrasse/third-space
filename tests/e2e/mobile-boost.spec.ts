import { test, expect } from "@playwright/test";

test("mobile sprint holds, releases with reserve, and cancellation stops drain", async ({ page }) => {
  await page.setViewportSize({width:390,height:844});await page.goto("/");
  await page.getByLabel("Your name",{exact:true}).fill("Hold sprint QA");
  await page.getByLabel("Home name",{exact:true}).fill("Hold sprint "+Date.now());
  await page.getByLabel("Choose a private PIN",{exact:true}).fill("123456");
  await page.getByRole("button",{name:"Create & enter home"}).click();
  await expect(page.locator(".connection")).toHaveText("Connected");
  const world=page.locator(".world-canvas"), button=page.getByRole("button",{name:"Hold to sprint",exact:true});
  await expect(world.locator("canvas")).toBeVisible();await world.focus();
  await page.keyboard.down("ArrowDown");await page.waitForTimeout(200);
  const box=(await button.boundingBox())!;await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
  await expect.poll(async()=>Number(await world.getAttribute("data-stamina"))).toBeLessThan(.95);
  await page.mouse.up();await page.keyboard.up("ArrowDown");
  await expect(world).toHaveAttribute("data-sprinting","false");
  const reserve=Number(await world.getAttribute("data-stamina"));await page.waitForTimeout(150);
  expect(Number(await world.getAttribute("data-stamina"))).toBeGreaterThanOrEqual(reserve-.03);
  await world.focus();await page.keyboard.down("ArrowDown");await page.mouse.down();
  await expect(world).toHaveAttribute("data-sprinting","true");
  await page.evaluate(()=>window.dispatchEvent(new Event("blur")));await page.waitForTimeout(150);
  await expect(world).toHaveAttribute("data-sprinting","false");await page.mouse.up();await page.keyboard.up("ArrowDown");
});


test("an empty reserve shows out-of-breath feedback and held Space cannot auto-restart",async({page})=>{
  await page.goto('/');await page.getByLabel('Your name',{exact:true}).fill('Exhaustion QA');await page.getByLabel('Home name',{exact:true}).fill('Empty reserve '+Date.now());await page.getByLabel('Choose a private PIN',{exact:true}).fill('123456');await page.getByRole('button',{name:'Create & enter home'}).click();await expect(page.locator('.connection')).toHaveText('Connected');
  const world=page.locator('.world-canvas');await expect(world.locator('canvas')).toBeVisible();await expect(world).toHaveAttribute('data-stamina','1');await world.focus();
  await page.keyboard.down('ArrowDown');await page.keyboard.down('Space');
  await expect.poll(async()=>Number(await world.getAttribute('data-stamina')),{timeout:5000,intervals:[30]}).toBeLessThan(.015);
  await expect(page.locator('.stamina-hud')).toHaveAttribute('data-phase','exhausted');
  await expect(page.locator('.stamina-hud')).toContainText('Out of breath');
  await page.waitForTimeout(2500);await expect(world).toHaveAttribute('data-sprinting','false');
  expect(Number(await world.getAttribute('data-stamina'))).toBeGreaterThan(.1);
  await page.keyboard.up('Space');await page.keyboard.up('ArrowDown');await page.waitForTimeout(150);
  await world.focus();await page.keyboard.down('ArrowUp');await page.keyboard.down('Space');
  await expect(world).toHaveAttribute('data-sprinting','true');
  await page.keyboard.up('Space');await page.keyboard.up('ArrowUp');
});
