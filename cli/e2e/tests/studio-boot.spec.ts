import { expect, test } from "@playwright/test";
import { dismissCookieBanner, projectHome } from "../support/studio-page.js";
import {
  FIXTURE_PROJECT_NAME,
  FIXTURE_PROJECT_VERSION,
  loadRun,
  readRunFile,
} from "../support/target.js";

/**
 * The Studio stack boots from a project: `ph-cli run
 * @powerhousedao/vetra-cli/studio` in the fixture project (global-setup)
 * serves Connect, which shows the project home for the Studio drive: the
 * project's name and version, its conversations and its specifications.
 */
const run = loadRun();
/** Booted (not attached): the fixture project's name and version show. */
const booted = Boolean(readRunFile()?.tmp);

test.describe("Vetra studio — boot", () => {
  test("the stack serves the project home", async ({ page }) => {
    await page.goto(`${run.baseUrl}/d/${run.driveId}`, {
      waitUntil: "domcontentloaded",
    });
    await dismissCookieBanner(page);

    const home = projectHome(page);
    await expect(home.header).toBeVisible({ timeout: 60_000 });
    await expect(home.conversations).toBeVisible();
    await expect(
      home.specifications.getByRole("heading", { name: "Specifications" }),
    ).toBeVisible();
    // No idea screen: Studio creates no project and starts no product.
    await expect(
      page.getByRole("heading", { name: "What do you want to build?" }),
    ).toHaveCount(0);

    if (booted) {
      // The project's package.json, read by the Cli's local API.
      await expect(
        home.header.getByRole("heading", { name: FIXTURE_PROJECT_NAME }),
      ).toBeVisible({ timeout: 30_000 });
      await expect(home.header.locator("[data-project-version]")).toHaveText(
        FIXTURE_PROJECT_VERSION,
      );
    }
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
