import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { previewStatus } from "../../src/preview-server/status.js";
import { makeWorkdir } from "../spec/_fixtures.js";

interface FakeInstance {
  workdir: string;
  status: "starting" | "ready" | "stopped" | "failed";
  error?: string;
}

function makeServices(instances: FakeInstance[]) {
  return { list: () => instances } as never;
}

/** What the Preview run's preflight asks of a project. */
function install(workdir: string, options: { connect?: boolean } = {}): void {
  const scope = join(workdir, "node_modules", "@powerhousedao");
  mkdirSync(join(scope, "ph-cli", "dist"), { recursive: true });
  writeFileSync(join(scope, "ph-cli", "dist", "cli.mjs"), "");
  if (options.connect === false) return;
  mkdirSync(join(scope, "connect"), { recursive: true });
  writeFileSync(
    join(scope, "connect", "package.json"),
    JSON.stringify({ name: "@powerhousedao/connect", version: "0.0.0" }),
  );
}

describe("preview-server status", () => {
  let workdir: string;
  let cleanup: () => void;

  beforeEach(() => {
    ({ workdir, cleanup } = makeWorkdir());
    writeFileSync(join(workdir, "package.json"), "{}\n");
  });
  afterEach(() => cleanup());

  it("is unavailable, with the reason, when the workdir is no project", async () => {
    rmSync(join(workdir, "powerhouse.config.json"));
    const status = await previewStatus({ services: makeServices([]), workdir });
    expect(status.kind).toBe("unavailable");
    expect(status).toMatchObject({
      reason: expect.stringContaining("not a Reactor Package project"),
      hint: expect.stringContaining("ph init"),
    });
  });

  it("is unavailable with the failing preflight check and its hint", async () => {
    writeFileSync(join(workdir, "powerhouse.config.json"), "{}\n");
    expect(
      await previewStatus({ services: makeServices([]), workdir }),
    ).toMatchObject({
      kind: "unavailable",
      reason: expect.stringContaining("The project's ph-cli is not installed"),
      hint: "Install the project: pnpm install in its folder",
    });

    install(workdir, { connect: false });
    expect(
      await previewStatus({ services: makeServices([]), workdir }),
    ).toMatchObject({
      kind: "unavailable",
      reason: expect.stringContaining(
        "The project has no @powerhousedao/connect installed",
      ),
    });
  });

  it("follows the run: starting, ready, failed with its error, stopped", async () => {
    writeFileSync(join(workdir, "powerhouse.config.json"), "{}\n");
    install(workdir);
    const of = (instances: FakeInstance[]) =>
      previewStatus({ services: makeServices(instances), workdir });

    expect(await of([])).toEqual({ kind: "stopped" });
    expect(await of([{ workdir, status: "starting" }])).toEqual({
      kind: "starting",
    });
    expect(await of([{ workdir, status: "ready" }])).toEqual({ kind: "ready" });
    expect(
      await of([{ workdir, status: "failed", error: "Readiness timed out" }]),
    ).toEqual({ kind: "failed", error: "Readiness timed out" });
    expect(await of([{ workdir, status: "stopped" }])).toEqual({
      kind: "stopped",
    });
    // Another project's run is not this one's.
    expect(
      await of([{ workdir: join(workdir, "other"), status: "ready" }]),
    ).toEqual({
      kind: "stopped",
    });
  });

  it("a running Preview is not judged by the preflight", async () => {
    writeFileSync(join(workdir, "powerhouse.config.json"), "{}\n");
    expect(
      await previewStatus({
        services: makeServices([{ workdir, status: "ready" }]),
        workdir,
      }),
    ).toEqual({ kind: "ready" });
  });
});
