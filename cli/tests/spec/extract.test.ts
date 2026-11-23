/**
 * `spec-extract` against a Studio drive: the documents the source describes
 * are created in the drive, and a second extract updates them in place.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { PHDocument } from "@powerhousedao/shared/document-model";
import { layoutFolderId } from "@powerhousedao/vetra/drive-layout";
import { DOCUMENT_MODEL_TYPE } from "../../src/commands/spec/document-model.js";
import { createSpecDocument } from "../../src/commands/spec/registry.js";
import { writeRuntimeSpecRecord } from "../../src/helpers/runtime-spec-record.js";
import { makeCtx, makeWorkdir, useSpecDrive } from "./_fixtures.js";

const extractSpecDocuments = vi.hoisted(() => vi.fn());
const generateFromSpec = vi.hoisted(() => vi.fn());
vi.mock("../../src/generation/run.js", () => ({
  extractSpecDocuments,
  generateFromSpec,
}));

const { specExtract } = await import("../../src/commands/spec/extract.js");
const { specGenerate } = await import("../../src/commands/spec/generate.js");

const EDITOR_TYPE = "powerhouse/document-editor";

/** An editor document as the engine extracts it: new item ids each time. */
function editor(name: string, documentTypes: string[]): PHDocument {
  return createSpecDocument(EDITOR_TYPE, {
    name,
    initialState: {
      global: {
        name,
        documentTypes: documentTypes.map((documentType, i) => ({
          id: `${name}-${i}-${Math.random()}`,
          documentType,
        })),
        status: "CONFIRMED",
      },
      local: {},
    },
  });
}

function model(id: string, name: string, description = ""): PHDocument {
  const doc = createSpecDocument(DOCUMENT_MODEL_TYPE, { name });
  const global = (doc.state as unknown as { global: Record<string, unknown> }).global;
  Object.assign(global, { id, name, description });
  return doc;
}

describe("spec-extract", () => {
  const { drive, ctx } = useSpecDrive();
  let workdir: string;
  let cleanup: () => void;

  beforeEach(() => {
    ({ workdir, cleanup } = makeWorkdir());
    extractSpecDocuments.mockReset();
  });
  afterEach(() => cleanup());

  const extract = (type: "all" | "document-model" | "editor" = "all") =>
    specExtract.execute({ type }, ctx(workdir));

  const specNodes = async () =>
    (await drive().nodes()).filter((n) => n.kind === "file");

  const globalOf = async (id: string) =>
    ((await drive().module.client.get(id)) as unknown as {
      state: { global: Record<string, unknown> };
    }).state.global;

  it("creates the extracted documents in the drive, and no specs/ folder", async () => {
    extractSpecDocuments.mockReturnValue([
      model("acme/todo", "Todo"),
      editor("Todo Editor", ["acme/todo"]),
    ]);

    const result = await extract();

    expect(result.text).toContain(`${DOCUMENT_MODEL_TYPE} "Todo": created`);
    expect(result.text).toContain(`${EDITOR_TYPE} "Todo Editor": created`);
    const nodes = await specNodes();
    expect(nodes.map((n) => n.name).sort()).toEqual(["Todo", "Todo Editor"]);
    const editorNode = nodes.find((n) => n.documentType === EDITOR_TYPE)!;
    expect(editorNode.parentFolder).toBe(
      layoutFolderId(drive().driveId, "specify/editors"),
    );
    expect((await globalOf(editorNode.id)).documentTypes).toMatchObject([
      { documentType: "acme/todo" },
    ]);
    const held = (await drive().module.client.get(editorNode.id)) as PHDocument;
    expect(held.header.slug).toBe("todo-editor");
    expect(existsSync(join(workdir, "specs"))).toBe(false);
  });

  it("leaves a document equal to the source untouched", async () => {
    extractSpecDocuments.mockImplementation(() => [
      model("acme/todo", "Todo"),
      editor("Todo Editor", ["acme/todo"]),
    ]);
    await extract();
    const before = (await specNodes()).map((n) => n.id).sort();

    const result = await extract();

    expect(result.text).toContain(`"Todo": unchanged`);
    expect(result.text).toContain(`"Todo Editor": unchanged`);
    expect((await specNodes()).map((n) => n.id).sort()).toEqual(before);
  });

  it("updates the document of the same type and name instead of adding one", async () => {
    extractSpecDocuments.mockReturnValue([editor("Todo Editor", ["acme/todo"])]);
    await extract("editor");
    extractSpecDocuments.mockReturnValue([
      editor("Todo Editor", ["acme/todo", "acme/list"]),
    ]);

    const result = await extract("editor");

    expect(result.text).toContain(`"Todo Editor": updated`);
    const nodes = await specNodes();
    expect(nodes).toHaveLength(1);
    expect((await globalOf(nodes[0].id)).documentTypes).toMatchObject([
      { documentType: "acme/todo" },
      { documentType: "acme/list" },
    ]);
  });

  it("updates a model in place, by the type it describes", async () => {
    extractSpecDocuments.mockReturnValue([model("acme/todo", "Todo")]);
    await extract("document-model");
    const [before] = await specNodes();
    extractSpecDocuments.mockReturnValue([
      model("acme/todo", "Todo", "things to do"),
    ]);

    const result = await extract("document-model");

    expect(result.text).toContain(`"Todo": updated`);
    const nodes = await specNodes();
    expect(nodes.map((n) => n.id)).toEqual([before.id]);
    expect((await globalOf(before.id)).description).toBe("things to do");
  });

  it("all: leaves a model type the running project reports to inspection", async () => {
    writeRuntimeSpecRecord(workdir, { "acme/todo": "runtime-doc" });
    extractSpecDocuments.mockReturnValue([
      model("acme/todo", "Todo"),
      model("acme/list", "List"),
    ]);

    const result = await extract();

    expect(result.text).toContain(`"Todo": left to inspection`);
    expect(result.text).toContain(`"List": created`);
    expect((await specNodes()).map((n) => n.name)).toEqual(["List"]);
  });

  it("spec-generate without a name leaves the models inspection keeps alone", async () => {
    extractSpecDocuments.mockReturnValue([
      model("acme/todo", "Todo"),
      model("acme/list", "List"),
    ]);
    await extract();
    const todo = (await specNodes()).find((n) => n.name === "Todo")!;
    writeRuntimeSpecRecord(workdir, { "acme/todo": todo.id });
    generateFromSpec.mockReset().mockResolvedValue(undefined);

    const all = await specGenerate.execute({ skipChecks: true }, ctx(workdir));

    expect(generateFromSpec).toHaveBeenCalledTimes(1);
    expect(all.text).toContain("— List");
    expect(all.text).toContain("1 model(s) kept by inspection were left alone");

    // By name it is generated all the same.
    await specGenerate.execute({ name: "Todo", skipChecks: true }, ctx(workdir));
    expect(generateFromSpec).toHaveBeenCalledTimes(2);
  });

  it("with no drive to reach, fails with where specifications live", async () => {
    extractSpecDocuments.mockReturnValue([model("acme/todo", "Todo")]);

    await expect(
      specExtract.execute({ type: "all" }, makeCtx(workdir)),
    ).rejects.toThrow(/kept in the Studio drive/);
    expect(existsSync(join(workdir, "specs"))).toBe(false);
  });
});
