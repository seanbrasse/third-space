import { test, expect, type Page } from "@playwright/test";

async function position(page: Page) {
  return page.locator(".world-canvas").evaluate(el => {
    const d = (el as HTMLElement).dataset;
    return { x: Number(d.authoritativeX), y: Number(d.authoritativeY) };
  });
}
async function move(page: Page, key: string) {
  const before = await position(page);
  await page.keyboard.down(key); await page.waitForTimeout(300); await page.keyboard.up(key);
  await page.waitForTimeout(120);
  const after = await position(page);
  return Math.hypot(after.x - before.x, after.y - before.y);
}

test("Watch Together permits game movement while focused playback controls keep their keys", async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.route("https://www.youtube.com/iframe_api", route => route.fulfill({ contentType: "text/javascript", body: `
    window.YT={Player:class{constructor(el,o){this.t=0;this.s=2;this.el=document.createElement('iframe');this.el.title='Keyboard playback fixture';el.replaceWith(this.el);setTimeout(()=>o.events.onReady(),0)}getCurrentTime(){return this.t}getDuration(){return 300}getPlayerState(){return this.s}playVideo(){this.s=1}pauseVideo(){this.s=2}seekTo(t){this.t=t}setVolume(){}destroy(){this.el.remove()}}};window.onYouTubeIframeAPIReady?.();
  ` }));
  await page.goto("/");
  await page.getByLabel("Your name", { exact: true }).fill("Watching keys QA");
  await page.getByLabel("Home name", { exact: true }).fill("Watching keys " + Date.now());
  await page.getByLabel("Choose a private PIN", { exact: true }).fill("123456");
  await page.getByRole("button", { name: /Create & enter home/ }).click();
  await expect(page.locator(".connection")).toHaveText("Connected");
  const world = page.locator(".world-canvas");
  await expect(world.locator("canvas")).toBeVisible();
  await expect(world).toHaveAttribute("data-authoritative-x", /[0-9]/);
  await world.scrollIntoViewIfNeeded(); await world.focus();
  // Reach the independently entered indoor TV using actual authoritative walking.
  for (const point of [{x:24,y:28},{x:27,y:28},{x:27,y:24},...Array.from({length:6},(_,i)=>({x:34+i*7,y:24})),{x:69,y:17},{x:69,y:13.5}]) {
    if (await world.getAttribute("data-world-id") === "asylum") break;
    const q = await world.evaluate((el, point) => {
      const d = (el as HTMLElement).dataset, b = el.querySelector("canvas")!.getBoundingClientRect();
      return {x:b.x+(point.x*32-Number(d.cameraScrollX))*Number(d.cameraZoom),y:b.y+(point.y*32-Number(d.cameraScrollY))*Number(d.cameraZoom)};
    }, point);
    await page.mouse.click(q.x,q.y);
    await expect.poll(async () => await world.getAttribute("data-world-id") === "asylum" ? 0 : Math.hypot((await position(page)).x-point.x,(await position(page)).y-point.y), {timeout:9000}).toBeLessThan(.5);
  }
  if (await world.getAttribute("data-world-id") !== "asylum") await page.keyboard.press("e");
  await expect(world).toHaveAttribute("data-world-id", "asylum");
  // Move away from the automatic exit before checking both keyboard layouts.
  await world.focus(); await page.keyboard.down("w"); await page.waitForTimeout(350); await page.keyboard.up("w");
  await page.getByRole("button", { name: /Watch together/ }).click();
  const panel = page.locator(".shared-watching.expanded"); await expect(panel).toBeVisible();
  await page.getByRole("button", { name: "Toggle map" }).click();
  for (const key of ["ArrowRight","ArrowLeft","d","a"]) {
    await world.focus(); expect(await move(page,key)).toBeGreaterThan(.3);
    await expect(panel).toBeVisible(); await expect(page.locator(".map-card")).toBeVisible();
  }
  // Noninteractive panel text also permits movement without closing the panel.
  const description = panel.locator(".watching-controls>p").first();
  await description.evaluate(el => { (el as HTMLElement).tabIndex=-1; (el as HTMLElement).focus(); });
  expect(await move(page,"d")).toBeGreaterThan(.3);
  await world.focus(); expect(await move(page,"a")).toBeGreaterThan(.3);
  await page.keyboard.press("Space"); await expect(page.locator(".stamina-hud")).toHaveAttribute("data-phase","boosting");
  await expect.poll(() => page.locator(".stamina-hud").getAttribute("data-phase"), {timeout:2500}).toBe("refilling");
  const beforeFlash = await world.getAttribute("data-flashlight-on"); await page.keyboard.press("f");
  await expect(world).toHaveAttribute("data-flashlight-on",beforeFlash === "true" ? "false" : "true");
  const flash = await world.getAttribute("data-flashlight-on");
  const link = page.getByLabel("Video link"); await link.focus();
  const beforeTyping = await position(page);
  await page.keyboard.type("wasdf"); await page.keyboard.press("ArrowLeft"); await page.keyboard.press("Space");
  await page.waitForTimeout(150); expect(await position(page)).toEqual(beforeTyping);
  await expect(link).toBeFocused(); await expect(world).toHaveAttribute("data-flashlight-on",flash!);
  await link.fill("https://youtu.be/M7lc1UVf-VE"); await page.getByRole("button", {name:"Load for everyone"}).click();
  const play = page.getByRole("button",{name:"Play together",exact:true}); await expect(play).toBeEnabled();
  await world.focus(); await page.keyboard.down("d"); await page.waitForTimeout(120);
  await play.focus(); await page.waitForTimeout(150); await page.keyboard.up("d");
  const beforeControls = await position(page);
  for(const key of ["ArrowRight","d"]) expect(await move(page,key)).toBeLessThan(.02);
  await page.keyboard.press("f"); await expect(world).toHaveAttribute("data-flashlight-on",flash!);
  await page.keyboard.press("Space"); await expect(page.getByRole("button",{name:"Pause together",exact:true})).toBeVisible();
  expect(await position(page)).toEqual(beforeControls); await expect(link).not.toBeFocused();
  await page.keyboard.press("Enter"); await expect(play).toBeVisible();
  await expect(page.getByLabel("Message friends")).not.toBeFocused();
  // A real focused iframe owns its arrows/space; they never become avatar input.
  const iframe = panel.locator("iframe"), handle = await iframe.elementHandle(), frame = await handle!.contentFrame();
  await frame!.evaluate(() => { document.body.tabIndex=0; document.body.focus(); (window as any).keys=[]; document.addEventListener("keydown",e=>(window as any).keys.push([e.key,e.defaultPrevented])); });
  for(const key of ["ArrowRight","d","Space","f"]) await page.keyboard.press(key);
  await page.waitForTimeout(200); expect(await position(page)).toEqual(beforeControls);
  expect(await frame!.evaluate(()=>(window as any).keys)).toEqual([["ArrowRight",false],["d",false],[" ",false],["f",false]]);
  await world.focus(); expect(await move(page,"ArrowLeft")).toBeGreaterThan(.3);
  await page.getByRole("button",{name:"Settings",exact:true}).click();
  expect(await move(page,"d")).toBeLessThan(.02);
  await page.keyboard.press("Escape"); await world.focus(); expect(await move(page,"d")).toBeGreaterThan(.3);
  await expect(panel).toBeVisible(); expect(errors).toEqual([]);
  await page.screenshot({path:"tests/e2e/artifacts/watching-keyboard.png",fullPage:true});
});
