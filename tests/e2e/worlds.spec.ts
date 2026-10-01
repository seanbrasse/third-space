import { test, expect, type Page } from "@playwright/test";
async function create(page: Page) {
    const name = "Worlds " + Date.now();
    await page.goto("/");
    await page.getByLabel("Your name", { exact: true }).fill("Ari");
    await page.getByLabel("Home name", { exact: true }).fill(name);
    await page.getByLabel("Choose a private PIN", { exact: true }).fill("123456");
    await page.getByRole("button", { name: "Create & enter home" }).click();
    await expect(page.locator(".connection")).toHaveText("Connected");
    await page.locator(".world-canvas canvas").waitFor();
    return page.evaluate(async (name) => (await (await fetch("/api/homes")).json()).homes.find((h: {
        name: string;
    }) => h.name === name).id, name);
}
async function join(page: Page, id: string) { await page.goto("/"); await page.getByLabel("Your name", { exact: true }).fill("Remy"); await page.getByRole("button", { name: "Join friends", exact: true }).click(); await page.getByLabel("Home ID", { exact: true }).fill(id); await page.getByLabel("Room PIN", { exact: true }).fill("123456"); await page.getByRole("button", { name: "Join your friends" }).click(); await expect(page.locator(".connection")).toHaveText("Connected"); }
async function choose(page: Page, name: RegExp) { await page.getByRole("button", { name: "☷ Worlds" }).click(); await page.getByRole("button", { name }).click(); await page.getByRole("button", { name: "Close worlds" }).click(); }
test("friends object, switch together, roast, sleep rendering and return to the lounge", async ({ browser, page }) => {
    const errors: string[] = [];
    page.on("pageerror", e => errors.push(e.message));
    const secondContext = await browser.newContext();
    const second = await secondContext.newPage();
    second.on("pageerror", e => errors.push(e.message));
    try {
        const id = await create(page);
        await expect(page.locator(".world-canvas")).toHaveAttribute("data-world-id","forest");
        await choose(page,/The reading lounge/);
        await expect(page.locator(".world-canvas")).toHaveAttribute("data-world-id","living-room",{timeout:12000});
        await join(second, id);
        await choose(page, /Midnight Pines/);
        await expect(second.getByText(/Everyone moves together in/)).toBeVisible();
        await second.getByText("Stay here · object").click();
        await expect(page.getByText(/Everyone moves together in/)).toHaveCount(0);
        await expect(page.locator(".world-canvas")).toHaveAttribute("data-world-id", "living-room");
        await choose(second, /Midnight Pines/);
        await expect(page.locator(".world-canvas")).toHaveAttribute("data-world-id", "forest", { timeout: 12000 });
        await expect(second.locator(".world-canvas")).toHaveAttribute("data-world-revision", "2");
        const point = await page.locator(".world-canvas").evaluate(el => { const b = el.querySelector("canvas")!.getBoundingClientRect(), d = (el as HTMLElement).dataset; return { x: b.x + (20.8 * 32 - Number(d.cameraScrollX)) * Number(d.cameraZoom), y: b.y + (24 * 32 - Number(d.cameraScrollY)) * Number(d.cameraZoom) }; });
        await page.mouse.click(point.x, point.y);
        await expect.poll(() => page.locator(".world-canvas").getAttribute("data-seat-id")).not.toBe("");
        await page.getByRole("button", { name: "☺ Emotes" }).click();
        await page.getByRole("button", { name: /Roast marshmallow/ }).click();
        await expect.poll(async () => Number(await page.locator(".world-canvas").getAttribute("data-roasting-at"))).toBeGreaterThan(0);
        await page.getByRole("button", { name: /Flashlight on/ }).click();
        await expect(page.locator(".world-canvas")).toHaveAttribute("data-flashlight-on", "false");
        await page.evaluate(()=>{
          const check={frames:0,maxError:0};(window as unknown as {projectionCheck:typeof check}).projectionCheck=check;
          document.addEventListener("third-space:projection",event=>{
            const world=event.target as HTMLElement,canvas=world.querySelector("canvas"),shell=world.closest(".world-shell"),screen=shell?.querySelector<HTMLElement>(".shared-watching.surface");if(!canvas||!shell||!screen)return;
            const b=canvas.getBoundingClientRect(),s=shell.getBoundingClientRect(),d=(event as CustomEvent).detail,m=new DOMMatrixReadOnly(screen.style.transform);
            check.frames++;check.maxError=Math.max(check.maxError,Math.abs(m.m41-(b.left-s.left+d.x+6)),Math.abs(m.m42-(b.top-s.top+d.y+6)));
          });
        });
        await page.locator(".world-canvas").focus();await page.keyboard.down("d");await page.waitForTimeout(700);await page.keyboard.up("d");
        const projection=await page.evaluate(()=>(window as unknown as {projectionCheck:{frames:number;maxError:number}}).projectionCheck);
        expect(projection.frames).toBeGreaterThan(10);expect(projection.maxError).toBeLessThan(.1);
        // Deterministic app policy test, not an OS background-throttling benchmark.
        await second.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => true }); Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" }); document.dispatchEvent(new Event("visibilitychange")); });
        await second.waitForTimeout(300);
        const frame = await second.locator(".world-canvas").getAttribute("data-render-frame");
        await second.waitForTimeout(500);
        expect(await second.locator(".world-canvas").getAttribute("data-render-frame")).toBe(frame);
        await second.evaluate(() => { delete (document as unknown as Record<string, unknown>).hidden; delete (document as unknown as Record<string, unknown>).visibilityState; document.dispatchEvent(new Event("visibilitychange")); });
        await expect(second.locator(".connection")).toHaveText("Connected");
        await expect.poll(() => second.locator(".world-canvas").getAttribute("data-render-frame")).not.toBe(frame);
        await choose(page, /The reading lounge/);
        await expect(second.locator(".world-canvas")).toHaveAttribute("data-world-id", "living-room", { timeout: 12000 });
        await expect(page.locator(".world-canvas")).toHaveAttribute("data-world-revision", "3");
        await second.reload();
        await expect(second.locator(".connection")).toHaveText("Connected");
        await expect(second.locator(".world-canvas")).toHaveAttribute("data-world-revision", "3");
        expect(errors).toEqual([]);
    }
    finally {
        await secondContext.close();
    }
}, 65000);
