import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  formatPreviewModels,
  modelTypesOf,
  previewModels,
  readInspectorReport,
  type InspectorReport,
} from "../../src/helpers/preview-inspector.js";
import { studioPath } from "../../src/helpers/studio-paths.js";
import { makeWorkdir } from "../spec/_fixtures.js";

const model = (documentType: string, name: string, version?: number) => ({
  documentType,
  name,
  ...(version === undefined ? {} : { version }),
  documentModel: { id: documentType, name, specifications: [{ version: version ?? 1 }] },
});

function report(): InspectorReport {
  return {
    version: 1,
    sequence: 2,
    writtenAt: "2026-11-23T10:00:00.000Z",
    pid: 4242,
    packages: [
      {
        name: "@powerhousedao/vetra",
        local: false,
        models: [model("powerhouse/document-model", "DocumentModel"), model("acme/todo", "Other Todo", 1)],
      },
      {
        name: "project",
        local: true,
        models: [
          model("acme/todo", "Todo v2", 2),
          model("acme/invoice", "Invoice"),
          model("acme/todo", "Todo", 1),
        ],
      },
    ],
  };
}

const services = (...instances: { workdir: string; status: string }[]) =>
  ({ list: () => instances }) as never;

describe("preview inspector report", () => {
  let workdir: string;
  let cleanup: () => void;
  beforeEach(() => {
    ({ workdir, cleanup } = makeWorkdir());
  });
  afterEach(() => cleanup());

  function write(content: unknown): void {
    const file = studioPath(workdir, "previewInspector");
    expect(file).toBe(path.join(workdir, ".ph", "vetra", "preview", "inspector.json"));
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, typeof content === "string" ? content : JSON.stringify(content));
  }

  it("reads the report; none, torn or another version is no report", () => {
    expect(readInspectorReport(workdir)).toBeUndefined();
    write("{ not json");
    expect(readInspectorReport(workdir)).toBeUndefined();
    write({ ...report(), version: 2 });
    expect(readInspectorReport(workdir)).toBeUndefined();
    write(report());
    expect(readInspectorReport(workdir)?.sequence).toBe(2);
  });

  it("groups the modules per type: every version, the project's own first", () => {
    const types = modelTypesOf(report());
    expect(types).toEqual([
      { documentType: "acme/invoice", name: "Invoice", package: "project", local: true, versions: [] },
      { documentType: "acme/todo", name: "Todo v2", package: "project", local: true, versions: [1, 2] },
      {
        documentType: "powerhouse/document-model",
        name: "DocumentModel",
        package: "@powerhousedao/vetra",
        local: false,
        versions: [],
      },
    ]);
    const full = modelTypesOf(report(), { full: true });
    expect(full[1]!.documentModels?.map((d) => d.name)).toEqual(["Todo", "Todo v2"]);
    expect(types[1]).not.toHaveProperty("documentModels");
  });

  it("is trusted only while the Preview run's instance is ready", () => {
    write(report());
    expect(previewModels(services(), workdir)).toEqual({ kind: "not-running" });
    expect(previewModels(services({ workdir, status: "stopped" }), workdir)).toEqual({
      kind: "not-running",
    });
    expect(previewModels(services({ workdir: "/elsewhere", status: "ready" }), workdir)).toEqual({
      kind: "not-running",
    });
    expect(previewModels(services({ workdir, status: "starting" }), workdir)).toEqual({
      kind: "starting",
    });
    const ready = previewModels(services({ workdir, status: "ready" }), workdir);
    expect(ready).toMatchObject({
      kind: "ready",
      sequence: 2,
      writtenAt: "2026-11-23T10:00:00.000Z",
      projectTypes: 2,
    });
  });

  it("ready with no report yet is still starting", () => {
    expect(previewModels(services({ workdir, status: "ready" }), workdir)).toEqual({
      kind: "starting",
    });
  });

  it("prints the project's types with their versions", () => {
    write(report());
    const text = formatPreviewModels(previewModels(services({ workdir, status: "ready" }), workdir));
    expect(text.split("\n")).toEqual([
      "The Preview run has loaded 2 model types of the project (report 2, 2026-11-23T10:00:00.000Z):",
      "  acme/invoice  Invoice",
      "  acme/todo  Todo v2  (v1, v2)",
      "And 1 from other packages:",
      "  powerhouse/document-model  DocumentModel  [@powerhousedao/vetra]",
    ]);
    expect(formatPreviewModels({ kind: "not-running" })).toMatch(/reactor-project-start/);
    expect(formatPreviewModels({ kind: "starting" })).toMatch(/has not reported yet/);
  });
});
