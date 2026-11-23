import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const syncRuntimeSpecs = vi.fn();
vi.mock("../../src/helpers/runtime-spec-sync.js", () => ({
  syncRuntimeSpecs: (...args: unknown[]) => syncRuntimeSpecs(...args),
  formatRuntimeSpecSync: () => undefined,
}));

import { runtimeSpecSyncTrigger } from "../../src/triggers/runtime-spec-sync.js";
import { studioPath } from "../../src/helpers/studio-paths.js";

const EMPTY = {
  unchanged: [],
  created: [],
  updated: [],
  recreated: [],
  removed: [],
  skipped: [],
  failed: [],
  operations: 0,
};

describe("runtime-spec-sync trigger", () => {
  let workdir: string;
  let status: "starting" | "ready";

  beforeEach(() => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-spec-trigger-"));
    status = "ready";
    syncRuntimeSpecs.mockReset();
    syncRuntimeSpecs.mockResolvedValue(EMPTY);
  });

  afterEach(() => {
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  function report(sequence: number): void {
    const file = studioPath(workdir, "previewInspector");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        sequence,
        writtenAt: `2026-01-01T00:00:0${sequence}.000Z`,
        pid: 1,
        packages: [
          {
            name: "project",
            local: true,
            models: [
              {
                documentType: "sektar/contact",
                name: "Contact",
                version: 1,
                documentModel: { id: "sektar/contact", specifications: [] },
              },
            ],
          },
        ],
      }),
    );
  }

  function context() {
    const state = runtimeSpecSyncTrigger.state!();
    const reactor = async () => ({
      client: { getCreateSignaturePolicy: async () => "legacy" },
      driveId: "drive-1",
    });
    return {
      state,
      reactor,
      context: { workdir, config: {}, log: {} },
      commandContext: {
        services: {
          list: () => [{ workdir, status }],
        },
      },
    } as never;
  }

  it("does nothing without a report or while the Preview starts", async () => {
    const ctx = context();
    await runtimeSpecSyncTrigger.poll(ctx);
    status = "starting";
    report(1);
    await runtimeSpecSyncTrigger.poll(ctx);
    expect(syncRuntimeSpecs).not.toHaveBeenCalled();
  });

  it("syncs once per report, with the project's full models", async () => {
    const ctx = context();
    report(1);
    await runtimeSpecSyncTrigger.poll(ctx);
    await runtimeSpecSyncTrigger.poll(ctx);
    expect(syncRuntimeSpecs).toHaveBeenCalledTimes(1);
    const args = syncRuntimeSpecs.mock.calls[0][0] as {
      driveId: string;
      workdir: string;
      signatureMode: string;
      types: { documentType: string; documentModels?: unknown[] }[];
    };
    expect(args.driveId).toBe("drive-1");
    expect(args.workdir).toBe(workdir);
    expect(args.signatureMode).toBe("legacy");
    expect(args.types[0].documentType).toBe("sektar/contact");
    expect(args.types[0].documentModels).toHaveLength(1);

    report(2);
    await runtimeSpecSyncTrigger.poll(ctx);
    expect(syncRuntimeSpecs).toHaveBeenCalledTimes(2);
  });

  it("syncs when the Preview becomes ready after its report", async () => {
    const ctx = context();
    status = "starting";
    report(1);
    await runtimeSpecSyncTrigger.poll(ctx);
    status = "ready";
    await runtimeSpecSyncTrigger.poll(ctx);
    expect(syncRuntimeSpecs).toHaveBeenCalledTimes(1);
  });

  it("tries a failed pass again later, not on the next poll", async () => {
    const ctx = context();
    syncRuntimeSpecs.mockRejectedValueOnce(new Error("signer not ready"));
    report(1);
    await runtimeSpecSyncTrigger.poll(ctx);
    await runtimeSpecSyncTrigger.poll(ctx);
    expect(syncRuntimeSpecs).toHaveBeenCalledTimes(1);
    (ctx as { state: { retryAt: number } }).state.retryAt = 0;
    await runtimeSpecSyncTrigger.poll(ctx);
    expect(syncRuntimeSpecs).toHaveBeenCalledTimes(2);
  });
});
