import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolvePreview } from "../../src/preview-server/resolver.js";
import { makeWorkdir } from "../spec/_fixtures.js";
import { recordedEndpoints } from "../services/run-record.js";

/** A ready instance's endpoints, from the recorded run; the project's
 * Connect at `connect`. */
function readyEndpoints(connect = "http://localhost:3001"): Record<string, string> {
  return { ...recordedEndpoints(), "vetra-studio": connect };
}

const driveId = recordedEndpoints()["vetra-preview-drive-id"];

interface FakeInstance {
  workdir: string;
  status: "starting" | "ready" | "stopped" | "failed";
  endpoints?: Record<string, string>;
  instanceId?: string;
}

function makeServices(instances: FakeInstance[]) {
  return { list: () => instances } as never;
}

describe("preview-server resolver (the workdir is the project)", () => {
  let workdir: string;
  let cleanup: () => void;
  let projectPath: string;

  beforeEach(() => {
    ({ workdir, cleanup } = makeWorkdir());
    writeFileSync(join(workdir, "powerhouse.config.json"), "{}\n");
    projectPath = workdir;
  });
  afterEach(() => cleanup());

  it("returns no-target without a doc, drive or home", async () => {
    const services = makeServices([]);
    expect(await resolvePreview({ services, workdir, doc: "" })).toEqual({
      kind: "no-target",
    });
    expect(
      await resolvePreview({ services, workdir, doc: "", drive: undefined }),
    ).toEqual({ kind: "no-target" });
  });

  it("returns unknown-project when the workdir is no Reactor package (a project in a subfolder is not picked)", async () => {
    const workspace = join(workdir, "workspace");
    mkdirSync(join(workspace, "todo"), { recursive: true });
    writeFileSync(join(workspace, "todo", "powerhouse.config.json"), "{}\n");
    const result = await resolvePreview({
      services: makeServices([]),
      workdir: workspace,
      doc: "doc-1",
    });
    expect(result.kind).toBe("unknown-project");
    const unknown = result as Extract<typeof result, { kind: "unknown-project" }>;
    expect(unknown.error).toMatch(/not a Reactor Package project/);
  });

  it("returns project-stopped when no instance runs the project", async () => {
    const services = makeServices([{ workdir: "/some/other/path", status: "ready" }]);
    expect(
      await resolvePreview({ services, workdir, doc: "doc-1" }),
    ).toEqual({ kind: "project-stopped", projectPath });
  });

  it("returns project-stopped when the project's instance has stopped/failed", async () => {
    const services = makeServices([{ workdir: projectPath, status: "stopped" }]);
    const result = await resolvePreview({ services, workdir, doc: "doc-1" });
    expect(result.kind).toBe("project-stopped");
  });

  it("returns starting, with no drive yet, while the run record is not live", async () => {
    const services = makeServices([{ workdir: projectPath, status: "starting" }]);
    expect(await resolvePreview({ services, workdir, doc: "doc-1" })).toEqual({
      kind: "starting",
      projectPath,
    });
  });

  it("returns starting when ready without the Connect endpoint or the preview drive", async () => {
    /* Without both, no URL can be built: the editor keeps showing the
     * starting state. */
    const services = makeServices([{ workdir: projectPath, status: "ready", endpoints: {} }]);
    const result = await resolvePreview({ services, workdir, doc: "doc-1" });
    expect(result.kind).toBe("starting");
  });

  it("returns ready with a fully-formed URL on the recorded preview drive", async () => {
    const services = makeServices([
      { workdir: projectPath, status: "ready", endpoints: readyEndpoints() },
    ]);
    expect(driveId).toBe("vetra-preview-1a2b3c4d");
    expect(await resolvePreview({ services, workdir, doc: "doc-1" })).toEqual({
      kind: "ready",
      projectPath,
      driveId,
      documentId: "doc-1",
      url: `http://localhost:3001/d/${driveId}/doc-1?embed=1`,
    });
  });

  it("home: the preview drive's root once the project is up", async () => {
    const services = makeServices([
      { workdir: projectPath, status: "ready", endpoints: readyEndpoints("http://localhost:3001/") },
    ]);
    expect(await resolvePreview({ services, workdir, doc: "", home: true })).toEqual({
      kind: "ready",
      projectPath,
      driveId,
      documentId: driveId,
      url: `http://localhost:3001/d/${driveId}?embed=1`,
    });
  });

  it("home: starting / project-stopped while the project isn't up", async () => {
    expect(
      await resolvePreview({
        services: makeServices([{ workdir: projectPath, status: "starting" }]),
        workdir,
        doc: "",
        home: true,
      }),
    ).toEqual({ kind: "starting", projectPath });
    expect(
      await resolvePreview({
        services: makeServices([]),
        workdir,
        doc: "",
        home: true,
      }),
    ).toEqual({ kind: "project-stopped", projectPath });
  });

  it("strips a trailing slash from the Connect endpoint and encodes the doc segment", async () => {
    const services = makeServices([
      { workdir: projectPath, status: "ready", endpoints: readyEndpoints("http://localhost:3001/") },
    ]);
    const result = await resolvePreview({ services, workdir, doc: "doc with spaces" });
    expect(result.kind).toBe("ready");
    const ready = result as Extract<typeof result, { kind: "ready" }>;
    expect(ready.url).toBe(`http://localhost:3001/d/${driveId}/doc%20with%20spaces?embed=1`);
  });

  it("returns a drive-root URL when drive param is set", async () => {
    const services = makeServices([
      {
        workdir: projectPath,
        status: "ready",
        endpoints: {
          "vetra-studio": "http://localhost:3001",
          "vetra-preview-drive-id": driveId,
        },
      },
    ]);
    const appDriveId = "app-drive-123";
    expect(await resolvePreview({ services, workdir, doc: "", drive: appDriveId })).toEqual({
      kind: "ready",
      projectPath,
      driveId: appDriveId,
      documentId: appDriveId,
      url: `http://localhost:3001/d/${appDriveId}?embed=1`,
    });
  });

  it("appends the project switchboard's drive URL for an app drive", async () => {
    const services = makeServices([
      {
        workdir: projectPath,
        status: "ready",
        endpoints: {
          "vetra-studio": "http://localhost:3001",
          "vetra-switchboard": "http://localhost:4001/graphql",
        },
      },
    ]);
    const result = await resolvePreview({ services, workdir, doc: "", drive: "app-drive-123" });
    expect(result.kind).toBe("ready");
    const ready = result as Extract<typeof result, { kind: "ready" }>;
    const driveUrl = encodeURIComponent("http://localhost:4001/d/app-drive-123");
    expect(ready.url).toBe(`http://localhost:3001/d/app-drive-123?embed=1&driveUrl=${driveUrl}`);
  });
});
