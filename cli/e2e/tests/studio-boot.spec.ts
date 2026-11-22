import { expect, test, type Page } from "@playwright/test";
import { loadRun } from "../support/target.js";

/**
 * The Studio stack boots: `ph-cli run studio` (global-setup) serves Connect,
 * which shows an empty Studio's idea screen for the Studio drive.
 */
const run = loadRun();

/** Connect's cookie banner has a full-screen blur backdrop that intercepts
 * clicks. Dismiss it when it shows (it may paint slightly after load). */
async function dismissCookieBanner(page: Page): Promise<void> {
  const reject = page.getByRole("button", { name: /reject all cookies/i });
  try {
    await reject.waitFor({ state: "visible", timeout: 3_000 });
    await reject.click();
    await expect(reject).toBeHidden();
  } catch {
    /* never appeared — fine */
  }
}

test.describe("Vetra studio — boot", () => {
  test("the stack serves the Studio idea screen", async ({ page }) => {
    await page.goto(`${run.baseUrl}/d/${run.driveId}`, {
      waitUntil: "domcontentloaded",
    });
    await dismissCookieBanner(page);

    await expect(page.getByRole("textbox", { name: "Your idea" })).toBeVisible({
      timeout: 60_000,
    });
    await expect(
      page.getByRole("heading", { name: "What do you want to build?" }),
    ).toBeVisible();
  });
});
