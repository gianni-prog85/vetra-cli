import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { type FrameLocator, type Page, expect, test } from "@playwright/test";
import { dismissCookieBanner, studioPage } from "../support/studio-page.js";
import { localApi } from "../support/target.js";
import { readPreviewRun, shotPath, shotsDir } from "./run.js";

/**
 * The Preview check of a real project: the Test panel shows the Preview
 * Connect, and each document type of the project gets a document created on
 * the Preview drive through that Connect, whose editor must render.
 *
 * `VETRA_PREVIEW_TYPES` (document types, comma separated) narrows the types;
 * the default is every type the project's own packages supply.
 */
const PREVIEW_READY_MS = Number(process.env.VETRA_PREVIEW_READY_MS) || 480_000;
const FRAME_MS = 180_000;
const EDITOR_MS = 60_000;
/** Connect's own screens for a document it cannot show. */
const ERROR_SCREENS = [
  "No editor available",
  "Document type not supported",
  "Document version not supported",
  "Something went wrong",
];

interface ModelType {
  documentType: string;
  name: string;
  local: boolean;
  versions: number[];
}

interface EditorResult {
  documentType: string;
  label: string;
  ok: boolean;
  editor?: string;
  error?: string;
  pageErrors: string[];
  screenshot: string;
}

const run = readPreviewRun();
if (!run?.baseUrl || !run.driveId) {
  throw new Error("No Studio to check: global-setup did not record one");
}
const studioHome = `${run.baseUrl}/d/${run.driveId}`;

async function api<T>(route: string): Promise<T> {
  const base = await localApi(run!.baseUrl!);
  const res = await fetch(`${base}${route}`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`${route}: ${res.status}`);
  return (await res.json()) as T;
}

/** Waits for the Preview run; fails with the reason when it cannot start. */
async function previewReady(): Promise<void> {
  const deadline = Date.now() + PREVIEW_READY_MS;
  for (;;) {
    const status = await api<{ kind: string; reason?: string; error?: string }>(
      "/preview/status",
    ).catch(() => undefined);
    if (status?.kind === "ready") return;
    if (status?.kind === "unavailable" || status?.kind === "failed") {
      throw new Error(
        `The Preview is ${status.kind}: ${status.reason ?? status.error}`,
      );
    }
    if (Date.now() > deadline) {
      throw new Error(
        `The Preview was not ready within ${PREVIEW_READY_MS} ms`,
      );
    }
    await new Promise((r) => setTimeout(r, 3_000));
  }
}

/** The project's own document types, as the Preview run loaded them. */
async function projectTypes(): Promise<ModelType[]> {
  const deadline = Date.now() + 120_000;
  for (;;) {
    const models = await api<{ kind: string; types?: ModelType[] }>(
      "/preview/models",
    );
    if (models.kind === "ready") {
      const own = (models.types ?? []).filter((t) => t.local);
      const wanted = process.env.VETRA_PREVIEW_TYPES?.split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      if (!wanted) return own;
      const missing = wanted.filter(
        (w) => !own.some((t) => t.documentType === w),
      );
      if (missing.length > 0) {
        throw new Error(`The Preview loaded no type ${missing.join(", ")}`);
      }
      return own.filter((t) => wanted.includes(t.documentType));
    }
    if (Date.now() > deadline)
      throw new Error("The Preview reported no models");
    await new Promise((r) => setTimeout(r, 2_000));
  }
}

const slug = (documentType: string) =>
  documentType.replace(/[^a-z0-9]+/gi, "-");
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The Test frame of the Studio page's own Test tab. */
async function openTestTab(page: Page): Promise<FrameLocator> {
  await page.goto(`${studioHome}?embed=1&panel=test`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.locator("iframe[data-test-frame]")).toBeVisible({
    timeout: FRAME_MS,
  });
  const frame = page.frameLocator("iframe[data-test-frame]");
  await expect(frame.getByText("Create New Document").first()).toBeVisible({
    timeout: FRAME_MS,
  });
  await answerNamePrompt(frame);
  return frame;
}

/** A project's app may ask a first-time visitor for a name. */
async function answerNamePrompt(frame: FrameLocator): Promise<void> {
  const name = frame.getByLabel("Your name");
  if (await name.isVisible().catch(() => false)) {
    await name.fill("Preview check");
    await frame.getByRole("button", { name: "Continue" }).click();
    await expect(name).toBeHidden();
  }
}

async function createDocument(
  frame: FrameLocator,
  label: string,
  name: string,
): Promise<void> {
  await frame.getByText("Create New Document").first().click();
  const form = frame.locator('form[name="create-document-with-type"]');
  await expect(form).toBeVisible();
  await form.getByPlaceholder("Document name").fill(name);
  await frame.locator("#document-type").click();
  await frame
    .locator("#document-type + div p", {
      hasText: new RegExp(`^${escapeRegExp(label)}$`, "i"),
    })
    .first()
    .click();
  await form.getByRole("button", { name: "Create" }).click();
}

test.describe("Preview of a project", () => {
  test.beforeAll(async () => {
    test.setTimeout(PREVIEW_READY_MS + 60_000);
    await previewReady();
    mkdirSync(shotsDir(), { recursive: true });
  });

  test("the Test panel shows the Preview Connect on its drive", async ({
    page,
  }) => {
    await page.goto(studioHome, { waitUntil: "domcontentloaded" });
    await dismissCookieBanner(page);
    const studio = studioPage(page);
    await expect(studio.bar).toBeVisible({ timeout: 120_000 });
    await studio.toggle("test").click();
    const frameElement = studio.test.locator("iframe[data-test-frame]");
    await expect(frameElement).toBeVisible({ timeout: FRAME_MS });
    const resolved = await api<{ kind: string; url?: string }>(
      "/resolve?home=1",
    );
    expect(resolved.kind).toBe("ready");
    await expect(frameElement).toHaveAttribute("src", resolved.url ?? "");
    // The Preview Connect has rendered inside the frame.
    const frame = studio.test.frameLocator("iframe[data-test-frame]");
    await expect(frame.getByText("Create New Document").first()).toBeVisible({
      timeout: FRAME_MS,
    });
    await answerNamePrompt(frame);
    await page.waitForTimeout(2_000);
    await page.screenshot({ path: shotPath("test-panel-1600") });
  });

  test("each document type of the project opens its editor", async ({
    page,
  }) => {
    const types = await projectTypes();
    test.skip(types.length === 0, "the project supplies no document types");

    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(String(err)));
    const results: EditorResult[] = [];

    for (const type of types) {
      const version = Math.max(1, ...type.versions);
      const label = `${type.name} V${version}`;
      const screenshot = shotPath(slug(type.documentType));
      const result: EditorResult = {
        documentType: type.documentType,
        label,
        ok: false,
        pageErrors: [],
        screenshot,
      };
      const before = pageErrors.length;
      await test.step(type.documentType, async () => {
        try {
          const frame = await openTestTab(page);
          await createDocument(
            frame,
            label,
            `Preview check ${type.name} ${Date.now()}`,
          );
          const editor = frame.locator(
            `#document-editor-context[data-document-type="${type.documentType}"]`,
          );
          const errorScreen = frame.getByText(
            new RegExp(ERROR_SCREENS.map(escapeRegExp).join("|")),
          );
          await expect(editor.or(errorScreen).first()).toBeVisible({
            timeout: EDITOR_MS,
          });
          // Let the editor paint (or fail) before judging it.
          await page.waitForTimeout(3_000);
          if ((await errorScreen.count()) > 0) {
            result.error = (
              await errorScreen.first().locator("xpath=../..").innerText()
            )
              .replace(/\s+/g, " ")
              .slice(0, 600);
          } else {
            result.editor =
              (await editor.getAttribute("data-editor")) ?? undefined;
            const text = (await editor.innerText()).trim();
            if (text.length === 0) result.error = "the editor rendered nothing";
            else result.ok = true;
          }
        } catch (err) {
          result.error = (
            err instanceof Error ? err.message : String(err)
          ).slice(0, 600);
        }
        result.pageErrors = pageErrors.slice(before);
        await page.screenshot({ path: screenshot }).catch(() => undefined);
      });
      results.push(result);
    }

    writeFileSync(
      path.join(shotsDir(), "preview-editors.json"),
      `${JSON.stringify(results, null, 2)}\n`,
    );
    for (const r of results) {
      console.log(
        `${r.ok ? "PASS" : "FAIL"}  ${r.documentType}  ${r.label}${r.editor ? `  editor ${r.editor}` : ""}${r.error ? `  ${r.error}` : ""}${r.pageErrors.length > 0 ? `  (${r.pageErrors.length} page error(s))` : ""}`,
      );
    }
    expect(
      results.filter((r) => !r.ok).map((r) => `${r.documentType}: ${r.error}`),
    ).toEqual([]);
  });
});
