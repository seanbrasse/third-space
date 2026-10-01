import { test, expect } from "@playwright/test";

for (const viewport of [{ width: 1366, height: 900 }, { width: 390, height: 844 }]) {
  test(`panel dismissal returns game focus ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await page.getByLabel("Your name", { exact: true }).fill("Focus QA");
    await page.getByLabel("Home name", { exact: true }).fill("Focus " + Date.now());
    await page.getByLabel("Choose a private PIN", { exact: true }).fill("123456");
    await page.getByRole("button", { name: "Create & enter home" }).click();
    await expect(page.locator(".connection")).toHaveText("Connected");
    const world = page.locator(".world-canvas"), map = page.getByRole("button", { name: "Toggle map" });
    await expect(world).toHaveAttribute("data-authoritative-x", /[0-9]/);
    for (const method of ["close", "toggle", "escape"] as const) {
      await map.click(); await expect(page.locator(".map-card")).toBeVisible();
      if (method === "close") await page.getByRole("button", { name: "Close map" }).click();
      if (method === "toggle") await map.click();
      if (method === "escape") await page.keyboard.press("Escape");
      await expect(world).toBeFocused();
      await page.keyboard.press("ArrowDown");
      await expect(page.locator(".map-card")).toHaveCount(0);
    }
    for (const method of ["close", "escape", "backdrop"] as const) {
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      if (method === "close") await page.getByRole("button", { name: "Close dialog" }).click();
      if (method === "escape") await page.keyboard.press("Escape");
      if (method === "backdrop") await page.locator(".modal-backdrop").click({ position: { x: 3, y: 3 } });
      await expect(world).toBeFocused();
    }
    await page.locator(".world-menu-toggle").click();
    await page.getByRole("button", { name: "Close worlds" }).click();
    await expect(world).toBeFocused();
    const chat = page.getByLabel("Message friends");
    if (!await chat.isVisible()) await page.locator(".chat-panel .chat-heading").click();
    await chat.fill("focus check"); await chat.press("Enter");
    await expect(chat).toBeFocused(); // Sending keeps the conversation usable.
    await page.locator(".chat-panel .chat-heading").click(); await expect(world).toBeFocused();
    await page.keyboard.down("ArrowDown"); await page.waitForTimeout(200); await page.keyboard.up("ArrowDown");
    await page.keyboard.press("Space");
    await expect(page.locator(".stamina-hud")).toHaveAttribute("data-phase", "boosting");
    await expect(page.locator(".map-card")).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
}
