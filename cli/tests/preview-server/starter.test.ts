import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceInstanceStatus } from "@powerhousedao/clint";

import { restartPreview, startPreview } from "../../src/preview-server/starter.js";
import { makeWorkdir } from "../spec/_fixtures.js";
import { recordedEndpoints } from "../services/run-record.js";

const DRIVE_ID = recordedEndpoints()["vetra-preview-drive-id"];

interface FakeInstance {
  workdir: string;
  status: ServiceInstanceStatus["status"];
  instanceId?: string;
  endpoints?: Record<string, string>;
}

function makeServices(args: {
  initial?: FakeInstance[];
  startImpl?: (id: string, opts: { workdir: string }) => Promise<string>;
}) {
  const list = vi.fn(() => args.initial ?? []);
  const stop = vi.fn<(id: string, instanceId?: string) => Promise<void>>(
    async () => {},
  );
  const start = vi.fn(
    args.startImpl ??
      (async () => {
        return "instance-1";
      }),
  );
  return { services: { list, start, stop } as never, list, start, stop };
}

describe("preview-server starter (the workdir is the project)", () => {
  let workdir: string;
  let cleanup: () => void;
  let projectPath: string;

  beforeEach(() => {
    ({ workdir, cleanup } = makeWorkdir());
    writeFileSync(join(workdir, "powerhouse.config.json"), "{}\n");
    projectPath = workdir;
  });
  afterEach(() => cleanup());

  it("returns unknown-project for a workdir that is no Reactor package and does NOT call services.start", async () => {
    const workspace = join(workdir, "workspace");
    mkdirSync(join(workspace, "todo"), { recursive: true });
    writeFileSync(join(workspace, "todo", "powerhouse.config.json"), "{}\n");
    const { services, start } = makeServices({});
    const result = await startPreview({ services, workdir: workspace });
    expect(result.kind).toBe("unknown-project");
    expect(start).not.toHaveBeenCalled();
  });

  it("returns already-running without starting when an instance is ready", async () => {
    const { services, start } = makeServices({
      initial: [
        { workdir: projectPath, status: "ready", instanceId: "i-1", endpoints: recordedEndpoints() },
      ],
    });
    const result = await startPreview({ services, workdir });
    expect(start).not.toHaveBeenCalled();
    expect(result).toEqual({
      kind: "already-running",
      projectPath,
      instanceId: "i-1",
      driveId: DRIVE_ID,
      status: "ready",
    });
  });

  it("returns already-running without starting when an instance is starting", async () => {
    const { services, start } = makeServices({
      initial: [{ workdir: projectPath, status: "starting", instanceId: "i-2" }],
    });
    const result = await startPreview({ services, workdir });
    expect(start).not.toHaveBeenCalled();
    expect(result.kind).toBe("already-running");
  });

  it("calls services.start when no live instance exists and returns the new instance's drive", async () => {
    const initial: FakeInstance[] = [];
    const { services, start } = makeServices({
      initial,
      // Ready: its run record is live.
      startImpl: async (_id, opts) => {
        initial.push({
          workdir: opts.workdir,
          status: "ready",
          instanceId: "new-instance",
          endpoints: recordedEndpoints(),
        });
        return "new-instance";
      },
    });
    const result = await startPreview({ services, workdir });
    expect(start).toHaveBeenCalledTimes(1);
    const args = start.mock.calls[0] as unknown as [string, { workdir: string; cwd: string }];
    expect(args[0]).toBe("reactor-project");
    expect(args[1].workdir).toBe(projectPath);
    expect(args[1].cwd).toBe(projectPath);
    expect(result).toEqual({
      kind: "started",
      projectPath,
      instanceId: "new-instance",
      driveId: DRIVE_ID,
    });
  });

  it("returns failed when services.start throws (e.g. the project run is off)", async () => {
    const { services } = makeServices({
      initial: [],
      startImpl: async () => {
        throw new Error("Reactor Project: The project run is off");
      },
    });
    expect(await startPreview({ services, workdir })).toEqual({
      kind: "failed",
      error: "Reactor Project: The project run is off",
    });
  });

  it("ignores stopped/failed instances when deciding to start", async () => {
    /* A previous instance that crashed shouldn't block a fresh start. */
    const { services, start } = makeServices({
      initial: [{ workdir: projectPath, status: "failed", instanceId: "old" }],
      startImpl: async () => "new",
    });
    const result = await startPreview({ services, workdir });
    expect(start).toHaveBeenCalledTimes(1);
    expect(result.kind).toBe("started");
  });

  it("restart stops an instance stuck starting and starts a fresh one", async () => {
    const { services, start, stop } = makeServices({
      initial: [
        { workdir: projectPath, status: "starting", instanceId: "stuck" },
        { workdir: projectPath, status: "failed", instanceId: "old" },
        { workdir: join(workdir, "other"), status: "ready", instanceId: "x" },
      ],
      startImpl: async () => "fresh",
    });
    const result = await restartPreview({ services, workdir });
    expect(stop.mock.calls).toEqual([["reactor-project", "stuck"]]);
    expect(start).toHaveBeenCalledTimes(1);
    expect(stop.mock.invocationCallOrder[0]).toBeLessThan(
      start.mock.invocationCallOrder[0],
    );
    // No ready instance listed after the start: no drive to report.
    expect(result).toEqual({
      kind: "started",
      projectPath,
      instanceId: "fresh",
    });
  });

  it("restart reports a workdir that is no project and stop failures without starting", async () => {
    const workspace = join(workdir, "workspace");
    mkdirSync(workspace);
    const unknown = makeServices({});
    expect((await restartPreview({ services: unknown.services, workdir: workspace })).kind).toBe(
      "unknown-project",
    );
    expect(unknown.stop).not.toHaveBeenCalled();

    const broken = makeServices({
      initial: [{ workdir: projectPath, status: "ready", instanceId: "i-1" }],
    });
    broken.stop.mockImplementation(async () => {
      throw new Error("cannot stop");
    });
    const result = await restartPreview({ services: broken.services, workdir });
    expect(result).toEqual({ kind: "failed", error: "cannot stop" });
    expect(broken.start).not.toHaveBeenCalled();
  });

  it("overlapping restarts share one restart", async () => {
    let release: (id: string) => void = () => {};
    const gate = new Promise<string>((resolve) => {
      release = resolve;
    });
    const { services, start, stop } = makeServices({
      initial: [{ workdir: projectPath, status: "ready", instanceId: "i-1" }],
      startImpl: () => gate,
    });
    const first = restartPreview({ services, workdir });
    const second = restartPreview({ services, workdir });
    release("fresh");
    const [a, b] = await Promise.all([first, second]);
    expect(a).toEqual(b);
    expect(a.kind).toBe("started");
    expect(start).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(1);

    // Once done, a later restart runs again.
    await restartPreview({ services, workdir });
    expect(start).toHaveBeenCalledTimes(2);
  });

  it("restart only stops running instances and tolerates one already gone", async () => {
    const instances: FakeInstance[] = [
      { workdir: projectPath, status: "ready", instanceId: "i-1" },
      { workdir: projectPath, status: "stopping", instanceId: "i-2" },
    ];
    const { services, start, stop } = makeServices({
      initial: instances,
      startImpl: async () => "fresh",
    });
    stop.mockImplementation(async () => {
      // It stopped on its own meanwhile; the manager says it isn't running.
      instances[0].status = "stopped";
      throw new Error("not running");
    });
    const result = await restartPreview({ services, workdir });
    expect(stop.mock.calls).toEqual([["reactor-project", "i-1"]]);
    expect(start).toHaveBeenCalledTimes(1);
    expect(result.kind).toBe("started");
  });
});
