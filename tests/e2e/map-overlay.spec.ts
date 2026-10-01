import { test, expect, type Page } from "@playwright/test";

async function create(page: Page) {
  await page.goto("/");
  await page.getByLabel("Your name", { exact: true }).fill("Map QA");
  await page.getByLabel("Home name", { exact: true }).fill("Map overlay " + Date.now());
  await page.getByLabel("Choose a private PIN", { exact: true }).fill("123456");
  await page.getByRole("button", { name: /Create & enter home/ }).click();
  await expect(page.locator(".connection")).toHaveText("Connected");
  await expect(page.locator(".world-canvas")).toHaveAttribute("data-world-id", "forest");
  await page.locator(".world-canvas").scrollIntoViewIfNeeded();
}
async function position(page: Page) {
  return page.locator(".world-canvas").evaluate(element => {
    const data = (element as HTMLElement).dataset;
    return { x: Number(data.authoritativeX), y: Number(data.authoritativeY) };
  });
}
function overlaps(a: { x: number; y: number; width: number; height: number }, b: typeof a) {
  return a.x < b.x + b.width - 1 && b.x < a.x + a.width - 1 &&
    a.y < b.y + b.height - 1 && b.y < a.y + a.height - 1;
}
test("open map remains nonmodal during arrows/WASD, typing and native toggle/close activation", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await create(page);
  const toggle = page.getByRole("button", { name: "Toggle map" }), card = page.locator(".map-card");
  await toggle.click(); await expect(toggle).toBeFocused(); await expect(card).toBeVisible();
  for (const key of ["ArrowRight", "ArrowLeft", "d", "a"]) {
    await toggle.focus(); const before = await position(page);
    await page.keyboard.down(key); await page.waitForTimeout(300); await page.keyboard.up(key);
    await page.waitForTimeout(120); const after = await position(page);
    expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeGreaterThan(.3);
    await expect(card).toBeVisible(); await expect(toggle).toBeFocused();
  }
  await toggle.click(); await expect(card).toHaveCount(0);
  await page.locator(".world-canvas").focus();
  await page.keyboard.down("d"); await page.waitForTimeout(100);
  const moving = await position(page);
  await toggle.click(); await page.waitForTimeout(300);
  await page.keyboard.up("d"); await page.waitForTimeout(120);
  expect((await position(page)).x - moving.x).toBeGreaterThan(.3);
  await expect(card).toBeVisible();
  await page.keyboard.press("Space"); await expect(card).toHaveCount(0);
  await page.keyboard.press("Enter"); await expect(card).toBeVisible();
  await expect(toggle).toBeFocused();
  await page.keyboard.press("Tab");
  const close = page.getByRole("button", { name: "Close map" });
  await expect(close).toBeFocused();
  await page.keyboard.press("Enter"); await expect(card).toHaveCount(0);
  await expect(toggle).toBeFocused();
  await toggle.click(); await close.click(); await expect(toggle).toBeFocused();
  await toggle.click(); await page.locator(".world-canvas").focus(); await page.keyboard.press("Enter");
  const chat = page.getByLabel("Message friends");
  await expect(chat).toBeFocused(); const before = await position(page);
  await page.keyboard.type("wasd"); await page.keyboard.press("ArrowLeft"); await page.keyboard.press("Space");
  await page.waitForTimeout(200); const after = await position(page);
  expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeLessThan(.02);
  await expect(card).toBeVisible(); await expect(chat).toBeFocused();
  expect(errors).toEqual([]);
});
for (const viewport of [{ width: 1440, height: 900 }, { width: 1366, height: 650 }, { width: 390, height: 844 }, { width: 320, height: 600 }]) {
  test("bottom-left map fits and passes pointers through " + viewport.width + "x" + viewport.height, async ({ page }) => {
    await page.setViewportSize(viewport); await create(page);
    const toggle = page.getByRole("button", { name: "Toggle map" });
    await toggle.click(); const card = page.locator(".map-card");
    await expect(card).toBeVisible();
    await expect(page.locator(".world-topline>span").nth(1)).toBeVisible();
    const instructions = await page.locator(".world-topline>span").nth(1).boundingBox();
    const worlds = await page.locator(".world-menu-toggle").boundingBox();
    expect(overlaps(instructions!, worlds!)).toBe(false);
    const world = await page.locator(".world-canvas").boundingBox(), box = await card.boundingBox();
    expect(world && box).toBeTruthy();
    expect(box!.x - world!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x - world!.x).toBeLessThan(20);
    expect(box!.y).toBeGreaterThanOrEqual(world!.y);
    expect(box!.y + box!.height).toBeLessThanOrEqual(world!.y + world!.height);
    expect(box!.x + box!.width).toBeLessThanOrEqual(world!.x + world!.width);
    for (const selector of [".world-topline", ".stamina-hud", ".chat-panel"]) {
      const other = await page.locator(selector).boundingBox();
      expect(overlaps(box!, other!)).toBe(false);
    }
    if (await page.getByRole("button", { name: "Move up", exact: true }).isVisible()) {
      const pad = await page.locator(".dpad").boundingBox(), control = await toggle.boundingBox();
      expect(overlaps(box!, pad!)).toBe(false); expect(overlaps(control!, pad!)).toBe(false);
    }
    await page.locator(".map-card svg").scrollIntoViewIfNeeded();
    const hit = await page.locator(".map-card svg").evaluate(element => {
      const bounds = element.getBoundingClientRect();
      return [0.2, 0.5, 0.8].map(fraction => document.elementFromPoint(bounds.x + bounds.width * fraction, bounds.y + bounds.height / 2)?.tagName);
    });
    expect(hit).toEqual(["CANVAS", "CANVAS", "CANVAS"]);
    await expect(page.locator('.navigation-map [role="dialog"],.navigation-map [aria-modal="true"]')).toHaveCount(0);
    await page.screenshot({ path: "tests/e2e/artifacts/map-overlay-" + viewport.width + "x" + viewport.height + ".png", fullPage: true });
  });
}
