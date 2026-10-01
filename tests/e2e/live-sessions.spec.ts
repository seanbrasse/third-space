import { test, expect } from "@playwright/test";

test("live campsite discovery requires PIN and admitted friends can reveal it after refresh", async ({ browser, page }) => {
  const name = `Pines discovery ${Date.now()}`;
  const context = await browser.newContext();
  const friend = await context.newPage();
  try {
    await page.goto("/");
    await page.getByLabel("Your name", { exact: true }).fill("Host");
    await page.getByLabel("Home name", { exact: true }).fill(name);
    await page.getByLabel("Choose a private PIN", { exact: true }).fill("123456");
    await page.getByRole("button", { name: "Create & enter home" }).click();
    await expect(page.locator(".connection")).toHaveText("Connected");
    await page.getByRole("button", { name: "Session info", exact: true }).click();
    const hostInfo = page.getByRole("region", { name: "Session info" });
    await hostInfo.getByRole("button", { name: "Reveal PIN" }).click();
    await expect(hostInfo.getByLabel("Room PIN", { exact: true })).toHaveValue("123456");

    await friend.goto("/");
    await friend.getByLabel("Your name", { exact: true }).fill("Friend");
    await friend.getByRole("button", { name: "Join friends", exact: true }).click();
    const directory = friend.getByRole("region", { name: "Live sessions" });
    await directory.getByRole("button", { name: new RegExp(name) }).click();
    await friend.getByLabel("Room PIN", { exact: true }).fill("654321");
    await friend.getByRole("button", { name: "Join your friends" }).click();
    await expect(friend.locator(".entry-card .error")).toContainText("Unable to join");
    await friend.getByLabel("Room PIN", { exact: true }).fill("123456");
    await friend.getByRole("button", { name: "Join your friends" }).click();
    await expect(friend.locator(".connection")).toHaveText("Connected");
    await friend.reload();
    await expect(friend.locator(".connection")).toHaveText("Connected");
    await friend.getByRole("button", { name: "Session info", exact: true }).click();
    const info = friend.getByRole("region", { name: "Session info" });
    await info.getByRole("button", { name: "Reveal PIN" }).click();
    await expect(info.getByLabel("Room PIN", { exact: true })).toHaveValue("123456");
    const response = await friend.request.get("/api/live-sessions");
    const listing = await response.json();
    expect(listing.sessions.find((s: { name: string }) => s.name === name)).toMatchObject({ players: 2, full: false });
    expect(JSON.stringify(listing)).not.toMatch(/123456|verifier|ticket|token|ownerId/);
  } finally {
    await context.close();
  }
});
