/**
 * reactor-project-start starts the project the Cli works in (the workdir) and
 * reports it, so the Studio's preview pane can show it as soon as it is up.
 * It is idempotent, and a workdir that is no project is refused.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reactorProjectStart } from "../../src/commands/reactor-project/start.js";

type Instance = { instanceId: string; workdir: string; status: string; serviceId: string };

function fakeServices(instances: Instance[]) {
  return {
    list: () => instances,
    start: (_id: string, opts: { workdir: string }) => {
      const instance = { instanceId: "i1", workdir: opts.workdir, status: "starting", serviceId: "reactor-project" };
      instances.push(instance);
      return Promise.resolve(instance.instanceId);
    },
  };
}

describe("reactor-project-start", () => {
  let workdir: string;
  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), "vetra-start-"));
    writeFileSync(join(workdir, "powerhouse.config.json"), "{}");
  });
  afterEach(() => rmSync(workdir, { recursive: true, force: true }));

  const run = (dir: string, services: ReturnType<typeof fakeServices>) =>
    reactorProjectStart.execute({}, {
      workdir: dir,
      services,
      stdout: () => {},
      config: {},
    } as never) as Promise<{ text: string; data?: { projectPath: string } }>;

  it("starts the workdir's project and says which", async () => {
    const instances: Instance[] = [];
    const result = await run(workdir, fakeServices(instances));
    expect(instances.map((i) => i.workdir)).toEqual([workdir]);
    expect(result.data).toEqual({ projectPath: workdir });
  });

  it("reports the instance already running instead of a second start", async () => {
    const instances: Instance[] = [
      { instanceId: "i0", workdir, status: "ready", serviceId: "reactor-project" },
    ];
    const result = await run(workdir, fakeServices(instances));
    expect(instances).toHaveLength(1);
    expect(result.data).toEqual({ projectPath: workdir });
  });

  it("refuses a workdir that is no project (a project in a subfolder is not picked)", async () => {
    const workspace = join(workdir, "workspace");
    mkdirSync(join(workspace, "todo"), { recursive: true });
    writeFileSync(join(workspace, "todo", "powerhouse.config.json"), "{}");
    const instances: Instance[] = [];
    await expect(run(workspace, fakeServices(instances))).rejects.toThrow(
      /The workdir is not a Reactor Package project/,
    );
    expect(instances).toHaveLength(0);
  });
});
