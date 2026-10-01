import { test, expect } from "@playwright/test";

test("mobile Boost tap runs to resource end without holding and cannot retrigger", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByLabel("Your name", { exact: true }).fill("Mobile boost QA");
  await page.getByLabel("Home name", { exact: true }).fill("Mobile boost " + Date.now());
  await page.getByLabel("Choose a private PIN", { exact: true }).fill("123456");
  await page.getByRole("button", { name: "Create & enter home" }).click();
  await expect(page.locator(".connection")).toHaveText("Connected");
  const world = page.locator(".world-canvas"), stamina = page.locator(".stamina-hud");
  await expect(world.locator("canvas")).toBeVisible();
  await expect(world).toHaveAttribute("data-authoritative-x", /.+/);
  await world.focus();
  await page.keyboard.down("ArrowDown"); await page.waitForTimeout(500); await page.keyboard.up("ArrowDown");
  const boost = page.getByRole("button", { name: "Boost", exact: true });
  await expect(boost).toBeVisible();
  await expect(boost).toBeEnabled();
  await boost.click(); // Click releases immediately; no pointer remains held.
  await expect(stamina).toHaveAttribute("data-phase", "boosting");
  const until = await world.getAttribute("data-sprint-until");
  await expect(boost).toBeDisabled();
  await expect(page.getByRole("heading", { name: "Garden Dash", exact: true })).toHaveCount(0);
  await expect(stamina).toHaveAttribute("data-phase", "refilling", { timeout: 2500 });
  await expect(boost).toBeDisabled();
  await expect(stamina).toHaveAttribute("data-phase", "ready", { timeout: 6000 });
  await expect(boost).toBeEnabled();
  expect(await world.getAttribute("data-sprint-until")).toBe(until);
  await boost.click();
  await expect(stamina).toHaveAttribute("data-phase", "boosting");
  expect(await world.getAttribute("data-sprint-until")).not.toBe(until);
});
