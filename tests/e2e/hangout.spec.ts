import { gameAction } from "./menu-actions";
import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import {
  GAME_CONFIG,
  FOREST_MAP as HOME_MAP,
  RACE_MAP,
  SKIN_COLORS,
  HAIR_COLORS,
  CLOTHING_COLORS,
  TROUSER_COLORS,
} from "../../packages/config/src/index";

function collectErrors(page: Page, errors: string[]) {
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      !/Failed to load resource:.*status of 401/.test(message.text())
    )
      errors.push(`${message.text()} (${message.location().url})`);
  });
}
async function noOverlay(page: Page) {
  await expect(
    page.locator(
      "[data-nextjs-dialog], [data-nextjs-error-overlay], .vite-error-overlay",
    ),
  ).toHaveCount(0);
}
async function api<T>(page: Page, path: string): Promise<T> {
  return page.evaluate(async (p) => {
    const result = await fetch(`/api${p}`, { credentials: "include" });
    return result.json();
  }, path);
}
async function worldPoint(page: Page, point: { x: number; y: number }) {
  const world = page.locator(".world-canvas");
  await expect(world).toHaveAttribute(
    "data-world-width",
    String(HOME_MAP.width),
  );
  await world.locator("canvas").scrollIntoViewIfNeeded();
  // React changes layout before Phaser resizes. Wait for the accepted home projection.
  await expect
    .poll(async () =>
      world.evaluate((element) => {
        const canvas = element.querySelector("canvas")!;
        const box = canvas.getBoundingClientRect();
        const data = (element as HTMLElement).dataset;
        return (
          Math.abs(box.width - element.clientWidth) < 2 &&
          Math.abs(
            Number(data.cameraZoom) -
              Math.min(box.width,box.height) / (Number(data.tileSize) * 22),
          ) < 0.001
        );
      }),
    )
    .toBe(true);
  const box = await world.locator("canvas").boundingBox();
  if (!box) throw new Error("World is not visible");
  const projection = await world.evaluate((element) => {
    const data = (element as HTMLElement).dataset;
    return {
      tile: Number(data.tileSize),
      zoom: Number(data.cameraZoom),
      x: Number(data.cameraScrollX),
      y: Number(data.cameraScrollY),
    };
  });
  expect(projection.tile).toBeGreaterThan(0);
  expect(projection.zoom).toBeGreaterThan(0);
  return {
    x: box.x + (point.x * projection.tile - projection.x) * projection.zoom,
    y: box.y + (point.y * projection.tile - projection.y) * projection.zoom,
  };
}
async function clickTile(page: Page, point: { x: number; y: number }) {
  const screen = await worldPoint(page, point);
  await page.mouse.click(screen.x, screen.y);
}
async function serverPosition(page: Page) {
  return page.locator(".world-canvas").evaluate((element) => {
    const data = (element as HTMLElement).dataset;
    return { x: Number(data.authoritativeX), y: Number(data.authoritativeY) };
  });
}
async function reachTile(page: Page, point: { x: number; y: number }) {
  await clickTile(page, point);
  await expect
    .poll(
      async () => {
        const position = await serverPosition(page);
        return Math.hypot(position.x - point.x, position.y - point.y);
      },
      { timeout: 15_000 },
    )
    .toBeLessThan(0.6);
}
/** Exercise camera following with keyboard inputs over real course geometry. */
async function followRaceCamera(page: Page) {
  const viewport = await page.locator(".world-canvas").evaluate((element) => {
    const data = (element as HTMLElement).dataset;
    return {
      width: element.clientWidth,
      zoom: Number(data.cameraZoom),
      tile: Number(data.tileSize),
    };
  });
  const goal = viewport.width / viewport.zoom / viewport.tile / 2 + 6;
  const samplesPromise = page.evaluate(
    ({ goal }) =>
      new Promise<{ x: number; camera: number; t: number }[]>((resolve) => {
        const samples: { x: number; camera: number; t: number }[] = [];
        const started = performance.now();
        const sample = () => {
          const data = (document.querySelector(".world-canvas") as HTMLElement)
            .dataset;
          samples.push({
            x: Number(data.renderX),
            camera: Number(data.cameraScrollX),
            t: performance.now(),
          });
          if (
            (Number(data.authoritativeX) < goal ||
              Number(data.cameraScrollX) <= 0) &&
            performance.now() - started < 12_000
          )
            requestAnimationFrame(sample);
          else resolve(samples);
        };
        requestAnimationFrame(sample);
      }),
    { goal },
  );
  const obstacles = [
    ...RACE_MAP.hazards,
    ...RACE_MAP.platforms.filter((platform) => platform.y < 16),
  ].sort((a, b) => a.x - b.x);
  const started = Date.now();
  let jumpingUntil = 0;
  await page.locator(".world-canvas").focus();
  await page.keyboard.down("d");
  try {
    while (
      (await serverPosition(page)).x < goal &&
      Date.now() - started < 12_000
    ) {
      const position = await serverPosition(page);
      if (jumpingUntil && Date.now() >= jumpingUntil) {
        await page.keyboard.up("Space");
        jumpingUntil = 0;
      }
      const surface = RACE_MAP.platforms.find(
        (platform) =>
          position.x >= platform.x - 0.3 &&
          position.x <= platform.x + platform.width + 0.3 &&
          Math.abs(position.y - (platform.y - GAME_CONFIG.playerRadius)) < 0.1,
      );
      const approaching = obstacles.find(
        (obstacle) =>
          obstacle.x - position.x > 0 && obstacle.x - position.x < 1.6,
      );
      if (surface && approaching && !jumpingUntil) {
        await page.keyboard.down("Space");
        jumpingUntil = Date.now() + 120;
      }
      await page.waitForTimeout(40);
    }
  } finally {
    await page.keyboard.up("d");
    await page.keyboard.up("Space");
  }
  const samples = await samplesPromise;
  expect((await serverPosition(page)).x).toBeGreaterThanOrEqual(goal);
  const following = samples.filter((sample) => sample.camera > viewport.tile);
  expect(following.length).toBeGreaterThan(10);
  expect(following.at(-1)!.camera - following[0].camera).toBeGreaterThan(
    viewport.tile * 2,
  );
  expect(
    samples.every(
      (sample) => Number.isFinite(sample.x) && Number.isFinite(sample.camera),
    ),
  ).toBe(true);
  expect(
    Math.max(
      ...samples
        .slice(1)
        .map((sample, index) => Math.abs(sample.x - samples[index].x)),
    ),
  ).toBeLessThan(0.75);
  expect(
    Math.max(
      ...following
        .slice(1)
        .map((sample, index) =>
          Math.abs(sample.camera - following[index].camera),
        ),
    ),
  ).toBeLessThan(viewport.tile * 0.75);
  await test.info().attach("race-camera-continuity", {
    contentType: "application/json",
    body: JSON.stringify(
      {
        goal,
        finalX: (await serverPosition(page)).x,
        frames: samples.length,
        followingFrames: following.length,
        cameraAdvanceTiles:
          (following.at(-1)!.camera - following[0].camera) / viewport.tile,
        maxRenderDeltaTiles: Math.max(
          ...samples
            .slice(1)
            .map((sample, index) => Math.abs(sample.x - samples[index].x)),
        ),
        maxCameraDeltaTiles:
          Math.max(
            ...following
              .slice(1)
              .map((sample, index) =>
                Math.abs(sample.camera - following[index].camera),
              ),
          ) / viewport.tile,
      },
      null,
      2,
    ),
  });
}
async function enterLounge(page: Page) {
  await expect(page.locator(".world-canvas")).toHaveAttribute("data-world-id","forest");
  await expect(page.locator(".world-canvas")).toHaveAttribute("data-seat-id",/camp-seat-/);
}
async function createHome(page: Page, name: string, homeName: string) {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Your space starts here." }),
  ).toBeVisible();
  await page.getByLabel("Your name", { exact: true }).fill(name);
  await page.getByLabel("Home name", { exact: true }).fill(homeName);
  await page.getByLabel("Choose a private PIN", { exact: true }).fill("123456");
  await page.getByRole("button", { name: "Create & enter home" }).click();
  await enterLounge(page);
  await expect(page.getByRole("heading", { name: "Midnight Pines" })).toBeVisible();
  await expect(page.locator(".connection")).toHaveText("Connected");
  await expect(page.locator("canvas")).toBeVisible();
  const { homes } = await api<{ homes: { id: string; name: string }[] }>(
    page,
    "/homes",
  );
  return homes.find((home) => home.name === homeName)!.id;
}
async function joinHome(page: Page, name: string, homeId: string) {
  await page.goto("/");
  await page.getByLabel("Your name", { exact: true }).fill(name);
  await page.getByRole("button", { name: "Join friends", exact: true }).click();
  await page.getByLabel("Home ID", { exact: true }).fill(homeId);
  await page.getByLabel("Room PIN", { exact: true }).fill("123456");
  await page.getByRole("button", { name: "Join your friends" }).click();
  await expect(page.locator(".connection")).toHaveText("Connected");
  await expect(page.locator("canvas")).toBeVisible();
}

test("two independent browsers hang out, chat once, share notes, customize and reload", async ({
  browser,
  page,
}) => {
  const errors: string[] = [];
  collectErrors(page, errors);
  const unique = Date.now().toString(36),
    homeName = `The test nook ${unique}`,
    firstName = `Ari ${unique}`,
    secondName = `Remy ${unique}`;
  const contextB = await browser.newContext();
  const second = await contextB.newPage();
  collectErrors(second, errors);
  try {
    await page.goto("/");
    await page.getByLabel("Your name", { exact: true }).fill(firstName);
    const initialPreview = await page
      .locator(".character-stage canvas")
      .evaluate((canvas) => (canvas as HTMLCanvasElement).toDataURL());
    await page
      .getByLabel(`Skin color ${SKIN_COLORS[3]}`, { exact: true })
      .click();
    await page
      .getByLabel(`Hair color ${HAIR_COLORS[4]}`, { exact: true })
      .click();
    await page
      .getByLabel(`Shirt color ${CLOTHING_COLORS[2]}`, { exact: true })
      .click();
    await page
      .getByLabel(`Trouser color ${TROUSER_COLORS[4]}`, { exact: true })
      .click();
    await expect
      .poll(() =>
        page
          .locator(".character-stage canvas")
          .evaluate((canvas) => (canvas as HTMLCanvasElement).toDataURL()),
      )
      .not.toBe(initialPreview);
    for (const [label, option] of [
      ["Hair", "curly"],
      ["Outfit", "overalls"],
      ["Extra", "glasses"],
    ]) {
      const priorPreview = await page
        .locator(".character-stage canvas")
        .evaluate((canvas) => (canvas as HTMLCanvasElement).toDataURL());
      await page.getByLabel(label, { exact: true }).selectOption(option);
      await expect
        .poll(() =>
          page
            .locator(".character-stage canvas")
            .evaluate((canvas) => (canvas as HTMLCanvasElement).toDataURL()),
        )
        .not.toBe(priorPreview);
    }
    const frontPreview = await page
      .locator(".character-stage canvas")
      .evaluate((canvas) => (canvas as HTMLCanvasElement).toDataURL());
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expect
      .poll(() =>
        page
          .locator(".character-stage canvas")
          .evaluate((canvas) => (canvas as HTMLCanvasElement).toDataURL()),
      )
      .not.toBe(frontPreview);
    await page.getByRole("button", { name: "Front", exact: true }).click();
    await page.getByLabel("Home name", { exact: true }).fill(homeName);
    await page
      .getByLabel("Choose a private PIN", { exact: true })
      .fill("123456");
    await page.getByRole("button", { name: "Create & enter home" }).click();
    await enterLounge(page);
    await expect(page.locator(".connection")).toHaveText("Connected");
    await expect(page.locator("canvas")).toBeVisible();
    const { homes } = await api<{ homes: { id: string; name: string }[] }>(
      page,
      "/homes",
    );
    const homeId = homes.find((home) => home.name === homeName)!.id;
    await expect
      .poll(async () =>
        page
          .locator(".world-canvas")
          .evaluate((element) =>
            JSON.parse((element as HTMLElement).dataset.selfAvatar || "{}"),
          ),
      )
      .toMatchObject({
        skinColor: SKIN_COLORS[3],
        hairColor: HAIR_COLORS[4],
        clothingColor: CLOTHING_COLORS[2],
        trouserColor: TROUSER_COLORS[4],
        hair: "curly",
        outfit: "overalls",
        accessory: "glasses",
      });
    await joinHome(second, secondName, homeId);
    const roster = await api<{
      members: { name: string; avatar: Record<string, string> }[];
    }>(second, `/homes/${homeId}`);
    expect(
      roster.members.find((person) => person.name === firstName)?.avatar,
    ).toMatchObject({
      skinColor: SKIN_COLORS[3],
      hairColor: HAIR_COLORS[4],
      clothingColor: CLOTHING_COLORS[2],
      trouserColor: TROUSER_COLORS[4],
      hair: "curly",
      outfit: "overalls",
      accessory: "glasses",
    });

    await expect(
      page.getByRole("button", {
        name: `2/${GAME_CONFIG.partyCapacity} friends`,
      }),
    ).toBeVisible();
    await expect(
      second.getByRole("button", {
        name: `2/${GAME_CONFIG.partyCapacity} friends`,
      }),
    ).toBeVisible();
    await page.bringToFront();
    await page.getByRole("button", { name: "People & volume" }).click();
    const peoplePanel = page.getByRole("complementary", {
      name: "People and volume",
    });
    const personSlider = peoplePanel.getByRole("slider", {
      name: `Soundboard volume for ${secondName}`,
    });
    await personSlider.fill("0.35");
    await expect(personSlider).toHaveValue("0.35");
    await peoplePanel
      .getByRole("button", { name: "Mute sounds", exact: true })
      .click();
    await expect(
      peoplePanel.getByRole("button", { name: "Unmute sounds", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await peoplePanel
      .getByRole("button", { name: `${secondName} Interact` })
      .click();
    const personDialog = page.getByRole("dialog", { name: "person controls" });
    await expect(
      personDialog.getByRole("heading", { name: secondName }),
    ).toBeVisible();
    await expect(personDialog.getByRole("slider")).toHaveValue("0.35");
    await personDialog
      .getByRole("button", { name: "Unmute sounds", exact: true })
      .click();
    await page.getByRole("button", { name: "Close dialog" }).click();
    await page.getByRole("button", { name: "People & volume" }).click();
    await page.locator(".world-canvas").focus();
    const beforeX = await page
      .locator(".world-canvas")
      .getAttribute("data-authoritative-x");
    await page.keyboard.down("d");
    await page.waitForTimeout(600);
    await page.keyboard.up("d");
    await expect
      .poll(async () =>
        Number(
          await page
            .locator(".world-canvas")
            .getAttribute("data-authoritative-x"),
        ),
      )
      .toBeGreaterThan(Number(beforeX) + 1);
    const stoppedX = Number(
      await page.locator(".world-canvas").getAttribute("data-authoritative-x"),
    );
    await page.getByLabel("Message friends").focus();
    await page.keyboard.down("ArrowRight");
    await page.waitForTimeout(350);
    await page.keyboard.up("ArrowRight");
    expect(
      Math.abs(
        Number(
          await page
            .locator(".world-canvas")
            .getAttribute("data-authoritative-x"),
        ) - stoppedX,
      ),
    ).toBeLessThan(0.5);
    await page
      .getByLabel("Message friends")
      .fill("Hello from the cozy corner!");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect(
      second
        .locator(".chat-messages p")
        .filter({ hasText: "Hello from the cozy corner!" }),
    ).toHaveCount(1);
    await expect(
      page
        .locator(".chat-messages p")
        .filter({ hasText: "Hello from the cozy corner!" }),
    ).toHaveCount(1);
    await expect(page.locator(".pending")).toHaveCount(0);
    await second.getByRole("button", { name: "Little conversations" }).click();
    await page.getByLabel("Message friends").fill("A second little thought");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect(second.locator(".chat-panel .chat-heading b")).toHaveText("1");
    await expect(second.locator(".chat-panel")).toHaveClass(/collapsed/);
    await gameAction(page, () => page
      .getByRole("button", { name: "Idea board", exact: false })
      .click());
    await page
      .getByLabel("Add a little thought")
      .fill("Movie night on Friday?");
    await page.getByRole("button", { name: "Pin it to the board" }).click();
    await expect(page.locator(".sticky p")).toHaveText(
      "Movie night on Friday?",
    );
    await page.getByRole("button", { name: "Close dialog" }).click();
    await gameAction(second,()=>second
      .getByRole("button", { name: "Idea board", exact: false })
      .click());
    await expect(second.locator(".sticky p")).toHaveText(
      "Movie night on Friday?",
    );
    await second.getByRole("button", { name: "Edit", exact: true }).click();
    await second
      .getByLabel("Edit your thought")
      .fill("Movie night on Saturday!");
    await second.getByRole("button", { name: "Save changes" }).click();
    await expect(second.locator(".sticky p")).toHaveText(
      "Movie night on Saturday!",
    );
    await second.getByRole("button", { name: "Close dialog" }).click();
    await page.getByRole("button", { name: "Leave home", exact: true }).click();
    await page.reload();
    await expect(page.getByLabel("Your name", { exact: true })).toHaveValue(
      firstName,
    );
    await expect(page.getByLabel("Hair", { exact: true })).toHaveValue("curly");
    await expect(page.getByLabel("Outfit", { exact: true })).toHaveValue(
      "overalls",
    );
    await expect(
      page.getByLabel(`Skin color ${SKIN_COLORS[3]}`, { exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    for (const [label, color] of [
      ["Hair color", HAIR_COLORS[4]],
      ["Shirt color", CLOTHING_COLORS[2]],
      ["Trouser color", TROUSER_COLORS[4]],
    ])
      await expect(
        page.getByLabel(`${label} ${color}`, { exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByLabel("Extra", { exact: true })).toHaveValue(
      "glasses",
    );
    await page.getByRole("button", { name: homeName }).click();
    await expect(page.locator(".connection")).toHaveText("Connected");
    await page.getByRole("button", { name: "People & volume" }).click();
    await expect(
      page
        .getByRole("complementary", { name: "People and volume" })
        .getByRole("slider", { name: `Soundboard volume for ${secondName}` }),
    ).toHaveValue("0.35");
    await page.getByRole("button", { name: "People & volume" }).click();
    await gameAction(page, () => page
      .getByRole("button", { name: "Idea board", exact: false })
      .click());
    await expect(page.locator(".sticky p")).toHaveText(
      "Movie night on Saturday!",
    );
    await page.screenshot({
      path: "tests/e2e/artifacts/shared-board.png",
      fullPage: true,
    });
    await page.getByRole("button", { name: "Close dialog" }).click();
    await page.screenshot({
      path: "tests/e2e/artifacts/cozy-home.png",
      fullPage: true,
    });
    await noOverlay(page);
    await noOverlay(second);
    expect(errors).toEqual([]);
  } finally {
    await contextB.close();
  }
});

test("mobile entry and local settings remain touch-accessible", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  const errors: string[] = [];
  collectErrors(page, errors);
  try {
    await createHome(
      page,
      `Mobile ${Date.now().toString(36)}`,
      `Pocket home ${Date.now().toString(36)}`,
    );
    const tapTarget = { x: HOME_MAP.spawn.x + 2, y: HOME_MAP.spawn.y + 3 };
    const tapPoint = await worldPoint(page, tapTarget);
    await page.touchscreen.tap(tapPoint.x, tapPoint.y);
    await expect
      .poll(
        async () => {
          const position = await serverPosition(page);
          return Math.hypot(position.x - tapTarget.x, position.y - tapTarget.y);
        },
        { timeout: 10_000 },
      )
      .toBeLessThan(0.6);
    await expect(
      page.getByRole("button", { name: "Move right", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Settings", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByLabel("Show corner chat panel", { exact: true }).uncheck();
    await page
      .getByLabel("Show avatar speech bubbles", { exact: true })
      .uncheck();
    await page.getByLabel("Reduced motion", { exact: true }).check();
    await page.getByRole("button", { name: "Close dialog" }).click();
    await expect(page.locator(".chat-panel")).toHaveCount(0);
    await page.screenshot({
      path: "tests/e2e/artifacts/mobile-home.png",
      fullPage: true,
    });
    await page.getByRole("button", { name: "Leave home", exact: true }).click();
    await page.reload();
    const prefs = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("third-space.preferences") || "{}"),
    );
    expect(prefs).toMatchObject({
      panel: false,
      bubbles: false,
      reducedMotion: true,
    });
    await noOverlay(page);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test("eight independent friends have reachable rosters and audio controls; a ninth cannot enter", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  expect(GAME_CONFIG.partyCapacity).toBe(8);
  const contexts: BrowserContext[] = [];
  const pages: Page[] = [];
  const errors: string[] = [];
  const unique = Date.now().toString(36);
  const names = Array.from(
    { length: GAME_CONFIG.partyCapacity },
    (_, index) => `Friend ${index + 1} ${unique}`,
  );
  const homeName = `Eight friends ${unique}`;
  try {
    for (let index = 0; index < GAME_CONFIG.partyCapacity + 1; index++) {
      const context = await browser.newContext(
        index === GAME_CONFIG.partyCapacity - 1
          ? {
              viewport: { width: 390, height: 844 },
              isMobile: true,
              hasTouch: true,
            }
          : {},
      );
      contexts.push(context);
      const page = await context.newPage();
      pages.push(page);
      if (index < GAME_CONFIG.partyCapacity) collectErrors(page, errors);
    }
    const owner = pages[0];
    const homeId = await createHome(owner, names[0], homeName);
    for (let index = 1; index < GAME_CONFIG.partyCapacity; index++)
      await joinHome(pages[index], names[index], homeId);
    for (const page of pages.slice(0, GAME_CONFIG.partyCapacity)) {
      await expect(
        page.getByRole("button", {
          name: `${GAME_CONFIG.partyCapacity}/${GAME_CONFIG.partyCapacity} friends`,
        }),
      ).toBeVisible();
      await expect(page.locator(".connection")).toHaveText("Connected");
    }
    await owner
      .getByRole("button", {
        name: `${GAME_CONFIG.partyCapacity}/${GAME_CONFIG.partyCapacity} friends`,
      })
      .click();
    await expect(
      owner
        .getByRole("list", { name: "Friends in this world" })
        .getByRole("listitem"),
    ).toHaveCount(GAME_CONFIG.partyCapacity);
    for (const name of names)
      await expect(owner.locator(".roster")).toContainText(name);
    await owner.getByRole("button", { name: "Close dialog" }).click();
    await owner.getByRole("button", { name: "People & volume" }).click();
    const panel = owner.getByRole("complementary", {
      name: "People and volume",
    });
    await expect(panel.getByRole("slider")).toHaveCount(
      GAME_CONFIG.partyCapacity - 1,
    );
    const lastSlider = panel.getByRole("slider", {
      name: `Soundboard volume for ${names.at(-1)}`,
    });
    await lastSlider.scrollIntoViewIfNeeded();
    await lastSlider.fill("0.4");
    await expect(lastSlider).toHaveValue("0.4");
    await owner.getByRole("button", { name: "People & volume" }).click();
    const mobile = pages[GAME_CONFIG.partyCapacity - 1];
    await mobile.getByRole("button", { name: "People & volume" }).click();
    const mobilePanel = mobile.getByRole("complementary", {
      name: "People and volume",
    });
    await expect(mobilePanel.getByRole("slider")).toHaveCount(
      GAME_CONFIG.partyCapacity - 1,
    );
    const mobileLastSlider = mobilePanel.getByRole("slider").last();
    await mobileLastSlider.scrollIntoViewIfNeeded();
    await mobileLastSlider.fill("0.5");
    await expect(mobileLastSlider).toHaveValue("0.5");
    expect(
      await mobile.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await mobile.getByRole("button", { name: "People & volume" }).click();
    await mobile
      .getByRole("button", {
        name: `${GAME_CONFIG.partyCapacity}/${GAME_CONFIG.partyCapacity} friends`,
      })
      .click();
    await expect(mobile.locator(".roster article")).toHaveCount(
      GAME_CONFIG.partyCapacity,
    );
    await mobile.locator(".roster article").last().scrollIntoViewIfNeeded();
    await mobile.getByRole("button", { name: "Close dialog" }).click();
    await gameAction(owner, () => owner.getByRole("button", { name: "Let's play" }).click());
    await expect(
      owner.getByRole("list", { name: "Race readiness" }).getByRole("listitem"),
    ).toHaveCount(GAME_CONFIG.partyCapacity);
    await expect(owner.locator(".game-card")).toContainText(
      `1–${GAME_CONFIG.partyCapacity} friends`,
    );
    await owner.getByRole("button", { name: "Close dialog" }).click();
    const ninth = pages[GAME_CONFIG.partyCapacity];
    await ninth.goto("/");
    await ninth
      .getByLabel("Your name", { exact: true })
      .fill(`Ninth ${unique}`);
    await ninth
      .getByRole("button", { name: "Join friends", exact: true })
      .click();
    await ninth.getByLabel("Home ID", { exact: true }).fill(homeId);
    await ninth.getByLabel("Room PIN", { exact: true }).fill("123456");
    await ninth.getByRole("button", { name: "Join your friends" }).click();
    await expect(ninth.locator(".error")).toContainText(
      /full|player limit|capacity/i,
    );
    await expect(
      ninth.getByRole("heading", { name: "Your space starts here." }),
    ).toBeVisible();
    await expect(ninth.locator(".world-canvas")).toHaveCount(0);
    await expect(
      owner.getByRole("button", {
        name: `${GAME_CONFIG.partyCapacity}/${GAME_CONFIG.partyCapacity} friends`,
      }),
    ).toBeVisible();
    await owner.screenshot({
      path: "tests/e2e/artifacts/eight-friends.png",
      fullPage: true,
    });
    for (const page of pages) await noOverlay(page);
    expect(errors).toEqual([]);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
