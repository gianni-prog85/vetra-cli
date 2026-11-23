import { defineConfig, devices } from "@playwright/test";

/**
 * The Preview check of a real project, on request only (not part of
 * `pnpm run test:e2e`): starts the Studio in `VETRA_PREVIEW_PROJECT`, opens
 * the Test panel and, for each document type of the project, creates a
 * document on the Preview drive through the UI and expects its editor.
 * See ../README.md.
 */
export default defineConfig({
  testDir: ".",
  outputDir: "../test-results/preview-editors-run",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  globalSetup: "./global-setup.ts",
  globalTeardown: "./global-teardown.ts",
  timeout: 1_800_000,
  expect: { timeout: 30_000 },
  reporter: [["list"]],
  use: {
    viewport: { width: 1600, height: 1000 },
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1600, height: 1000 },
      },
    },
  ],
});
