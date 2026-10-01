import { test, expect } from "@playwright/test";

test("in-world projector uses the larger ten-tile 16:9 surface without changing the camera",async({page})=>{
  test.setTimeout(90_000);
  const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
  await page.goto("/");
  await page.getByLabel("Your name",{exact:true}).fill("Projector geometry QA");
  await page.getByLabel("Home name",{exact:true}).fill("Larger projector "+Date.now());
  await page.getByLabel("Choose a private PIN",{exact:true}).fill("123456");
  await page.getByRole("button",{name:/Create & enter home/}).click();
  await expect(page.locator(".connection")).toHaveText("Connected");
  const world=page.locator(".world-canvas");await expect(world).toHaveAttribute("data-authoritative-x",/[0-9]/);
  await world.scrollIntoViewIfNeeded();
  for(const point of [{x:24,y:28},{x:27,y:28},{x:27,y:24},...Array.from({length:6},(_,i)=>({x:34+i*7,y:24})),{x:69,y:17},{x:69,y:13.5}]){
    if(await world.getAttribute("data-world-id")==="asylum")break;
    const hit=await world.evaluate((el,p)=>{const d=(el as HTMLElement).dataset,b=el.querySelector("canvas")!.getBoundingClientRect();return{x:b.x+(p.x*32-Number(d.cameraScrollX))*Number(d.cameraZoom),y:b.y+(p.y*32-Number(d.cameraScrollY))*Number(d.cameraZoom)};},point);
    await page.mouse.click(hit.x,hit.y);
    await expect.poll(async()=>{const d=await world.evaluate(el=>(el as HTMLElement).dataset);return d.worldId==="asylum"?0:Math.hypot(Number(d.authoritativeX)-point.x,Number(d.authoritativeY)-point.y);},{timeout:9000}).toBeLessThan(.5);
  }
  if(await world.getAttribute("data-world-id")!=="asylum"){await world.focus();await page.keyboard.press("e");}
  await expect(world).toHaveAttribute("data-world-id","asylum");
  const screen=page.locator(".shared-watching.surface");await expect(screen).toBeVisible();
  await expect.poll(async()=>{const b=await screen.boundingBox(),zoom=Number(await world.getAttribute("data-camera-zoom"));return Math.abs((b?.width??0)-10*32*zoom);}).toBeLessThan(.5);
  const box=(await screen.boundingBox())!,canvas=(await world.locator("canvas").boundingBox())!;
  expect(box.width/box.height).toBeCloseTo(16/9,3);
  expect(box.x).toBeGreaterThanOrEqual(canvas.x);expect(box.y).toBeGreaterThanOrEqual(canvas.y);
  expect(box.x+box.width).toBeLessThanOrEqual(canvas.x+canvas.width);
  expect(box.y+box.height).toBeLessThanOrEqual(canvas.y+canvas.height);
  expect(errors).toEqual([]);
  await page.screenshot({path:"tests/e2e/artifacts/projector-ten-tile-in-world.png",fullPage:true});
});
