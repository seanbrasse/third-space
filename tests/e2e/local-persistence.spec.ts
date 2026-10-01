import { test, expect, type Page } from "@playwright/test";

async function storedVisits(page: Page) {
  return page.evaluate(async () => {
    const { profile } = await (await fetch("/api/identity")).json();
    const key = `third-space.visits.user:${encodeURIComponent(profile.id)}`;
    return JSON.parse(localStorage.getItem(key) || '{"visits":[]}').visits as { homeId: string; count: number }[];
  });
}
async function connected(page: Page) {
  await expect(page.locator(".connection")).toHaveText("Connected");
  await expect(page.locator(".world-canvas")).toHaveAttribute("data-self-avatar", /"hair":"long"/);
}

test("local look survives guest reload, create, saved-room entry and recovery; distinct same-name homes stay separate", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  // Duplicate transport rows must not duplicate private-home cards.
  await page.route("**/api/homes", async route => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch();
    const body = await response.json();
    if (Array.isArray(body.homes) && body.homes.length) body.homes.push({ ...body.homes[0] });
    await route.fulfill({ response, json: body });
  });
  await page.goto("/");
  await page.getByLabel("Hair", { exact: true }).selectOption("long");
  await page.getByLabel("Outfit", { exact: true }).selectOption("jacket");
  await page.reload();
  await expect(page.getByLabel("Hair", { exact: true })).toHaveValue("long");
  await expect(page.getByLabel("Outfit", { exact: true })).toHaveValue("jacket");
  const firstSuggestion = await page.getByLabel("Home name", { exact: true }).inputValue();
  expect(firstSuggestion).not.toBe("Our little place");
  const name = `Same-name ${Date.now()}`;
  await page.getByLabel("Your name", { exact: true }).fill("Local look");
  await page.getByLabel("Home name", { exact: true }).fill(name);
  await page.getByLabel("Choose a private PIN", { exact: true }).fill("123456");
  await page.getByRole("button", { name: "Create & enter home" }).click();
  await connected(page);
  await expect.poll(async () => (await storedVisits(page))[0]?.count).toBe(1);
  await page.reload();
  await connected(page);
  expect((await storedVisits(page))[0].count).toBe(1);
  await page.getByRole("button", { name: "Leave home", exact: true }).click();
  await expect(page.locator(".saved-homes button")).toHaveCount(1);
  await expect(page.locator(".saved-homes button")).toContainText("1 visit");
  await page.getByLabel("Outfit", { exact: true }).selectOption("overalls");
  await page.locator(".saved-homes button").click();
  await connected(page);
  await expect(page.locator(".world-canvas")).toHaveAttribute("data-self-avatar", /"outfit":"overalls"/);
  await expect.poll(async () => (await storedVisits(page))[0]?.count).toBe(2);
  await page.getByRole("button", { name: "Leave home", exact: true }).click();
  await expect(page.getByLabel("Home name", { exact: true })).not.toHaveValue(firstSuggestion);
  await page.getByLabel("Home name", { exact: true }).fill(name);
  await page.getByLabel("Choose a private PIN", {exact:true}).fill("123456");
  await page.getByRole("button", { name: "Create & enter home" }).click();
  await connected(page);
  await page.getByRole("button", { name: "Leave home", exact: true }).click();
  await expect(page.locator(".saved-homes button")).toHaveCount(2);
  await expect(page.locator(".saved-homes button").filter({ hasText: name })).toHaveCount(2);
  const visits = await storedVisits(page);
  expect(new Set(visits.map(visit => visit.homeId)).size).toBe(2);
  expect(visits.map(visit => visit.count).sort()).toEqual([1, 2]);
  expect(errors).toEqual([]);
});
