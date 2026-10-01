import {test,expect} from "@playwright/test";
for(const viewport of [{width:1366,height:900},{width:390,height:844}]){
 test(`Slash and accepted Enter return game keys ${viewport.width}`,async({page})=>{
  await page.setViewportSize(viewport);await page.goto("/");
  await page.getByLabel("Your name",{exact:true}).fill("Chat entry QA");
  await page.getByLabel("Home name",{exact:true}).fill("Chat entry "+Date.now());
  await page.getByLabel("Choose a private PIN",{exact:true}).fill("123456");
  await page.getByRole("button",{name:"Create & enter home"}).click();
  const world=page.locator(".world-canvas"),chat=page.getByLabel("Message friends");
  await expect(world).toHaveAttribute("data-authoritative-x",/.+/);
  await page.locator(".game-menu-toggle").click();
  const fullscreen=page.getByRole("button",{name:"Game fullscreen",exact:true});
  if(await fullscreen.isEnabled()){
   await fullscreen.click();await expect.poll(()=>page.evaluate(()=>!!document.fullscreenElement)).toBe(true);
  }
  await page.getByRole("button",{name:"Close game menu"}).click();await expect(world).toBeFocused();
  for(let i=0;i<3;i++){
   await page.keyboard.press("/");await expect(chat).toBeFocused();await expect(chat).toHaveValue("");
   await chat.fill("accepted chat "+i);await chat.press("Enter");
   await expect(chat).toHaveValue("");await expect(world).toBeFocused();
   const y=Number(await world.getAttribute("data-authoritative-y"));
   await page.keyboard.down("ArrowDown");await page.waitForTimeout(180);await page.keyboard.up("ArrowDown");
   await expect.poll(async()=>Number(await world.getAttribute("data-authoritative-y"))).toBeGreaterThan(y+.2);
   await page.locator(".game-menu-toggle").click();await page.getByRole("button",{name:"Close game menu"}).click();await expect(world).toBeFocused();
  }
  await page.keyboard.press("Space");await expect(page.locator(".stamina-hud")).toHaveAttribute("data-phase","boosting");
  await page.keyboard.press("/");await chat.fill("literal");await chat.press("/");await expect(chat).toHaveValue("literal/");
  await chat.dispatchEvent("compositionstart");await chat.press("Enter");await expect(chat).toHaveValue("literal/");await expect(chat).toBeFocused();
  await chat.dispatchEvent("compositionend");
  await page.keyboard.press("Escape");await expect(world).toBeFocused();
  if(await page.evaluate(()=>!!document.fullscreenElement))await page.evaluate(()=>document.exitFullscreen());
 });
}
