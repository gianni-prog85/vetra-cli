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

describe("preview-server resolver", () => {
  let workdir: string;
  let cleanup: () => void;
  let projectPath: string;
  const PROJECT = "demo-project";

  beforeEach(() => {
    ({ workdir, cleanup } = makeWorkdir());
    projectPath = join(workdir, PROJECT);
    mkdirSync(projectPath);
    writeFileSync(join(projectPath, "powerhouse.config.json"), "{}\n");
  });
  afterEach(() => cleanup());

  it("returns no-target when project or doc is empty", async () => {
    const services = makeServices([]);
    expect(
      await resolvePreview({ services, workdir, project: "", doc: "x" }),
    ).toEqual({ kind: "no-target" });
    expect(
      await resolvePreview({ services, workdir, project: "x", doc: "" }),
    ).toEqual({ kind: "no-target" });
  });

  it("returns unknown-project when the sub-directory isn't a reactor package", async () => {
    const services = makeServices([]);
    const result = await resolvePreview({
      services,
      workdir,
      project: "not-a-project",
      doc: "doc-1",
    });
    expect(result.kind).toBe("unknown-project");
    const unknown = result as Extract<typeof result, { kind: "unknown-project" }>;
    expect(unknown.project).toBe("not-a-project");
    expect(unknown.error).toMatch(/not found|not a Reactor package/i);
  });

  it("returns project-stopped when no ServiceManager instance matches the projectPath", async () => {
    const services = makeServices([
      { workdir: "/some/other/path", status: "ready" },
    ]);
    const result = await resolvePreview({
      services,
      workdir,
      project: PROJECT,
      doc: "doc-1",
    });
    expect(result).toEqual({
      kind: "project-stopped",
      project: PROJECT,
      projectPath,
    });
  });

  it("returns project-stopped when the matching instance has stopped/failed", async () => {
    const services = makeServices([{ workdir: projectPath, status: "stopped" }]);
    const result = await resolvePreview({
      services,
      workdir,
      project: PROJECT,
      doc: "doc-1",
    });
    expect(result.kind).toBe("project-stopped");
  });

  it("returns starting, with no drive yet, while the run record is not live", async () => {
    const services = makeServices([
      { workdir: projectPath, status: "starting" },
    ]);
    const result = await resolvePreview({
      services,
      workdir,
      project: PROJECT,
      doc: "doc-1",
    });
    expect(result).toEqual({
      kind: "starting",
      project: PROJECT,
      projectPath,
    });
  });

  it("returns starting when ready without the Connect endpoint or the preview drive", async () => {
    /* Without both, no URL can be built: the editor keeps showing the
     * starting state. */
    const services = makeServices([
      { workdir: projectPath, status: "ready", endpoints: {} },
    ]);
    const result = await resolvePreview({
      services,
      workdir,
      project: PROJECT,
      doc: "doc-1",
    });
    expect(result.kind).toBe("starting");
  });

  it("returns ready with a fully-formed URL on the recorded preview drive", async () => {
    const services = makeServices([
      { workdir: projectPath, status: "ready", endpoints: readyEndpoints() },
    ]);
    expect(driveId).toBe("vetra-preview-1a2b3c4d");
    const result = await resolvePreview({
      services,
      workdir,
      project: PROJECT,
      doc: "doc-1",
    });
    expect(result).toEqual({
      kind: "ready",
      project: PROJECT,
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
    const result = await resolvePreview({
      services,
      workdir,
      project: PROJECT,
      doc: "",
      home: true,
    });
    expect(result).toEqual({
      kind: "ready",
      project: PROJECT,
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
        project: PROJECT,
        doc: "",
        home: true,
      }),
    ).toEqual({ kind: "starting", project: PROJECT, projectPath });
    expect(
      await resolvePreview({
        services: makeServices([]),
        workdir,
        project: PROJECT,
        doc: "",
        home: true,
      }),
    ).toEqual({ kind: "project-stopped", project: PROJECT, projectPath });
  });

  it("strips a trailing slash from the Connect endpoint and encodes the doc segment", async () => {
    const services = makeServices([
      { workdir: projectPath, status: "ready", endpoints: readyEndpoints("http://localhost:3001/") },
    ]);
    const result = await resolvePreview({
      services,
      workdir,
      project: PROJECT,
      doc: "doc with spaces",
    });
    expect(result.kind).toBe("ready");
    const ready = result as Extract<typeof result, { kind: "ready" }>;
    expect(ready.url).toBe(
      `http://localhost:3001/d/${driveId}/doc%20with%20spaces?embed=1`,
    );
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
    const result = await resolvePreview({
      services,
      workdir,
      project: PROJECT,
      doc: "",
      drive: appDriveId,
    });
    expect(result).toEqual({
      kind: "ready",
      project: PROJECT,
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
    const result = await resolvePreview({
      services,
      workdir,
      project: PROJECT,
      doc: "",
      drive: "app-drive-123",
    });
    expect(result.kind).toBe("ready");
    const ready = result as Extract<typeof result, { kind: "ready" }>;
    const driveUrl = encodeURIComponent("http://localhost:4001/d/app-drive-123");
    expect(ready.url).toBe(
      `http://localhost:3001/d/app-drive-123?embed=1&driveUrl=${driveUrl}`,
    );
  });

  it("returns no-target when both doc and drive are empty", async () => {
    const services = makeServices([]);
    expect(
      await resolvePreview({ services, workdir, project: "x", doc: "", drive: undefined }),
    ).toEqual({ kind: "no-target" });
  });
});
