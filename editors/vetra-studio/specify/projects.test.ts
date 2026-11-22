import type { FileNode } from "@powerhousedao/shared/document-drive";
import { describe, expect, it } from "vitest";
import { DOCUMENT_MODEL_TYPE, specDocuments } from "./projects.js";

function file(
  id: string,
  name: string,
  parentFolder: string | null,
  documentType = DOCUMENT_MODEL_TYPE,
): FileNode {
  return { id, name, kind: "file", documentType, parentFolder };
}

describe("specDocuments", () => {
  it("returns [] for empty input", () => {
    expect(specDocuments([])).toEqual([]);
  });

  it("lists the drive root's specs as one set", () => {
    expect(specDocuments([file("m1", "Task", null)])).toEqual([
      { id: "m1", name: "Task", documentType: DOCUMENT_MODEL_TYPE },
    ]);
  });

  it("keeps a spec filed in a folder in the same set (no project per folder)", () => {
    const docs = specDocuments([
      file("m1", "Task", null),
      file("m2", "Invoice", "old-project-folder"),
    ]);
    expect(docs.map((d) => d.id)).toEqual(["m2", "m1"]);
  });

  it("includes every builder spec type with its documentType", () => {
    const docs = specDocuments([
      file("e1", "MyEditor", null, "powerhouse/document-editor"),
      file("m1", "MyModel", null, "powerhouse/document-model"),
      file("p1", "MyProc", null, "powerhouse/processor"),
      file("s1", "MySubgraph", null, "powerhouse/subgraph"),
      file("a1", "MyApp", null, "powerhouse/app"),
    ]);
    expect(Object.fromEntries(docs.map((d) => [d.id, d.documentType]))).toEqual(
      {
        e1: "powerhouse/document-editor",
        m1: "powerhouse/document-model",
        p1: "powerhouse/processor",
        s1: "powerhouse/subgraph",
        a1: "powerhouse/app",
      },
    );
  });

  it("excludes powerhouse/brand-sheet (ideation) and powerhouse/chat-session files", () => {
    const docs = specDocuments([
      file("b1", "BrandSheet", null, "powerhouse/brand-sheet"),
      file("c1", "ChatSession", null, "powerhouse/chat-session"),
      file("m1", "RealModel", null),
    ]);
    expect(docs.map((d) => d.id)).toEqual(["m1"]);
  });

  it("orders by name, then id", () => {
    const docs = specDocuments([
      file("z-id", "Alpha", null, "powerhouse/processor"),
      file("a-id", "Alpha", null),
      file("m-id", "Beta", null, "powerhouse/subgraph"),
    ]);
    expect(docs.map((d) => d.id)).toEqual(["a-id", "z-id", "m-id"]);
  });
});
