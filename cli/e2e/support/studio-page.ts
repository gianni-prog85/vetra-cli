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

/** The Studio page: the top bar, its panels and the explorer's tree. */
export function studioPage(page: Page) {
  return {
    bar: page.locator('header[aria-label="Vetra Studio"]'),
    toggle: (id: "specs" | "test" | "agent") =>
      page.locator(`header [data-panel-toggle="${id}"]`),
    specs: page.locator('section[data-panel="specs"]'),
    test: page.locator('section[data-panel="test"]'),
    agent: page.locator('section[data-panel="agent"]'),
    tree: page.locator('nav[aria-label="Specifications"]'),
  };
}

/** Talk to the agent the way a customer does: in the Agent panel, start a
 * conversation ("New session") and send the first message. Returns the
 * panel. */
export async function startConversation(page: Page, prompt: string) {
  const conversations = studioPage(page).agent;
  await expect(conversations).toBeVisible({ timeout: 60_000 });
  await dismissCookieBanner(page); // in case it painted late, before the next click
  await conversations
    .getByRole("button", { name: "New session", exact: true })
    .click();

  const box = conversations.getByPlaceholder("Type a message...");
  await expect(box).toBeEnabled({ timeout: 60_000 });
  await box.fill(prompt);
  await conversations.getByRole("button", { name: "Submit" }).click();

  // The message is in the conversation, as the customer's.
  await expect(conversations.getByText(prompt).first()).toBeVisible({
    timeout: 30_000,
  });
  console.log("[e2e] conversation started in the Agent panel");
  return conversations;
}
