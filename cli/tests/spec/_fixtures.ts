import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMemoryWorkdirStore, type CommandContext } from "@powerhousedao/clint";
import {
  configSchema,
  secretsSchema,
  type Config,
  type Registry,
} from "../../src/framework.js";

/**
 * Make a fresh temp workdir for one test, and a cleanup function. The dir is
 * stubbed with a `powerhouse.config.json` and `node_modules/` so spec
 * commands pass the `resolveReactorProjectPath` and installed-project checks.
 */
export function makeWorkdir(): { workdir: string; cleanup: () => void } {
  const workdir = mkdtempSync(join(tmpdir(), "vetra-test-"));
  writeFileSync(join(workdir, "powerhouse.config.json"), "{}\n");
  mkdirSync(join(workdir, "node_modules"));
  return {
    workdir,
    cleanup: () => rmSync(workdir, { recursive: true, force: true }),
  };
}

/** The context a command gets from the runtime, typed for this CLI. */
export type VetraCommandContext = CommandContext<Config, Registry>;

/** The config a command sees with nothing configured: the schemas' defaults. */
export function defaultConfig(): Config {
  return configSchema.extend(secretsSchema.shape).parse({});
}

/**
 * A full CommandContext for calling a command's `execute` directly: what the
 * runtime always provides (memory workdir store, default config, stdout,
 * runProcess), plus `overrides`. `runProcess` rejects unless overridden, so a
 * command that spawns something fails the test loudly.
 */
export function makeCtx(
  workdir: string,
  overrides: Partial<VetraCommandContext> = {},
): VetraCommandContext {
  return {
    workdir,
    workspace: createMemoryWorkdirStore(),
    stdout: () => {},
    config: defaultConfig(),
    runProcess: (command) =>
      Promise.reject(new Error(`makeCtx: no runProcess stub for "${command}"`)),
    ...overrides,
  };
}
