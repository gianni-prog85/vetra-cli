import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // jest ran this suite in band (--detectOpenHandles); many tests spawn git and
    // hit the 5 s default timeout when every core is busy, so cap the workers.
    maxWorkers: 6,
    include: ["tests/**/*.test.ts"],
    // Sample reactor projects under the package root (e.g. `workout-tracker/`)
    // ship their own scaffolded test suites; those run from inside the project,
    // not as part of vetra's suite. Skip them, plus the `.ph/` cache and the
    // playwright e2e suite.
    exclude: ["**/node_modules/**", "workout-tracker/**", ".ph/**", "e2e/**"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
    },
  },
});
