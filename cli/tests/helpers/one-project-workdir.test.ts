/**
 * The Cli works in one project, its workdir. A workspace whose project sits
 * in a subfolder is refused everywhere — the commands, the preview server's
 * start, restart, publish and package routes — and never resolved to that
 * subfolder; a workdir that is the project is acted on directly.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reactorProjectPublish } from "../../src/commands/reactor-project/publish.js";
import { reactorProjectPublishStatus } from "../../src/commands/reactor-project/publish-status.js";
import { publishProjectForDeploy } from "../../src/preview-server/publish-project.js";
import { readProjectPackage } from "../../src/preview-server/package-info.js";
import { restartPreview, startPreview } from "../../src/preview-server/starter.js";

describe("one project: the workdir", () => {
  let workdir: string;
  let sub: string;
  beforeEach(() => {
    // A workspace: the root isn't a package, one project under it.
    workdir = mkdtempSync(join(tmpdir(), "vetra-one-"));
    sub = join(workdir, "todo-list");
    mkdirSync(sub);
    writeFileSync(join(sub, "powerhouse.config.json"), "{}");
    writeFileSync(join(sub, "package.json"), '{"name":"todo-list","version":"1.0.0"}');
    mkdirSync(join(sub, "node_modules"));
  });
  afterEach(() => rmSync(workdir, { recursive: true, force: true }));

  it("the preview server's /start and /restart refuse a workdir that is no project", async () => {
    const start = vi.fn(() => Promise.resolve("i1"));
    const stop = vi.fn(() => Promise.resolve());
    const services = { list: () => [], start, stop } as never;
    await expect(startPreview({ services, workdir })).resolves.toMatchObject({
      kind: "unknown-project",
    });
    await expect(restartPreview({ services, workdir })).resolves.toMatchObject({
      kind: "unknown-project",
    });
    expect(start).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
  });

  it("starts the workdir's own run when it is the project", async () => {
    const start = vi.fn(() => Promise.resolve("i1"));
    const services = { list: () => [], start, stop: vi.fn() } as never;
    await expect(startPreview({ services, workdir: sub })).resolves.toMatchObject({
      kind: "started",
      projectPath: sub,
    });
    expect(start).toHaveBeenCalledWith("reactor-project", { workdir: sub, cwd: sub });
  });

  it("the preview server's /publish and package routes refuse a workdir that is no project", async () => {
    await expect(
      publishProjectForDeploy({ workdir, renownUrl: "https://renown.invalid" }),
    ).resolves.toMatchObject({ kind: "unknown-project" });
    await expect(readProjectPackage(workdir)).resolves.toMatchObject({
      kind: "unknown-project",
    });
    await expect(readProjectPackage(sub)).resolves.toEqual({
      kind: "ok",
      name: "todo-list",
      version: "1.0.0",
    });
  });

  it("reactor-project-publish and -publish-status refuse a workdir that is no project", async () => {
    const ctx = { workdir, config: {}, stdout: () => {} } as never;
    await expect(
      reactorProjectPublish.execute({ dryRun: true }, ctx),
    ).rejects.toThrow(/The workdir is not a Reactor Package project/);
    await expect(
      reactorProjectPublishStatus.execute({}, ctx),
    ).rejects.toThrow(/The workdir is not a Reactor Package project/);
  });
});
