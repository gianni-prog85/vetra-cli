import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach } from "vitest";
import { createMemoryWorkdirStore, type CommandContext } from "@powerhousedao/clint";
import { documentModels as driveDocumentModels } from "@powerhousedao/clint-common";
import {
  ReactorBuilder,
  ReactorClientBuilder,
  type InProcessReactorClientModule,
} from "@powerhousedao/reactor";
import { driveDocumentModelModule } from "@powerhousedao/shared/document-drive";
import { documentModels as vetraDocumentModels } from "@powerhousedao/vetra";
import { documentModelDocumentModelModule } from "document-model";
import { specCreate } from "../../src/commands/spec/create.js";
import { specUpdate } from "../../src/commands/spec/update.js";
import { documentModels as studioDocumentModels } from "../../src/vetra-app-models.js";
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

/** An in-process reactor holding one empty Studio drive. */
export interface SpecDriveFixture {
  module: InProcessReactorClientModule;
  driveId: string;
  /** What `context.reactor` resolves to in a command. */
  reactor: VetraCommandContext["reactor"];
  /** The drive document's nodes. */
  nodes: () => Promise<
    Array<{
      id: string;
      name: string;
      kind: string;
      parentFolder?: string | null;
      documentType?: string;
    }>
  >;
  close: () => Promise<void>;
}

export async function makeSpecDrive(): Promise<SpecDriveFixture> {
  const seen = new Set<string>();
  const sources = [
    driveDocumentModelModule,
    documentModelDocumentModelModule,
    ...driveDocumentModels,
    ...vetraDocumentModels,
    ...studioDocumentModels,
  ].filter((m) => {
    const id = (m as { documentModel: { global: { id: string } } }).documentModel
      .global.id;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  const builder = new ReactorBuilder().withDocumentModelSources(sources as never);
  const module = await new ReactorClientBuilder()
    .withReactorBuilder(builder)
    // The client is unsigned; new documents default to v2-required.
    .withCreateSignaturePolicy("legacy")
    .buildModule();
  const drive = await module.client.createEmpty("powerhouse/document-drive");
  const driveId = drive.header.id;
  await module.client.rename(driveId, "vetra");
  return {
    module,
    driveId,
    reactor: (async () => ({
      client: module.client,
      personalDriveId: driveId,
      driveId,
    })) as unknown as VetraCommandContext["reactor"],
    nodes: async () => {
      const d = (await module.client.get(driveId)) as {
        state?: { global?: { nodes?: never[] } };
      };
      return d.state?.global?.nodes ?? [];
    },
    close: async () => {
      await module.reactor.kill().completed;
    },
  };
}

/**
 * A fresh Studio drive per test of the enclosing `describe`. `ctx` is
 * {@link makeCtx} with that drive's reactor.
 */
export function useSpecDrive(): {
  drive: () => SpecDriveFixture;
  ctx: (
    workdir: string,
    overrides?: Partial<VetraCommandContext>,
  ) => VetraCommandContext;
} {
  let fixture: SpecDriveFixture;
  beforeEach(async () => {
    fixture = await makeSpecDrive();
  });
  afterEach(async () => {
    await fixture.close();
  });
  return {
    drive: () => fixture,
    ctx: (workdir, overrides = {}) =>
      makeCtx(workdir, { reactor: fixture.reactor, ...overrides }),
  };
}

/**
 * `spec-create` / `spec-update` from their command-line arguments, in this
 * process: the text as stdout, a thrown message as stderr.
 */
export async function runSpecCommand(
  ctx: VetraCommandContext,
  command: string,
  ...args: string[]
): Promise<{ stdout: string; stderr: string; code: number }> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    flags[args[i].replace(/^--/, "")] = args[i + 1];
  }
  try {
    const result =
      command === "spec-create"
        ? await specCreate.execute(
            { type: flags.type, name: flags.name, dryRun: false },
            ctx,
          )
        : await specUpdate.execute(
            { name: flags.name, actions: JSON.parse(flags.actions) },
            ctx,
          );
    return { stdout: result.text, stderr: "", code: 0 };
  } catch (err) {
    return {
      stdout: "",
      stderr: err instanceof Error ? err.message : String(err),
      code: 1,
    };
  }
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
