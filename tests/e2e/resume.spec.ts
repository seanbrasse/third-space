import {test,expect} from "@playwright/test";
test("refresh restores the same room and position; explicit leave clears it",async({page})=>{
 const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
 await page.goto("/");await page.getByLabel("Your name",{exact:true}).fill("Ari");await page.getByLabel("Home name",{exact:true}).fill("Resume "+Date.now());await page.getByLabel("Choose a private PIN",{exact:true}).fill("123456");await page.getByRole("button",{name:"Create & enter home"}).click();await expect(page.locator(".connection")).toHaveText("Connected");
 await page.locator(".world-canvas").focus();await page.keyboard.down("a");await page.waitForTimeout(500);await page.keyboard.up("a");await page.waitForTimeout(300);
 const before=await page.locator(".world-canvas").evaluate(el=>({id:(el as HTMLElement).dataset.localId,x:Number((el as HTMLElement).dataset.authoritativeX),y:Number((el as HTMLElement).dataset.authoritativeY)}));
 await page.reload();await expect(page.locator(".connection")).toHaveText("Connected",{timeout:15000});
 await expect(page.locator(".world-canvas")).toHaveAttribute("data-world-id","forest");
 await expect.poll(()=>page.locator(".world-canvas").getAttribute("data-local-id")).toBe(before.id);
 await expect.poll(async()=>{const d=await page.locator(".world-canvas").evaluate(el=>({x:Number((el as HTMLElement).dataset.authoritativeX),y:Number((el as HTMLElement).dataset.authoritativeY)}));return Math.hypot(d.x-before.x,d.y-before.y);}).toBeLessThan(.1);
 await page.context().setOffline(true);await expect(page.locator(".connection")).not.toHaveText("Connected");
 await expect(page.getByRole("heading",{name:"Midnight Pines"})).toBeVisible();
 await page.context().setOffline(false);await expect(page.locator(".connection")).toHaveText("Connected",{timeout:15000});
 await page.getByRole("button",{name:"Leave home",exact:true}).click();await page.reload();
 await expect(page.getByRole("heading",{name:"Your space starts here."})).toBeVisible();
 expect(await page.evaluate(()=>sessionStorage.getItem("third-space.session"))).toBeNull();expect(errors).toEqual([]);
});
