import { expect, test, type FrameLocator, type Page } from "@playwright/test";
import { assertNoReplayError, dismissCookieBanner, startBuild } from "../support/studio-page.js";
import {
  LOCAL_API,
  type StudioFixture,
  cliPaths,
  loadFixture,
  loadRun,
} from "../support/target.js";

/**
 * Seeded end-to-end. Against a freshly-booted, EMPTY studio (global-setup), we
 * type the prompt into the idea screen (which starts the product and its first
 * conversation), and let the replay agent drive the REAL build (project init →
 * model → editor → preview). We then assert the generated editor renders in
 * the preview pane's iframe with the preview data —
 * proving the whole loop: chat → agent → tools → reactor → studio.
 */
const fixture = loadFixture();
const run = loadRun();
const studioHome = `${run.baseUrl}/d/${run.driveId}`;
const { log } = cliPaths();

/** The project's preview is up: the Cli's local API resolves the project's
 * preview drive root to `ready` (its `ph run vetra dev` record is live). */
async function projectPreviewReady(project: string): Promise<boolean> {
  try {
    const params = new URLSearchParams({ project, home: "1" });
    const res = await fetch(`${LOCAL_API}/resolve?${params}`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return false;
    const result = (await res.json()) as { kind?: string };
    return result.kind === "ready";
  } catch {
    return false;
  }
}

/** Wait until the preview iframe is mounted (preview = ready). The preview
 * pane follows the agent: it shows the preview once the agent's
 * spec-preview-show lands. If it hasn't after the build has landed, pick the
 * editor's tab under the preview, as a customer would. The whole cold build
 * can take minutes. */
async function waitForReadyPreview(
  page: Page,
  project: string,
): Promise<FrameLocator> {
  const iframe = page.locator('main iframe[title="Preview"]');
  const firstTab = page
    .getByRole("tablist", { name: "Screens" })
    .getByRole("tab")
    .first();
  const deadline =
    Date.now() + Number(process.env.VETRA_E2E_PREVIEW_TIMEOUT_MS ?? 480_000);
  let readySeenAt: number | null = null;
  let nudged = false;
  while (Date.now() < deadline) {
    assertNoReplayError(log);
    if (await iframe.isVisible().catch(() => false)) break;
    // Once the project's preview resolves ready the build has landed.
    if (readySeenAt === null && (await projectPreviewReady(project))) {
      readySeenAt = Date.now();
      console.log(`[e2e] the preview of ${project} is ready`);
    }
    // Give following a fair chance before picking the tab by hand.
    if (
      !nudged &&
      readySeenAt !== null &&
      Date.now() - readySeenAt > 60_000 &&
      (await firstTab.isVisible().catch(() => false))
    ) {
      console.log("[e2e] preview not shown yet — picking the editor's tab");
      await firstTab.click().catch(() => {});
      nudged = true;
    }
    await page.waitForTimeout(2000);
  }
  assertNoReplayError(log);
  await expect(iframe).toBeAttached({ timeout: 5000 });
  return page.frameLocator('main iframe[title="Preview"]');
}

/** Assert the generated editor renders with the preview document's data. */
async function assertEditor(
  preview: FrameLocator,
  expected: NonNullable<StudioFixture["preview"]>,
): Promise<void> {
  // Heading = the document name. (Both the editor and the DocumentToolbar
  // render an h1 of header.name; they always agree, so .first() is safe.)
  await expect(
    preview
      .getByRole("heading", { name: expected.documentName, exact: true })
      .first(),
  ).toBeVisible({ timeout: 45_000 });

  // Interactive generated editor, not the generic viewer.
  await expect(preview.getByPlaceholder("New todo…")).toBeVisible({
    timeout: 10_000,
  });
  await expect(
    preview.getByRole("button", { name: "Add", exact: true }),
  ).toBeVisible({ timeout: 10_000 });

  // Gate on the document having synced before reading per-row state.
  await expect(preview.locator("li")).toHaveCount(expected.items.length, {
    timeout: 45_000,
  });
  // Rows are present once the count matches, so per-row checks are quick.
  for (const item of expected.items) {
    const row = preview.locator("li").filter({ hasText: item.text });
    await expect(row).toBeVisible({ timeout: 5_000 });
    const checkbox = row.getByRole("checkbox");
    if (item.completed) await expect(checkbox).toBeChecked({ timeout: 5_000 });
    else await expect(checkbox).not.toBeChecked({ timeout: 5_000 });
  }
}

/** The outer Studio Connect syncs the Studio drive, which holds the agent's
 * project specs (document-model, document-editor, …). A spec type the outer
 * Connect can't load shows Connect's missing-model banner to the customer. */
async function assertNoMissingModelBanner(page: Page): Promise<void> {
  const banner = page.getByText(/document types? couldn't load \(missing models?\)/i);
  // The sync that would trip it has landed by now; allow a short settle.
  await page.waitForTimeout(3_000);
  await expect(banner).toBeHidden();
}

test.describe("Vetra studio — seeded build", () => {
  test.skip(
    !fixture.preview,
    `fixture "${fixture.name}" has no preview: boot with VETRA_FIXTURE=todo-list`,
  );

  test("agent builds the todo-list from empty and the editor renders in the preview", async ({
    page,
  }) => {
    const expected = fixture.preview!;
    await page.goto(studioHome, { waitUntil: "domcontentloaded" });
    await dismissCookieBanner(page);

    await startBuild(page, fixture.prompt);

    const preview = await waitForReadyPreview(page, expected.project);
    await assertEditor(preview, expected);
    await assertNoMissingModelBanner(page);
  });
});
