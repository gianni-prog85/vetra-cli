import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { autostartPreview } from "../../src/triggers/preview-run.js";
import { makeWorkdir } from "../spec/_fixtures.js";

describe("the Preview run starts with the Cli", () => {
  let workdir: string;
  let cleanup: () => void;
  beforeEach(() => {
    // makeWorkdir writes the project's powerhouse.config.json.
    ({ workdir, cleanup } = makeWorkdir());
  });
  afterEach(() => cleanup());

  it("starts the reactor-project service in the project", async () => {
    const start = vi.fn(async () => "i-1");
    await autostartPreview({ services: { list: () => [], start } as never, workdir });
    expect(start).toHaveBeenCalledWith("reactor-project", { workdir, cwd: workdir });
  });

  it("leaves a run that is already up alone", async () => {
    const start = vi.fn(async () => "i-2");
    const services = { list: () => [{ workdir, status: "starting", instanceId: "i-1" }], start };
    await autostartPreview({ services: services as never, workdir });
    expect(start).not.toHaveBeenCalled();
  });

  it("a workdir that is no project starts nothing", async () => {
    const start = vi.fn(async () => "i-1");
    const info = vi.fn();
    const empty = join(workdir, "empty");
    mkdirSync(empty);
    await autostartPreview({
      services: { list: () => [], start } as never,
      workdir: empty,
      log: { info },
    });
    expect(start).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith(expect.stringMatching(/no Preview run/));
  });

  it("a failed start is logged, never thrown", async () => {
    const warn = vi.fn();
    const start = vi.fn(async () => {
      throw new Error("ph-cli is not installed");
    });
    await autostartPreview({
      services: { list: () => [], start } as never,
      workdir,
      log: { warn },
    });
    expect(warn).toHaveBeenCalledWith(
      "[preview-run] the Preview run did not start: ph-cli is not installed",
    );
  });
});
