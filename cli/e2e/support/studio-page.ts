import { readFileSync } from "node:fs";
import { expect, type Page } from "@playwright/test";

/** Connect's cookie banner has a full-screen blur backdrop that intercepts
 * clicks. Dismiss it; safe to call repeatedly (no-op once gone). */
export async function dismissCookieBanner(page: Page): Promise<void> {
  const reject = page.getByRole("button", { name: /reject all cookies/i });
  if (await reject.isVisible().catch(() => false)) {
    await reject.click();
    await expect(reject).toBeHidden();
    return;
  }
  // It may paint slightly after load — short bounded chance, then give up
  // (a missing banner is the common case and must not cost the full wait).
  try {
    await reject.waitFor({ state: "visible", timeout: 3_000 });
    await reject.click();
    await expect(reject).toBeHidden();
  } catch {
    /* never appeared — fine */
  }
}

/** Throw on the first replay-step error in the Cli's log so a failed build
 * fails in seconds instead of waiting out the whole timeout. No log (an
 * attached run without `VETRA_E2E_LOG`): nothing to check. */
export function assertNoReplayError(log: string | undefined): void {
  if (!log) return;
  let text = "";
  try {
    text = readFileSync(log, "utf8");
  } catch {
    return; // not written yet
  }
  // Anchor on the status field (`<tool> ERROR:`) so a successful step whose
  // result text merely contains "ERROR" isn't a false positive.
  const m = text.match(/^\[replay\]\s+\d+\/\d+\s+\S+\s+ERROR\b.*/m);
  if (m) throw new Error(`replay failed — ${m[0].trim()}`);
}

/** Start the build the way a customer does. An empty Studio shows the idea
 * screen ("What do you want to build?"): typing the idea there and pressing
 * Build it creates the product, the first conversation and its first message,
 * and the page turns into the build — the step strip over the story (the idea
 * quoted first) and the live preview. Returns the story pane. */
export async function startBuild(page: Page, prompt: string) {
  const idea = page.getByRole("textbox", { name: "Your idea" });
  await expect(idea).toBeVisible({ timeout: 30_000 });
  await dismissCookieBanner(page); // in case it painted late, before the next click
  await expect(
    page.getByRole("heading", { name: "What do you want to build?" }),
  ).toBeVisible();

  await idea.fill(prompt);
  await page.getByRole("button", { name: "Build it", exact: true }).click();

  // The idea screen gives way to the build: the step strip on top and the
  // story on the left, which opens with the idea in quotes.
  await expect(idea).toBeHidden({ timeout: 60_000 });
  await expect(page.locator('header[aria-label="Steps"]')).toBeVisible({
    timeout: 30_000,
  });
  const story = page.locator('aside[aria-label="Story"]');
  await expect(
    story.getByText(`“${prompt}”`, { exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  console.log("[e2e] build started from the idea screen");
  return story;
}
