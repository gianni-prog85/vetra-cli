/**
 * Integration tests for the runtime → Studio drive model specification sync,
 * against an in-process reactor: `syncRuntimeSpecs` is given reports the way
 * the trigger gives it the Preview inspector's, and the documents' operation
 * counts are read back from the reactor.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  ReactorBuilder,
  ReactorClientBuilder,
  type InProcessReactorClientModule,
} from "@powerhousedao/reactor";
import type { ReactorContext } from "@powerhousedao/clint";
import { documentModels as vetraDocumentModels } from "@powerhousedao/vetra";
import { findLayoutFolder, layoutFolderId } from "@powerhousedao/vetra/drive-layout";
import { documentModels as driveDocumentModels } from "@powerhousedao/clint-common";
import { driveDocumentModelModule } from "@powerhousedao/shared/document-drive";
import { documentModelDocumentModelModule } from "document-model";
import { createSpecDocument } from "../../src/commands/spec/registry.js";
import { DOCUMENT_MODEL_TYPE } from "../../src/commands/spec/document-model.js";
import { modelStatesEqual } from "../../src/helpers/model-spec-diff.js";
import type { PreviewModelType } from "../../src/helpers/preview-inspector.js";
import { readRuntimeSpecRecord } from "../../src/helpers/runtime-spec-record.js";
import { syncRuntimeSpecs } from "../../src/helpers/runtime-spec-sync.js";
import {
  ensureFileNode,
  getDriveNodes,
  operationsByScope,
  type SpecDriveClient,
} from "../../src/helpers/spec-drive-sync.js";
import { specSyncTrigger } from "../../src/triggers/spec-sync.js";

type Json = Record<string, any>;

function operation(id: string, name: string): Json {
  return {
    id,
    name,
    description: `${name} description`,
    schema: `input ${name}Input { id: ID! }`,
    template: `${name} description`,
    reducer: "",
    scope: "global",
    errors: [],
    examples: [],
  };
}

function specification(version: number, prefix: string): Json {
  return {
    version,
    changeLog: [],
    state: {
      global: { schema: "type State { n: Int }", initialValue: '{"n":0}', examples: [] },
      local: { schema: "", initialValue: "", examples: [] },
    },
    modules: [
      {
        id: `${prefix}-mod`,
        name: "base",
        description: "",
        operations: [operation(`${prefix}-set`, "SET_VALUE"), operation(`${prefix}-clear`, "CLEAR")],
      },
    ],
  };
}

function modelState(documentType: string, name: string, versions: number[]): Json {
  const prefix = name.toLowerCase();
  return {
    id: documentType,
    name,
    extension: prefix,
    description: `${name} model`,
    author: { name: "Sektar", website: "https://sektar.io" },
    specifications: versions.map((v) => specification(v, prefix)),
  };
}

/** A type as the inspector reports it: one module per version, each with every version. */
function reported(state: Json, local = true): PreviewModelType {
  const versions = (state.specifications as Json[]).map((s) => s.version as number);
  return {
    documentType: state.id,
    name: state.name,
    package: local ? "project" : "@powerhousedao/other",
    local,
    versions,
    documentModels: versions.map(() => structuredClone(state)),
  };
}

describe("runtime → drive model specification sync", () => {
  let module: InProcessReactorClientModule;
  let workdir: string;
  let driveId: string;
  let reactor: Pick<ReactorContext, "client">;

  beforeEach(async () => {
    workdir = await fs.mkdtemp(path.join(os.tmpdir(), "runtime-spec-sync-it-"));
    const builder = new ReactorBuilder().withDocumentModelSources([
      driveDocumentModelModule,
      documentModelDocumentModelModule as any,
      ...(driveDocumentModels as unknown as any[]),
      ...(vetraDocumentModels as unknown as any[]),
    ]);
    module = await new ReactorClientBuilder()
      .withReactorBuilder(builder)
      .withCreateSignaturePolicy("legacy")
      .buildModule();
    const drive = await module.client.createEmpty("powerhouse/document-drive");
    driveId = drive.header.id;
    reactor = { client: module.client as ReactorContext["client"] };
  });

  afterEach(async () => {
    await module.reactor.kill().completed;
    await fs.rm(workdir, { recursive: true, force: true });
  });

  const client = () => module.client as unknown as SpecDriveClient;

  const sync = (types: PreviewModelType[]) =>
    syncRuntimeSpecs({ reactor, driveId, workdir, types });

  /** Content operations the reactor holds for a document. */
  async function contentOperations(id: string): Promise<string[]> {
    const byScope = await operationsByScope(client(), id);
    return Object.entries(byScope)
      .filter(([scope]) => scope !== "document")
      .flatMap(([, ops]) => ops.map((op) => (op.action as { type?: string }).type ?? ""));
  }

  async function globalState(id: string): Promise<unknown> {
    return ((await module.client.get(id)) as Json).state.global;
  }

  async function modelNodes(): Promise<Json[]> {
    const drive = (await module.client.get(driveId)) as Json;
    return (drive.state.global.nodes as Json[]).filter(
      (n) => n.documentType === DOCUMENT_MODEL_TYPE,
    );
  }

  const invoice = () => modelState("sektar/invoice", "Invoice", [1, 2]);
  const contact = () => modelState("sektar/contact", "Contact", [1]);

  it("creates one document per project type, equal to the report, without operations", async () => {
    const builtIn = modelState("powerhouse/document-drive", "Drive", [1]);
    const result = await sync([reported(invoice()), reported(contact()), reported(builtIn, false)]);

    expect(result.created.sort()).toEqual(["sektar/contact", "sektar/invoice"]);
    expect(result.failed).toEqual([]);
    expect(result.operations).toBe(0);

    const record = readRuntimeSpecRecord(workdir);
    expect(Object.keys(record).sort()).toEqual(["sektar/contact", "sektar/invoice"]);
    expect((await modelNodes()).map((n) => n.id).sort()).toEqual(Object.values(record).sort());
    expect((await modelNodes()).map((n) => n.name).sort()).toEqual(["Contact", "Invoice"]);

    const held = (await globalState(record["sektar/invoice"]!)) as Json;
    expect(modelStatesEqual(held, invoice())).toBe(true);
    expect((held.specifications as Json[]).map((s) => s.version)).toEqual([1, 2]);
    expect(await contentOperations(record["sektar/invoice"]!)).toEqual([]);
    expect(await contentOperations(record["sektar/contact"]!)).toEqual([]);
  });

  it("writes no operation for the same report again", async () => {
    await sync([reported(invoice()), reported(contact())]);
    const record = readRuntimeSpecRecord(workdir);
    const driveBefore = await contentOperations(driveId);

    const again = await sync([reported(invoice()), reported(contact())]);

    expect(again.unchanged.sort()).toEqual(["sektar/contact", "sektar/invoice"]);
    expect(again.created).toEqual([]);
    expect(again.updated).toEqual([]);
    expect(again.recreated).toEqual([]);
    expect(again.operations).toBe(0);
    expect(readRuntimeSpecRecord(workdir)).toEqual(record);
    expect(await contentOperations(record["sektar/invoice"]!)).toEqual([]);
    expect(await contentOperations(record["sektar/contact"]!)).toEqual([]);
    expect(await contentOperations(driveId)).toEqual(driveBefore);
  });

  it("writes only the matching operation for one operation changed in code", async () => {
    await sync([reported(invoice()), reported(contact())]);
    const record = readRuntimeSpecRecord(workdir);

    const changed = invoice();
    changed.specifications[1].modules[0].operations[0].schema =
      "input SET_VALUEInput { id: ID!, value: Int }";
    const result = await sync([reported(changed), reported(contact())]);

    expect(result.updated).toEqual([{ documentType: "sektar/invoice", operations: 1 }]);
    expect(result.unchanged).toEqual(["sektar/contact"]);
    expect(result.operations).toBe(1);
    expect(readRuntimeSpecRecord(workdir)).toEqual(record);
    expect(await contentOperations(record["sektar/invoice"]!)).toEqual(["SET_OPERATION_SCHEMA"]);
    expect(await contentOperations(record["sektar/contact"]!)).toEqual([]);
    expect(modelStatesEqual(await globalState(record["sektar/invoice"]!), changed)).toBe(true);

    const settled = await sync([reported(changed), reported(contact())]);
    expect(settled.operations).toBe(0);
    expect(await contentOperations(record["sektar/invoice"]!)).toEqual(["SET_OPERATION_SCHEMA"]);
  });

  it("adds a version the code gained", async () => {
    await sync([reported(contact())]);
    const record = readRuntimeSpecRecord(workdir);

    const next = modelState("sektar/contact", "Contact", [1, 2]);
    next.specifications[1].modules[0].operations.pop();
    const result = await sync([reported(next)]);

    expect(result.updated).toEqual([{ documentType: "sektar/contact", operations: 2 }]);
    expect(await contentOperations(record["sektar/contact"]!)).toEqual([
      "RELEASE_NEW_VERSION",
      "DELETE_OPERATION",
    ]);
    expect(modelStatesEqual(await globalState(record["sektar/contact"]!), next)).toBe(true);
  });

  it("replaces the document when an earlier version changed", async () => {
    await sync([reported(invoice())]);
    const before = readRuntimeSpecRecord(workdir)["sektar/invoice"]!;

    const changed = invoice();
    changed.specifications[0].state.global.schema = "type State { n: Float }";
    const result = await sync([reported(changed)]);

    expect(result.recreated.map((r) => r.documentType)).toEqual(["sektar/invoice"]);
    const after = readRuntimeSpecRecord(workdir)["sektar/invoice"]!;
    expect(after).not.toBe(before);
    expect((await modelNodes()).map((n) => n.id)).toEqual([after]);
    expect(modelStatesEqual(await globalState(after), changed)).toBe(true);
    expect(await contentOperations(after)).toEqual([]);
  });

  it("removes the document of a type the code no longer has", async () => {
    await sync([reported(invoice()), reported(contact())]);
    const record = readRuntimeSpecRecord(workdir);

    const result = await sync([reported(invoice())]);

    expect(result.removed).toEqual(["sektar/contact"]);
    expect(Object.keys(readRuntimeSpecRecord(workdir))).toEqual(["sektar/invoice"]);
    expect((await modelNodes()).map((n) => n.id)).toEqual([record["sektar/invoice"]]);
  });

  /** A model document as the agent's spec-create and spec-update leave it. */
  async function agentModel(state: Json): Promise<string> {
    const doc = createSpecDocument(DOCUMENT_MODEL_TYPE, {
      name: state.name,
      initialState: { global: state, local: {} },
    });
    await module.client.create(doc as never);
    await ensureFileNode(client(), driveId, {
      id: doc.header.id,
      name: state.name,
      documentType: DOCUMENT_MODEL_TYPE,
    });
    return doc.header.id;
  }

  it("adopts the agent's document of a type the project now reports", async () => {
    const agentId = await agentModel(contact());

    const result = await sync([reported(invoice()), reported(contact())]);

    expect(result.adopted).toEqual(["sektar/contact"]);
    expect(result.unchanged).toEqual(["sektar/contact"]);
    expect(result.created).toEqual(["sektar/invoice"]);
    // Both sit in the layout's folder, made once.
    const nodes = await getDriveNodes(client(), driveId);
    const folder = findLayoutFolder(nodes, "specify/document-models");
    expect(folder?.id).toBe(layoutFolderId(driveId, "specify/document-models"));
    expect(nodes.filter((n) => n.kind === "folder")).toHaveLength(2);
    expect((await modelNodes()).map((n) => n.parentFolder)).toEqual([folder?.id, folder?.id]);
    // No second document for the type: the agent's is the runtime's now.
    expect(readRuntimeSpecRecord(workdir)["sektar/contact"]).toBe(agentId);
    expect(await modelNodes()).toHaveLength(2);

    const again = await sync([reported(invoice()), reported(contact())]);
    expect(again.adopted).toEqual([]);
    expect(again.unchanged.sort()).toEqual(["sektar/contact", "sektar/invoice"]);
  });

  it("brings an adopted document to the report with operations", async () => {
    const drafted = contact();
    drafted.description = "the agent's draft";
    const agentId = await agentModel(drafted);

    const result = await sync([reported(contact())]);

    expect(result.adopted).toEqual(["sektar/contact"]);
    expect(result.updated).toEqual([{ documentType: "sektar/contact", operations: 1 }]);
    expect(result.created).toEqual([]);
    expect(readRuntimeSpecRecord(workdir)).toEqual({ "sektar/contact": agentId });
    expect(modelStatesEqual(await globalState(agentId), contact())).toBe(true);
    expect(await modelNodes()).toHaveLength(1);
  });

  it("leaves the agent's document of a type the project does not report", async () => {
    const agentId = await agentModel(contact());

    const result = await sync([reported(invoice())]);

    expect(result.adopted).toEqual([]);
    expect(readRuntimeSpecRecord(workdir)["sektar/contact"]).toBeUndefined();
    expect((await modelNodes()).map((n) => n.id)).toContain(agentId);
  });

  it("never reaches the project's specs/ through spec-sync", async () => {
    await sync([reported(invoice()), reported(contact())]);
    const logs: string[] = [];
    const ctx = {
      state: { pending: 1 },
      reactor: async () => reactor,
      context: {
        workdir,
        log: { debug: (m: string) => logs.push(m), warn: (m: string) => logs.push(m) },
      },
    };

    await specSyncTrigger.poll(ctx as never);

    const entries = await fs.readdir(workdir);
    expect(entries).toEqual([".ph"]);
    expect(logs.filter((l) => l.includes("wrote"))).toEqual([]);
  });
});
