/**
 * reactor-project-init prefers pnpm when one resolves. On Windows pnpm is a
 * `.cmd` shim, which `execFile` alone never finds.
 */
import { describe, expect, it } from "vitest";
import { pnpmAvailable } from "../../src/commands/reactor-project/init.js";

const underPnpm = process.env.npm_config_user_agent?.startsWith("pnpm/") ?? false;

describe("pnpmAvailable", () => {
  it.runIf(underPnpm)("finds the pnpm this suite runs under", async () => {
    expect(await pnpmAvailable()).toBe(true);
  });
});
