/**
 * The project-host commands: in the running Cli they act on its own hosts,
 * beside one they go over its control channel, and alone a start is refused.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openControlChannel, type ControlChannel } from "@powerhousedao/host-core";
import {
  formatProjectHost,
  projectHostStart,
  projectHostStop,
  projectHostsList,
} from "../../src/commands/project-hosts/index.js";
import {
  remoteProjectHosts,
  serveProjectHosts,
  type ProjectHostsApi,
} from "../../src/project-hosts/control.js";
import type { ProjectHost } from "../../src/project-hosts/manager.js";

const host = (over: Partial<ProjectHost> = {}): ProjectHost => ({
  host: "connect",
  name: "acme-connect",
  runner: "@powerhousedao/ph-cli/runners/connect",
  startable: true,
  command: "ph run connect dev",
  state: { kind: "stopped" },
  ...over,
});

describe("project-host commands", () => {
  let workdir: string;
  let channel: ControlChannel | undefined;
  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), "vetra-hosts-"));
    writeFileSync(join(workdir, "powerhouse.config.json"), "{}");
  });
  afterEach(async () => {
    await channel?.close();
    channel = undefined;
    rmSync(workdir, { recursive: true, force: true });
  });

  const context = (extra: Record<string, unknown> = {}) =>
    ({ workdir, stdout: () => {}, config: {}, ...extra }) as never;

  it("lists nothing to preview in a project without hosts", async () => {
    const result = (await projectHostsList.execute({}, context())) as {
      text: string;
    };
    expect(result.text).toBe("This project has no hosts/ folder.");
  });

  it("refuses a start that would end with the command, with where to run", async () => {
    mkdirSync(join(workdir, "hosts", "connect"), { recursive: true });
    await expect(
      projectHostStart.execute({ host: "connect" }, context()),
    ).rejects.toThrow(
      /connect was not started: .*`ph run @powerhousedao\/vetra-cli\/studio`.*`ph run connect dev`/,
    );
  });

  it("acts through the running Cli's channel from a second terminal", async () => {
    const calls: string[] = [];
    const api: ProjectHostsApi = {
      list: async () => ({ kind: "ok", projectPath: "/p", hosts: [host()] }),
      start: async (name) => {
        calls.push(`start ${name}`);
        return {
          kind: "ok",
          host: host({
            state: {
              kind: "running",
              pid: 7,
              startedAt: "now",
              verb: "dev",
              links: [{ name: "connect", url: "http://localhost:3000/" }],
              webUrl: "http://localhost:3000/",
              startedHere: true,
            },
          }),
        };
      },
      stop: async (name) => {
        calls.push(`stop ${name}`);
        return { kind: "failed", error: "The connect host (pid 7) was not stopped." };
      },
    };
    channel = await openControlChannel();
    serveProjectHosts(channel, api);
    const serving = channel.record;

    const listed = (await projectHostsList.execute({}, context({ serving }))) as {
      text: string;
    };
    expect(listed.text).toBe("○ connect [stopped]");

    const started = (await projectHostStart.execute(
      { host: "connect" },
      context({ serving }),
    )) as { text: string };
    expect(started.text).toBe(
      "● connect [running] pid 7\n    connect: http://localhost:3000/",
    );
    await expect(
      projectHostStop.execute({ host: "connect" }, context({ serving })),
    ).rejects.toThrow("The connect host (pid 7) was not stopped.");
    expect(calls).toEqual(["start connect", "stop connect"]);

    // A wrong token reaches nothing.
    await expect(
      remoteProjectHosts({ ...serving, token: "wrong" }).list(),
    ).rejects.toThrow();
  });

  it("words a terminal host with its command and a failed one with its reason", () => {
    expect(
      formatProjectHost(host({ host: "desktop", startable: false, command: "ph run desktop" })),
    ).toBe("○ desktop [stopped] terminal: ph run desktop");
    expect(
      formatProjectHost(host({ state: { kind: "failed", reason: "Port 3000 is taken." } })),
    ).toBe("○ connect [failed] Port 3000 is taken.");
  });
});
