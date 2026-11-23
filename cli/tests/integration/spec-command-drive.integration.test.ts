/**
 * Integration tests for the `spec-*` write commands on the Studio drive.
 *
 * The drive is the only place a specification is kept. These tests build an
 * in-memory reactor, hand the command a fake `context` whose `reactor()`
 * resolves it, and assert:
 *   - create  → drive gets a file node + a gettable doc with the right state
 *   - update  → drive doc state reflects the new actions; no duplicate node
 *   - delete  → drive node + document removed
 *   - one-shot (no `folders`) → the drive `reactor()` reaches is written
 *   - no drive to reach → a clear error, nothing written
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  ReactorBuilder,
  ReactorClientBuilder,
  type InProcessReactorClientModule,
} from "@powerhousedao/reactor";
import { documentModels as vetraDocumentModels } from "@powerhousedao/vetra";
import { layoutFolderId } from "@powerhousedao/vetra/drive-layout";
import { documentModels as driveDocumentModels } from "@powerhousedao/clint-common";
import { driveDocumentModelModule } from "@powerhousedao/shared/document-drive";
import type { AppModuleDocument } from "@powerhousedao/vetra/document-models/app-module";
import { specCreate } from "../../src/commands/spec/create.js";
import { specUpdate } from "../../src/commands/spec/update.js";
import { specDelete } from "../../src/commands/spec/delete.js";

const APP_TYPE = "powerhouse/app";

interface CapturedLog {
  level: "debug" | "info" | "warn" | "error";
  msg: string;
}

function makeLog(): {
  logs: CapturedLog[];
  api: {
    debug: (m: string) => void;
    info: (m: string) => void;
    warn: (m: string) => void;
    error: (m: string) => void;
  };
} {
  const logs: CapturedLog[] = [];
  return {
    logs,
    api: {
      debug: (m) => logs.push({ level: "debug", msg: m }),
      info: (m) => logs.push({ level: "info", msg: m }),
      warn: (m) => logs.push({ level: "warn", msg: m }),
      error: (m) => logs.push({ level: "error", msg: m }),
    },
  };
}

describe("spec-* commands → embedded drive", () => {
  let module: InProcessReactorClientModule;
  let tmpDir: string;
  let driveId: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "spec-cmd-drive-it-"));
    // A project: projectRoot checks this file, spec-create an install.
    await fs.writeFile(path.join(tmpDir, "powerhouse.config.json"), "{}");
    await fs.mkdir(path.join(tmpDir, "node_modules"));

    const builder = new ReactorBuilder().withDocumentModelSources([
      driveDocumentModelModule,
      ...(driveDocumentModels as unknown as any[]),
      ...(vetraDocumentModels as unknown as any[]),
    ]);
    module = await new ReactorClientBuilder()
      .withReactorBuilder(builder)
      // The client is unsigned; 6.2.3 defaults new documents to v2-required.
      .withCreateSignaturePolicy("legacy")
      .buildModule();
    const drive = await module.client.createEmpty("powerhouse/document-drive");
    driveId = drive.header.id;
    await module.client.rename(driveId, "vetra");
  });

  afterEach(async () => {
    await module.reactor.kill().completed;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  async function driveNodes(): Promise<
    Array<{ id: string; name: string; kind: string; parentFolder?: string | null }>
  > {
    const d = (await module.client.get(driveId)) as any;
    return d?.state?.global?.nodes ?? [];
  }

  /** A context whose folders is truthy → command pushes the running reactor. */
  function runningContext(log?: ReturnType<typeof makeLog>["api"]) {
    let reactorCalls = 0;
    const ctx = {
      workdir: tmpDir,
      folders: {} as never,
      reactor: async () => {
        reactorCalls++;
        return {
          client: module.client,
          personalDriveId: driveId,
          driveId,
        };
      },
      log,
    } as never;
    return { ctx, reactorCalls: () => reactorCalls };
  }

  it("create pushes a new spec into the drive (file node + gettable doc)", async () => {
    const { logs, api: log } = makeLog();
    const { ctx } = runningContext(log);

    const res = await specCreate.execute(
      { type: APP_TYPE, name: "Drive App", dryRun: false },
      ctx,
    );
    // The id is on the saved doc — recover it from the drive's file node.
    const nodes = await driveNodes();
    const fileNode = nodes.find((n) => n.kind === "file");
    expect(fileNode).toBeDefined();
    expect(res.text).toContain("Drive App");

    const inDrive = await module.client.get<AppModuleDocument>(fileNode!.id);
    expect(inDrive.header.documentType).toBe(APP_TYPE);
    expect(inDrive.header.name).toBe("Drive App");
    expect(logs.some((l) => l.level === "error")).toBe(false);

    // A spec attaches in the layout folder of its type.
    expect(fileNode!.parentFolder).toBe(layoutFolderId(driveId, "specify/apps"));
  }, 15_000);

  it("update pushes new ops into the drive doc; re-run is idempotent", async () => {
    const { ctx } = runningContext();
    await specCreate.execute(
      { type: APP_TYPE, name: "Up App", dryRun: false },
      ctx,
    );
    const fileNode = (await driveNodes()).find((n) => n.kind === "file")!;
    const docId = fileNode.id;

    await specUpdate.execute(
      {
        name: "Up App",
        actions: [{ type: "SET_APP_NAME", input: { name: "renamed-app" } }],
        from: undefined,
      },
      ctx,
    );

    let inDrive = await module.client.get<AppModuleDocument>(docId);
    expect((inDrive.state.global as { name: string }).name).toBe("renamed-app");

    // Apply it again (SET_APP_NAME changes state.global.name, not header.name,
    // so the spec is still found by its display name "Up App"): the file node
    // is not duplicated.
    await specUpdate.execute(
      {
        name: "Up App",
        actions: [{ type: "SET_APP_NAME", input: { name: "renamed-app" } }],
        from: undefined,
      },
      ctx,
    );
    inDrive =await module.client.get<AppModuleDocument>(docId);
    expect((inDrive.state.global as { name: string }).name).toBe("renamed-app");
    expect(
      (await driveNodes()).filter((n) => n.kind === "file" && n.id === docId),
    ).toHaveLength(1);
  }, 15_000);

  it("delete removes the spec's node and document from the drive", async () => {
    const { ctx } = runningContext();
    await specCreate.execute(
      { type: APP_TYPE, name: "Del App", dryRun: false },
      ctx,
    );
    const docId = (await driveNodes()).find((n) => n.kind === "file")!.id;
    await module.client.get(docId); // present before delete

    await specDelete.execute({ name: "Del App" }, ctx);

    expect(
      (await driveNodes()).some((n) => n.kind === "file" && n.id === docId),
    ).toBe(false);
    await expect(module.client.get(docId)).rejects.toBeTruthy();
  }, 15_000);

  const specsDirExists = () =>
    fs
      .stat(path.join(tmpDir, "specs"))
      .then(() => true)
      .catch(() => false);

  it("one-shot (folders absent): writes the drive reactor() reaches, and no specs/ folder", async () => {
    const ctx = {
      workdir: tmpDir,
      folders: undefined,
      reactor: async () => ({
        client: module.client,
        personalDriveId: driveId,
        driveId,
      }),
      log: makeLog().api,
    } as never;

    await specCreate.execute(
      { type: APP_TYPE, name: "One Shot", dryRun: false },
      ctx,
    );

    expect(
      (await driveNodes()).some((n) => n.kind === "file" && n.name === "One Shot"),
    ).toBe(true);
    expect(await specsDirExists()).toBe(false);
  }, 15_000);

  it("with no drive to reach: fails with where specifications live, writes nothing", async () => {
    const ctx = {
      workdir: tmpDir,
      folders: undefined,
      reactor: async () => {
        throw new Error("vetra attaches to a switchboard: set VETRA_SWITCHBOARD_URL");
      },
      log: makeLog().api,
    } as never;

    await expect(
      specCreate.execute({ type: APP_TYPE, name: "Nowhere", dryRun: false }, ctx),
    ).rejects.toThrow(
      /Specifications are kept in the Studio drive, and none can be reached: vetra attaches to a switchboard/,
    );
    expect(await specsDirExists()).toBe(false);
    expect((await driveNodes()).some((n) => n.kind === "file")).toBe(false);
  }, 15_000);
});
