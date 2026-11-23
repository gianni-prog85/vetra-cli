import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rmSync } from "node:fs";
import { join } from "node:path";

import { startPreviewServer } from "../../src/preview-server/server.js";
import type { ProjectHost, ProjectHosts } from "../../src/project-hosts/manager.js";
import { makeWorkdir } from "../spec/_fixtures.js";

const connect: ProjectHost = {
  host: "connect",
  name: "acme-connect",
  runner: "@powerhousedao/ph-cli/runners/connect",
  startable: true,
  command: "ph run connect dev",
  state: { kind: "stopped" },
};

describe("the project hosts routes", () => {
  let workdir: string;
  let cleanup: () => void;
  let server: Awaited<ReturnType<typeof startPreviewServer>>;
  let hosts: { [K in keyof ProjectHosts]: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    ({ workdir, cleanup } = makeWorkdir());
    hosts = {
      list: vi.fn(async (projectPath: string) => ({
        kind: "ok",
        projectPath,
        hosts: [connect],
      })),
      start: vi.fn(async () => ({
        result: { kind: "ok", host: { ...connect, state: { kind: "starting" } } },
        // Never settles: the route does not wait for it.
        settled: new Promise<void>(() => {}),
      })),
      stop: vi.fn(async () => ({ kind: "ok", host: connect })),
      stopAll: vi.fn(async () => {}),
    };
    server = await startPreviewServer({
      services: { list: () => [] } as never,
      subscribe: () => {},
      workdir,
      renownUrl: "http://renown.invalid",
      port: 0,
      versions: { vetraCli: "test", ph: "test" },
      authorizeRequest: async () => ({ ok: true }) as never,
      projectHosts: hosts as unknown as ProjectHosts,
    });
  });

  afterEach(async () => {
    await server.stop();
    cleanup();
  });

  const call = (method: string, path: string) =>
    fetch(`http://127.0.0.1:${server.port}${path}`, { method });

  it("GET /hosts lists the hosts of the project the Cli works in", async () => {
    const res = await call("GET", "/hosts");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      kind: "ok",
      projectPath: workdir,
      hosts: [connect],
    });
  });

  it("POST /hosts/start answers 202 once the start is under way", async () => {
    const res = await call("POST", "/hosts/start?host=connect");
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({
      kind: "ok",
      host: { state: { kind: "starting" } },
    });
    expect(hosts.start).toHaveBeenCalledWith(workdir, "connect");
  });

  it("POST /hosts/stop answers when the host has stopped", async () => {
    const res = await call("POST", "/hosts/stop?host=connect");
    expect(res.status).toBe(200);
    expect(hosts.stop).toHaveBeenCalledWith(workdir, "connect");
  });

  it("maps a refusal, an unknown host and a failure to their status", async () => {
    hosts.start.mockResolvedValueOnce({
      result: { kind: "refused", error: "not from the Studio" },
      settled: Promise.resolve(),
    });
    expect((await call("POST", "/hosts/start?host=desktop")).status).toBe(409);
    hosts.stop.mockResolvedValueOnce({ kind: "unknown-host", error: "no host" });
    expect((await call("POST", "/hosts/stop?host=nope")).status).toBe(404);
    hosts.stop.mockResolvedValueOnce({ kind: "failed", error: "still runs" });
    const failed = await call("POST", "/hosts/stop?host=connect");
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ kind: "failed", error: "still runs" });
  });

  it("asks for the host's name", async () => {
    expect((await call("POST", "/hosts/start")).status).toBe(400);
    expect(hosts.start).not.toHaveBeenCalled();
  });

  it("answers 404 when the workdir is no project", async () => {
    rmSync(join(workdir, "powerhouse.config.json"));
    const res = await call("GET", "/hosts");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      kind: "unknown-project",
      error: "unknown project",
    });
  });
});
