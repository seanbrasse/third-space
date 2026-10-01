import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
const history: unknown = JSON.parse(readFileSync("releases/history.json", "utf8"));
import { publishedReleases, formatReleaseDate } from "../../apps/web/lib/release-history";
const published = publishedReleases(history);

for (const width of [1440, 390, 320]) test(`public footer Updates keyboard/history/layout ${width}`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  const footer = page.locator("footer"), toggle = footer.getByRole("button", { name: "Updates", exact: true });
  const region = footer.getByRole("region", { name: "Updates", exact: true });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(region).toBeHidden();
  await toggle.focus(); await toggle.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(region).toBeVisible();
  await expect(region.locator("article")).toHaveCount(6);
  await expect(region.locator("article").first()).toContainText(formatReleaseDate(published[0]));
  await expect(region).toContainText("these are not release times");
  await expect(region).toContainText("A living forest");
  await expect(region).not.toContainText("Follow Third Space updates");
  await expect(region.locator("a")).toHaveCount(0);
  expect(await toggle.evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator("main.app").evaluate(el => el.classList.remove("dark-theme"));
  await footer.screenshot({ path: testInfo.outputPath(`updates-${width}.png`), animations: "disabled" });
  // Real inherited theme variables must remain legible in the dark app.
  await page.locator("main.app").evaluate(el => el.classList.add("dark-theme"));
  await footer.screenshot({ path: testInfo.outputPath(`updates-dark-${width}.png`), animations: "disabled" });
  while (await region.getByRole("button", { name: /Show older updates/ }).count())
    await region.getByRole("button", { name: /Show older updates/ }).click();
  await expect(region.locator("article")).toHaveCount(published.length);
  const complete = region.getByRole("button", { name: "All updates shown" });
  await expect(complete).toBeFocused();
  await expect(complete).toHaveAttribute("aria-disabled", "true");
  await expect(region.locator("article").last()).toContainText("Source recorded 30 September 2026 at 21:29:55 UTC");
  await expect(region).toContainText("earliest available history");
  await complete.press("Escape");
  await expect(toggle).toBeFocused();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.press("Space"); await expect(region).toBeVisible();
  await toggle.press("Space"); await expect(region).toBeHidden();
  expect(errors).toEqual([]);
});

test("Updates takes game keys only while its controls own focus and preserves fullscreen panels", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Your name", { exact: true }).fill("Updates reader");
  await page.getByLabel("Home name", { exact: true }).fill(`Updates ${Date.now()}`);
  await page.getByLabel("Choose a private PIN", { exact: true }).fill("123456");
  await page.getByRole("button", { name: "Create & enter home" }).click();
  await expect(page.locator(".connection")).toHaveText("Connected");
  const world = page.locator(".world-canvas");
  await expect(world).toHaveAttribute("data-authoritative-x", /[0-9]/);
  const toggle = page.locator("footer").getByRole("button", { name: "Updates", exact: true });
  const position = await world.getAttribute("data-authoritative-y");
  await toggle.click();
  await toggle.press("Enter"); // Native activation collapses, without opening chat.
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(toggle).toBeFocused();
  await page.keyboard.down("ArrowDown"); await page.waitForTimeout(250); await page.keyboard.up("ArrowDown");
  await toggle.press("f"); await toggle.press("1");
  expect(await world.getAttribute("data-authoritative-y")).toBe(position);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await world.focus();
  await page.keyboard.down("ArrowDown"); await page.waitForTimeout(250); await page.keyboard.up("ArrowDown");
  await expect(world).not.toHaveAttribute("data-authoritative-y", position!);
  await page.getByRole("button", { name: "Game menu", exact: false }).click();
  const menu = page.getByRole("dialog", { name: "Game menu", exact: true });
  if (await menu.getByRole("button", { name: "Game fullscreen", exact: true }).isEnabled()) {
    await menu.getByRole("button", { name: "Game fullscreen", exact: true }).click();
    await expect.poll(() => page.evaluate(() => !!document.fullscreenElement?.matches("main.app"))).toBe(true);
    await expect(page.locator("footer")).toBeHidden();
    await menu.getByRole("button", { name: "Settings", exact: true }).click();
    const settings = page.getByRole("dialog", { name: "settings controls" });
    await expect(settings).toBeVisible();
    expect(await settings.evaluate(el => !!document.fullscreenElement?.contains(el))).toBe(true);
    await settings.getByRole("button", { name: "Close dialog" }).click();
    await expect(world).toBeFocused();
    await page.getByRole("button", { name: "Game menu", exact: false }).click();
    await menu.getByRole("button", { name: "Exit game fullscreen", exact: true }).click();
    await expect(page.locator("footer")).toBeVisible();
  }
});
