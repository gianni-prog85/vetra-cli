/**
 * A command finds the Studio of its project through the Studio's run record:
 * no variable needed, the variable still wins, and another project's Studio
 * is never picked.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { writeRunRecord } from "@powerhousedao/host-core";
import { afterEach, describe, expect, it } from "vitest";
import { formatPreviewModels, previewModels } from "../src/helpers/preview-inspector.js";
import { runningStudio, studioDriveUrl, workdirOf } from "../src/running-studio.js";
import { reactorProjectCommands } from "../src/commands/reactor-project/index.js";
import { cli } from "../src/cli.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function project(name: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "vetra-running-studio-"));
  dirs.push(dir);
  writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name }));
  writeFileSync(path.join(dir, "powerhouse.config.json"), "{}");
  return dir;
}

/** A live Studio's record: this process holds it. */
function studioRuns(dir: string, name: string, switchboardPort: number, pkg = true): void {
  const origin = `http://127.0.0.1:${switchboardPort}`;
  writeRunRecord(dir, {
    version: 2,
    host: "studio",
    ...(pkg ? { package: "@powerhousedao/vetra-cli" } : {}),
    projectName: name,
    kind: "compound",
    verb: "serve",
    pid: process.pid,
    startedAt: new Date().toISOString(),
    members: {
      switchboard: {
        host: "switchboard",
        runnerModule: "@powerhousedao/ph-cli/runners/switchboard",
        kind: "reactor",
        verb: "serve",
        outputs: {
          origin,
          endpoints: { graphql: `${origin}/graphql` },
          drives: { studio: { id: "studio-1", url: `${origin}/d/studio` } },
        },
      },
    },
  });
}

describe("workdirOf", () => {
  it("is --workdir, -w or --workdir=, else the current folder", () => {
    const cwd = path.resolve("/base");
    expect(workdirOf(["spec-list"], cwd)).toBe(cwd);
    expect(workdirOf(["--workdir", "proj", "spec-list"], cwd)).toBe(path.join(cwd, "proj"));
    expect(workdirOf(["-w", "proj", "spec-list"], cwd)).toBe(path.join(cwd, "proj"));
    expect(workdirOf(["spec-list", "--workdir=proj"], cwd)).toBe(path.join(cwd, "proj"));
    expect(workdirOf(["spec-list", "--", "--workdir", "x"], cwd)).toBe(cwd);
  });
});

describe("studioDriveUrl", () => {
  it("is the Studio drive of the project's running Studio, with no variable", () => {
    const a = project("a");
    const b = project("b");
    studioRuns(a, "a", 8091);
    studioRuns(b, "b", 8095);
    expect(studioDriveUrl(["spec-list"], {}, a)).toBe("http://127.0.0.1:8091/d/studio");
    expect(studioDriveUrl(["spec-list"], {}, b)).toBe("http://127.0.0.1:8095/d/studio");
    expect(studioDriveUrl(["-w", b, "spec-list"], {}, a)).toBe("http://127.0.0.1:8095/d/studio");
    expect(runningStudio(b, {})?.ports).toEqual({ switchboard: 8095 });
  });

  it("finds this repository's own studio host as well", () => {
    const dir = project("repo");
    studioRuns(dir, "repo", 8097, false);
    expect(studioDriveUrl(["spec-list"], {}, dir)).toBe("http://127.0.0.1:8097/d/studio");
  });

  it("follows the data folder PH_USER_DATA_DIR names", () => {
    const dir = project("a");
    const data = project("a");
    studioRuns(data, "a", 8099);
    expect(studioDriveUrl(["spec-list"], {}, dir)).toBeUndefined();
    expect(studioDriveUrl(["spec-list"], { PH_USER_DATA_DIR: data }, dir)).toBe(
      "http://127.0.0.1:8099/d/studio",
    );
  });

  it("the variable wins, and no Studio is no address", () => {
    const dir = project("a");
    expect(studioDriveUrl(["spec-list"], {}, dir)).toBeUndefined();
    studioRuns(dir, "a", 8091);
    expect(studioDriveUrl(["spec-list"], { VETRA_SWITCHBOARD_URL: "http://x/d/y" }, dir)).toBe(
      "http://x/d/y",
    );
    // The shell attaches by the variable only.
    expect(studioDriveUrl([], {}, dir)).toBeUndefined();
  });

  it("a record another project left on the folder is not this project's Studio", () => {
    const dir = project("a");
    studioRuns(dir, "someone-else", 8091);
    expect(studioDriveUrl(["spec-list"], {}, dir)).toBeUndefined();
  });
});

describe("preview-models beside a running Studio", () => {
  const report = {
    version: 1,
    sequence: 1,
    writtenAt: "2026-11-23T10:00:00.000Z",
    pid: 1,
    packages: [
      {
        name: "project",
        local: true,
        models: [{ documentType: "acme/todo", name: "Todo", documentModel: {} }],
      },
    ],
  };

  it("reads the Preview run's record when this process holds no service", () => {
    const dir = project("a");
    mkdirSync(path.join(dir, ".ph", "vetra", "preview"), { recursive: true });
    writeFileSync(
      path.join(dir, ".ph", "vetra", "preview", "inspector.json"),
      JSON.stringify(report),
    );
    const none = { list: () => [] } as never;
    // The report alone (a hard kill leaves it) is no running Preview.
    expect(previewModels(none, dir)).toEqual({ kind: "not-running" });
    writeRunRecord(dir, {
      version: 2,
      host: "preview",
      package: "@powerhousedao/vetra-cli",
      projectName: "a",
      kind: "compound",
      verb: "dev",
      pid: process.pid,
      startedAt: new Date().toISOString(),
      members: {},
    });
    expect(previewModels(none, dir)).toMatchObject({ kind: "ready", projectTypes: 1 });
    expect(formatPreviewModels(previewModels(undefined, dir))).toMatch(
      /has loaded 1 model type of the project/,
    );
  });
});

describe("reactor-project-start", () => {
  it("is the service's own command: the package defines none", () => {
    expect(reactorProjectCommands.map((c) => c.id)).not.toContain("reactor-project-start");
    const start = cli.listCommands().find((c) => c.id === "reactor-project-start");
    expect(start?.description).toBe("Start Preview run");
  });
});
