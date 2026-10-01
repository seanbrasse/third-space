import type { Page } from "@playwright/test";

/** Toolbar interactions live inside the game drawer. */
export async function gameAction(page: Page, action: () => Promise<unknown>) {
  if (!await page.locator(".game-menu-panel").isVisible()) await page.locator(".game-menu-toggle").click();
  await action();
}
