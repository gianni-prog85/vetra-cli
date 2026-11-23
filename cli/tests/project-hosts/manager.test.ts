/**
 * The project's hosts: listed from its hosts/ folder, their state read from
 * the run records, started through spawnHost on the project's own data dir
 * and asked to stop, never ended by name.
 */
import { describe, expect, it, vi } from "vitest";
import type { RunRecord, SpawnedHost } from "@powerhousedao/host-core";
import {
  createProjectHosts,
  linksOfRecord,
  type ProjectHostsDeps,
} from "../../src/project-hosts/manager.js";

const PROJECT = "/work/project";

const RUNNERS: Record<string, { name: string; module: string }> = {
  connect: { name: "acme-connect", module: "@powerhousedao/ph-cli/runners/connect" },
  switchboard: {
    name: "acme-switchboard",
    module: "@powerhousedao/ph-cli/runners/switchboard",
  },
  dev: { name: "dev", module: "@powerhousedao/host-core/runners/compound" },
  desktop: { name: "desktop", module: "@powerhousedao/desktop/runner" },
};

function record(name: string, extra: Partial<RunRecord> = {}): RunRecord {
  return {
    version: 2,
    host: name,
    projectName: "acme",
    kind: "reactor",
    verb: "dev",
    pid: 4242,
    startedAt: "2026-11-23T10:00:00.000Z",
    ...extra,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setup(overrides: Partial<ProjectHostsDeps> = {}) {
  const live = new Map<string, RunRecord>();
  const spawnHost = vi.fn();
  const stopRun = vi.fn(async () => ({ status: "none" as const }));
  const mkdir = vi.fn();
  const hosts = createProjectHosts({
    probeHostsFolder: () => ({
      kind: "present",
      dir: `${PROJECT}/hosts`,
      hosts: Object.keys(RUNNERS),
    }),
    loadHost: async (_root, host) => {
      const found = RUNNERS[host];
      if (!found) throw new Error(`no host ${host}`);
      return { host: { name: found.name, runner: { module: found.module } } };
    },
    probeRun: (_dir, name) => {
      const found = live.get(name);
      return found ? { status: "live", record: found } : { status: "none" };
    },
    readProjectName: () => "acme",
    spawnHost: spawnHost as never,
    stopRun: stopRun as never,
    env: () => ({ PATH: "/bin", PH_WORKFLOWS_ENABLED: "0", PH_STOP_ON_STDIN: "1" }),
    now: () => 1000,
    stamp: () => 1,
    mkdir,
    ...overrides,
  });
  return { hosts, live, spawnHost, stopRun, mkdir };
}

function spawned(pid: number, rec: RunRecord): SpawnedHost & {
  end: (code: number | null) => void;
} {
  const exit = deferred<{ code: number | null; signal: null; forced: boolean }>();
  return {
    pid,
    dataDir: PROJECT,
    record: rec,
    outputs: rec.outputs,
    members: rec.members,
    exited: exit.promise,
    stop: vi.fn(async () => {
      exit.resolve({ code: 0, signal: null, forced: false });
      return exit.promise;
    }),
    end: (code) => exit.resolve({ code, signal: null, forced: false }),
  };
}

describe("project hosts", () => {
  it("lists the hosts of the project's hosts/ folder, stopped, with their commands", async () => {
    const { hosts } = setup();
    const result = await hosts.list(PROJECT);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.hosts.map((h) => [h.host, h.name, h.startable, h.command, h.state.kind])).toEqual([
      ["connect", "acme-connect", true, "ph run connect dev", "stopped"],
      ["switchboard", "acme-switchboard", true, "ph run switchboard dev", "stopped"],
      ["dev", "dev", true, "ph run dev dev", "stopped"],
      ["desktop", "desktop", false, "ph run desktop", "stopped"],
    ]);
  });

  it("says so when the project has no hosts", async () => {
    const absent = setup({ probeHostsFolder: () => ({ kind: "absent" }) });
    expect(await absent.hosts.list(PROJECT)).toEqual({
      kind: "none",
      projectPath: PROJECT,
      reason: "This project has no hosts/ folder.",
    });
    const empty = setup({
      probeHostsFolder: () => ({ kind: "empty", dir: "/work/project/hosts" }),
    });
    expect(await empty.hosts.list(PROJECT)).toMatchObject({ kind: "none" });
  });

  it("shows a host a terminal started as running, with the links of its record", async () => {
    const { hosts, live } = setup();
    live.set(
      "acme-connect",
      record("acme-connect", {
        outputs: {
          origin: "http://localhost:3000",
          endpoints: { connect: "http://localhost:3000/" },
        },
      }),
    );
    const result = await hosts.list(PROJECT);
    if (result.kind !== "ok") throw new Error("expected hosts");
    expect(result.hosts[0]!.state).toEqual({
      kind: "running",
      pid: 4242,
      startedAt: "2026-11-23T10:00:00.000Z",
      verb: "dev",
      links: [{ name: "connect", url: "http://localhost:3000/" }],
      webUrl: "http://localhost:3000/",
      startedHere: false,
    });
  });

  it("reads a compound's links from its members", () => {
    const rec = record("dev", {
      kind: "compound",
      members: {
        sb: {
          host: "switchboard",
          runnerModule: "x",
          kind: "reactor",
          verb: "dev",
          outputs: { endpoints: { graphql: "http://localhost:4001/graphql", mcp: 7 } },
        },
        web: {
          host: "connect",
          runnerModule: "x",
          kind: "reactor",
          verb: "dev",
          outputs: { endpoints: { connect: "http://localhost:3001/" } },
        },
      },
    });
    expect(linksOfRecord(rec)).toEqual({
      links: [
        { name: "sb graphql", url: "http://localhost:4001/graphql" },
        { name: "web connect", url: "http://localhost:3001/" },
      ],
      webUrl: "http://localhost:3001/",
    });
  });

  it("starts a host at dev on the project's data dir with this process's env", async () => {
    const { hosts, live, spawnHost, mkdir } = setup();
    const ready = deferred<SpawnedHost>();
    spawnHost.mockReturnValue(ready.promise);

    const { result, settled } = await hosts.start(PROJECT, "connect");
    expect(result).toMatchObject({ kind: "ok", host: { state: { kind: "starting" } } });
    expect(spawnHost).toHaveBeenCalledTimes(1);
    const options = spawnHost.mock.calls[0]![0] as Record<string, unknown>;
    expect(options).toMatchObject({
      projectRoot: PROJECT,
      dataDir: PROJECT,
      host: "connect",
      verb: "dev",
      stopOnStdin: true,
      baseEnv: { PATH: "/bin", PH_WORKFLOWS_ENABLED: "0" },
    });
    expect(options.baseEnv).not.toHaveProperty("PH_STOP_ON_STDIN");
    expect(String(options.logFile)).toMatch(/[\\/]\.ph[\\/]services[\\/]hosts[\\/]connect[\\/]connect\.1000\.log$/);

    expect(String(mkdir.mock.calls[0]![0])).toMatch(/[\\/]hosts[\\/]connect$/);

    // A second start while it starts is the same start.
    await hosts.start(PROJECT, "connect");
    expect(spawnHost).toHaveBeenCalledTimes(1);

    const rec = record("acme-connect", { pid: 77 });
    live.set("acme-connect", rec);
    ready.resolve(spawned(77, rec));
    await settled;
    const listed = await hosts.list(PROJECT);
    if (listed.kind !== "ok") throw new Error("expected hosts");
    expect(listed.hosts[0]!.state).toMatchObject({ kind: "running", pid: 77, startedHere: true });

    // And a start of a running host starts nothing.
    await hosts.start(PROJECT, "connect");
    expect(spawnHost).toHaveBeenCalledTimes(1);
  });

  it("reports a failed start with its reason, without the output tail", async () => {
    const { hosts, spawnHost } = setup();
    spawnHost.mockRejectedValue(
      new Error("Port 3000 is taken.\n--- output tail ---\nnoise"),
    );
    const { settled } = await hosts.start(PROJECT, "connect");
    await settled;
    const listed = await hosts.list(PROJECT);
    if (listed.kind !== "ok") throw new Error("expected hosts");
    expect(listed.hosts[0]!.state).toMatchObject({
      kind: "failed",
      reason: "Port 3000 is taken.",
    });
  });

  it("reports a host that ended on its own as failed", async () => {
    const { hosts, live, spawnHost } = setup();
    const rec = record("acme-connect", { pid: 77 });
    const child = spawned(77, rec);
    spawnHost.mockResolvedValue(child);
    const { settled } = await hosts.start(PROJECT, "connect");
    await settled;
    child.end(1);
    await child.exited;
    await new Promise((resolve) => setTimeout(resolve, 0));
    const listed = await hosts.list(PROJECT);
    if (listed.kind !== "ok") throw new Error("expected hosts");
    expect(listed.hosts[0]!.state).toMatchObject({
      kind: "failed",
      reason: "The connect host ended on its own (exit code 1).",
    });
  });

  it("does not start a host that runs in a terminal, and names its command", async () => {
    const { hosts, spawnHost } = setup();
    const { result } = await hosts.start(PROJECT, "desktop");
    expect(result).toEqual({
      kind: "refused",
      error:
        "The desktop host is not started from the Studio. Start it from the project folder: ph run desktop",
    });
    expect(spawnHost).not.toHaveBeenCalled();
  });

  it("refuses a host the project does not have", async () => {
    const { hosts } = setup();
    expect((await hosts.start(PROJECT, "nope")).result).toMatchObject({
      kind: "unknown-host",
    });
    expect(await hosts.stop(PROJECT, "nope")).toMatchObject({ kind: "unknown-host" });
  });

  it("stops a host it started through the host's own stop", async () => {
    const { hosts, live, spawnHost, stopRun } = setup();
    const rec = record("acme-connect", { pid: 77 });
    const child = spawned(77, rec);
    spawnHost.mockResolvedValue(child);
    const { settled } = await hosts.start(PROJECT, "connect");
    await settled;
    live.set("acme-connect", rec);

    (child.stop as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      live.delete("acme-connect");
      child.end(0);
      return child.exited;
    });
    const result = await hosts.stop(PROJECT, "connect");
    expect(child.stop).toHaveBeenCalledTimes(1);
    expect(stopRun).not.toHaveBeenCalled();
    expect(result).toMatchObject({ kind: "ok", host: { state: { kind: "stopped" } } });
  });

  it("says so when a host had to be ended after the stop timeout", async () => {
    const { hosts, live, spawnHost } = setup();
    const rec = record("acme-connect", { pid: 77 });
    const child = spawned(77, rec);
    (child.stop as ReturnType<typeof vi.fn>).mockResolvedValue({
      code: null,
      signal: null,
      forced: true,
    });
    spawnHost.mockResolvedValue(child);
    const { settled } = await hosts.start(PROJECT, "connect");
    await settled;
    expect(await hosts.stop(PROJECT, "connect")).toMatchObject({
      kind: "failed",
      error: "The connect host did not stop within 60 s and was ended.",
    });
  });

  it("asks a host a terminal started to stop, and reports one that keeps running", async () => {
    const { hosts, live, stopRun } = setup();
    live.set("acme-switchboard", record("acme-switchboard", { pid: 90 }));
    stopRun.mockImplementationOnce(async () => {
      live.delete("acme-switchboard");
      return { status: "stopped", pid: 90 } as never;
    });
    expect(await hosts.stop(PROJECT, "switchboard")).toMatchObject({
      kind: "ok",
      host: { state: { kind: "stopped" } },
    });
    expect(stopRun).toHaveBeenCalledWith(PROJECT, "acme-switchboard", expect.anything());

    live.set("acme-switchboard", record("acme-switchboard", { pid: 91 }));
    stopRun.mockResolvedValueOnce({ status: "unreachable", pid: 91 } as never);
    expect(await hosts.stop(PROJECT, "switchboard")).toMatchObject({
      kind: "failed",
      error:
        "The switchboard host (pid 91) was not stopped: it has no stop channel. Stop it where it was started.",
      host: { state: { kind: "running" } },
    });
  });

  it("aborts a start that is stopped before it is ready", async () => {
    const { hosts, spawnHost } = setup();
    spawnHost.mockImplementation(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    await hosts.start(PROJECT, "connect");
    expect(await hosts.stop(PROJECT, "connect")).toMatchObject({
      kind: "ok",
      host: { state: { kind: "stopped" } },
    });
  });

  it("stops every host it started when the Studio stops", async () => {
    const { hosts, live, spawnHost } = setup();
    const a = spawned(1, record("acme-connect", { pid: 1 }));
    const b = spawned(2, record("acme-switchboard", { pid: 2 }));
    spawnHost.mockResolvedValueOnce(b).mockResolvedValueOnce(a);
    await (await hosts.start(PROJECT, "switchboard")).settled;
    await (await hosts.start(PROJECT, "connect")).settled;
    live.set("acme-switchboard", b.record);
    live.set("acme-connect", a.record);
    await hosts.stopAll();
    expect(a.stop).toHaveBeenCalledTimes(1);
    expect(b.stop).toHaveBeenCalledTimes(1);
  });

  it("lists a host whose file does not load as failed, with the reason", async () => {
    const { hosts } = setup({
      loadHost: async () => {
        throw new Error("hosts/connect/host.js: `name` must be a non-empty string.");
      },
    });
    const listed = await hosts.list(PROJECT);
    if (listed.kind !== "ok") throw new Error("expected hosts");
    expect(listed.hosts[0]).toMatchObject({
      startable: false,
      state: { kind: "failed", reason: expect.stringContaining("`name` must be") },
    });
  });
});
