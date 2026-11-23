import { expect, test } from "@playwright/test";
import { dismissCookieBanner, studioPage } from "../support/studio-page.js";
import {
  FIXTURE_PROJECT_NAME,
  FIXTURE_PROJECT_VERSION,
  loadRun,
  readRunFile,
} from "../support/target.js";

/**
 * The Studio stack boots from a project: `ph-cli run
 * @powerhousedao/vetra-cli/studio` in the fixture project (global-setup)
 * serves Connect, which shows the Studio page for the Studio drive: the top
 * bar with the project's name and version, and the Specs and Agent panels.
 */
const run = loadRun();
/** Booted (not attached): the fixture project's name and version show. */
const booted = Boolean(readRunFile()?.tmp);
const studioHome = `${run.baseUrl}/d/${run.driveId}`;

test.describe("Vetra studio — boot", () => {
  test("the stack serves the Studio page", async ({ page }) => {
    await page.goto(studioHome, { waitUntil: "domcontentloaded" });
    await dismissCookieBanner(page);

    const studio = studioPage(page);
    await expect(studio.bar).toBeVisible({ timeout: 60_000 });
    await expect(studio.specs).toBeVisible();
    await expect(studio.agent).toBeVisible();
    await expect(studio.test).toHaveCount(0);
    // The explorer's stages, over the specification drive.
    for (const stage of ["Ideate", "Specify", "Build", "Deploy"]) {
      await expect(
        studio.tree.getByText(stage, { exact: true }).first(),
      ).toBeVisible();
    }
    // No idea screen: Studio creates no project and starts no product.
    await expect(
      page.getByRole("heading", { name: "What do you want to build?" }),
    ).toHaveCount(0);

    if (booted) {
      // The project's package.json, read by the Cli's local API.
      await expect(studio.bar.locator("[data-project-name]")).toHaveText(
        FIXTURE_PROJECT_NAME,
        { timeout: 30_000 },
      );
      await expect(studio.bar.locator("[data-project-version]")).toHaveText(
        FIXTURE_PROJECT_VERSION,
      );
    }
  });

  test("panels close and open from the bar; Test is not available yet", async ({
    page,
  }) => {
    await page.goto(studioHome, { waitUntil: "domcontentloaded" });
    await dismissCookieBanner(page);

    const studio = studioPage(page);
    await expect(studio.bar).toBeVisible({ timeout: 60_000 });
    await studio.toggle("test").click();
    await expect(studio.test).toContainText("Test is not available yet.");

    await studio.toggle("specs").click();
    await studio.toggle("test").click();
    await studio.toggle("agent").click();
    await expect(page.getByText("All panels are closed")).toBeVisible();
    await page
      .locator('[data-panels="none"] [data-panel-toggle="specs"]')
      .click();
    await expect(studio.specs).toBeVisible();
  });

  test("a Build row opens its placeholder page with the Labs screen", async ({
    page,
  }) => {
    await page.goto(studioHome, { waitUntil: "domcontentloaded" });
    await dismissCookieBanner(page);

    const studio = studioPage(page);
    await expect(studio.tree).toBeVisible({ timeout: 60_000 });
    await studio.tree.getByText("Packages", { exact: true }).click();
    const screen = studio.specs.locator('img[src="/vetra-labs/packages.jpg"]');
    await expect(screen).toBeVisible();
    // Connect serves the picture, and the browser decodes it.
    await expect
      .poll(() =>
        screen.evaluate((img: HTMLImageElement) => img.naturalWidth),
      )
      .toBeGreaterThan(0);
  });

  test("Test opens in a tab of its own, without the bar", async ({ page }) => {
    await page.goto(`${studioHome}?embed=1&panel=test`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByText("Test is not available yet.")).toBeVisible({
      timeout: 60_000,
    });
    await expect(studioPage(page).bar).toHaveCount(0);
  });

  test("Connect serves studio.config.json naming the Cli's local API", async () => {
    const res = await fetch(`${run.baseUrl}/studio.config.json`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    const config = (await res.json()) as {
      previewServerUrl?: string;
      studioOrigin?: string;
    };
    expect(config.previewServerUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(config.studioOrigin).toBe(new URL(run.baseUrl).origin);
    const version = await fetch(`${config.previewServerUrl}/version`);
    expect(((await version.json()) as { vetraCli?: string }).vetraCli).toBeTruthy();
  });
});
