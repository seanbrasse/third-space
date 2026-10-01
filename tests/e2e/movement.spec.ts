import { test, expect, type Page } from "@playwright/test";

async function create(page: Page) {
  await page.goto("/");
  await page.getByLabel("Your name", { exact: true }).fill("Sprint QA");
  await page.getByLabel("Home name", { exact: true }).fill("Movement " + Date.now());
  await page.getByLabel("Choose a private PIN", { exact: true }).fill("123456");
  await page.getByRole("button", { name: "Create & enter home" }).click();
  await expect(page.locator(".connection")).toHaveText("Connected");
  await expect(page.locator(".world-canvas")).toHaveAttribute("data-world-id", "forest");
  await expect(page.getByRole("progressbar", { name: "Sprint stamina" })).toHaveAttribute("aria-valuenow", "100");
}
async function position(page: Page) {
  return page.locator(".world-canvas").evaluate(el => {
    const d = (el as HTMLElement).dataset;
    return { x: Number(d.authoritativeX), y: Number(d.authoritativeY) };
  });
}
async function move(page: Page, key: string) {
  const before = await position(page);
  await page.keyboard.down(key); await page.waitForTimeout(180); await page.keyboard.up(key);
  await page.waitForTimeout(100);
  const after = await position(page);
  expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeGreaterThan(.3);
}
async function still(page: Page, keys: string[]) {
  await page.waitForTimeout(100);
  const before = await position(page);
  for (const key of keys) await page.keyboard.press(key);
  await page.waitForTimeout(180);
  const after = await position(page);
  expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeLessThan(.02);
}
test("arrows/WASD after button focus; typing/modal/Space activation remain accessible", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await create(page);
  const map = page.getByRole("button", { name: "Toggle map" });
  await map.click();
  const scroll = await page.evaluate(() => window.scrollY);
  for (const key of ["ArrowRight", "ArrowLeft", "d", "a", "ArrowDown", "ArrowUp", "s", "w"]) {
    await map.focus(); await move(page, key);
  }
  expect(await page.evaluate(() => window.scrollY)).toBe(scroll);
  const until = await page.locator(".world-canvas").getAttribute("data-sprint-until");
  await map.focus(); const expanded = await map.getAttribute("aria-expanded"); await page.keyboard.press("Space");
  await expect(map).toHaveAttribute("aria-expanded", expanded === "true" ? "false" : "true");
  expect(await page.locator(".world-canvas").getAttribute("data-sprint-until")).toBe(until);
  await map.focus(); await page.keyboard.press("Enter");
  await expect(map).toBeFocused();
  await page.locator(".world-canvas").focus(); await page.keyboard.press("Enter");
  const chat = page.getByPlaceholder("Say something nice…");
  await expect(chat).toBeFocused();
  await still(page, ["w", "a", "s", "d", "ArrowRight", "ArrowLeft", "Space"]);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await still(page, ["ArrowRight", "d", "Space"]);
  await page.keyboard.press("Escape");
  await map.focus(); await move(page, "ArrowRight");
  expect(errors).toEqual([]);
});
test("Space boost drains for1.5s, refills5s, repeat/hold cannot restart; blur clears held keys", async ({ page }) => {
  await create(page);
  const world = page.locator(".world-canvas"), stamina = page.locator(".stamina-hud");
  await world.focus();await move(page,"ArrowDown"); const scroll = await page.evaluate(() => window.scrollY); await page.keyboard.down("Space");
  await expect(stamina).toHaveAttribute("data-phase", "boosting");
  expect(await page.evaluate(() => window.scrollY)).toBe(scroll);
  const until = await world.getAttribute("data-sprint-until");
  await page.keyboard.down("Space"); // repeated keydown while physically held
  await expect(stamina).toHaveAttribute("data-phase", "refilling", { timeout: 2500 });
  await expect(stamina).toHaveAttribute("data-phase", "ready", { timeout: 6000 });
  expect(await world.getAttribute("data-sprint-until")).toBe(until);
  await page.keyboard.up("Space"); await page.keyboard.press("Space");
  await expect(stamina).toHaveAttribute("data-phase", "boosting");
  expect(await world.getAttribute("data-sprint-until")).not.toBe(until);
  await page.keyboard.down("d"); await page.waitForTimeout(120);
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await page.waitForTimeout(120); const stopped = await position(page);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.waitForTimeout(200);
  expect((await position(page)).x).toBeCloseTo(stopped.x, 2);
  await page.keyboard.up("d"); await move(page, "a");
  await page.reload();
  await expect(page.locator(".connection")).toHaveText("Connected");
  await expect(stamina).toHaveAttribute("data-phase", "refilling", { timeout: 5000 });
});
for (const size of [{ width: 1440, height: 900 }, { width: 1366, height: 650 }, { width: 390, height: 844 }, { width: 320, height: 600 }]) {
  test("map/instructions and stamina fit " + size.width + "x" + size.height, async ({ page }) => {
    await page.setViewportSize(size); await create(page);
    const map = page.getByRole("button", { name: "Toggle map" });
    const instructions = page.locator(".world-topline>span").nth(1);
    const a = await map.boundingBox(), b = await instructions.boundingBox();
    expect(a && b).toBeTruthy();
    expect(b!.height).toBeLessThan(60);
    expect(a!.x >= b!.x + b!.width - 1 || b!.x >= a!.x + a!.width - 1 ||
      a!.y >= b!.y + b!.height - 1 || b!.y >= a!.y + a!.height - 1).toBe(true);
    const bar = page.getByRole("progressbar", { name: "Sprint stamina" });
    if (size.width < 850) {
      const bottom = await page.locator(".world-bottomline").boundingBox(), people = await page.locator(".people-panel").boundingBox();
      expect(bottom!.y + bottom!.height).toBeLessThanOrEqual(people!.y + 1);
    }
    await bar.scrollIntoViewIfNeeded(); await expect(bar).toBeVisible();
    const box = await bar.boundingBox();
    expect(box!.width).toBeGreaterThan(40);
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(size.width);
    await map.click(); const card = await page.locator(".map-card").boundingBox();
    expect(card!.x).toBeGreaterThanOrEqual(0);
    expect(card!.x + card!.width).toBeLessThanOrEqual(size.width);
    await page.screenshot({ path: "tests/e2e/artifacts/movement-" + size.width + "x" + size.height + ".png", fullPage: true });
  });
}
