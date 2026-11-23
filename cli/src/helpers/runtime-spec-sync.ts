/**
 * Model specifications from the runtime: one `powerhouse/document-model`
 * document in the Studio drive per document type the project's code supplies,
 * equal to what the Preview run loaded (its inspector's report).
 *
 * The runtime is the source, so the sync writes the drive only, never the
 * project: a document it keeps is listed in `.ph/vetra/runtime-specs.json`
 * (`runtime-spec-record.ts`) before it exists. Each pass is a diff
 * (`model-spec-diff.ts`): a document equal to the report gets no operation. A
 * new document is created holding the reported state. A model document the
 * agent made is adopted once the project reports its type: listed, then
 * brought to the report like any other.
 */
import type { ReactorContext } from "@powerhousedao/clint";
import { createSpecDocument } from "../commands/spec/registry.js";
import { DOCUMENT_MODEL_TYPE } from "../commands/spec/document-model.js";
import type { StudioSignatureMode } from "../auth/studio-mode.js";
import { planModelSpecSync } from "./model-spec-diff.js";
import type { PreviewModelType } from "./preview-inspector.js";
import {
  ensureFileNode,
  getDriveNodes,
  removeSpecNode,
  serialized,
  type FsSyncLogger,
  type SpecDriveClient,
} from "./spec-drive-sync.js";
import { readRuntimeSpecRecord, writeRuntimeSpecRecord } from "./runtime-spec-record.js";

/**
 * The model state a type's loaded modules report: the latest module's, with
 * every loaded version's specification.
 */
export function reportedModelState(
  type: PreviewModelType,
): Record<string, unknown> | undefined {
  const models = type.documentModels ?? [];
  const latest = models[models.length - 1];
  if (!latest) return undefined;
  const byVersion = new Map<unknown, unknown>();
  for (const model of models) {
    const specifications = Array.isArray(model.specifications) ? model.specifications : [];
    for (const spec of specifications as { version?: unknown }[]) {
      byVersion.set(spec?.version, spec);
    }
  }
  const specifications = [...byVersion.values()].sort(
    (a, b) =>
      Number((a as { version?: number }).version ?? 0) -
      Number((b as { version?: number }).version ?? 0),
  );
  return { ...latest, specifications };
}

export interface RuntimeSpecSyncResult {
  /** Document types with a document equal to the report, untouched. */
  unchanged: string[];
  created: string[];
  /** Types brought to the report with operations, and how many. */
  updated: { documentType: string; operations: number }[];
  /** Types whose document was replaced: no operations reached the report. */
  recreated: { documentType: string; reason: string }[];
  /** Types the report no longer has; their documents were removed. */
  removed: string[];
  /** Types whose document the agent made; it is the runtime's from here on. */
  adopted: string[];
  failed: { documentType: string; error: string }[];
  /** Content operations dispatched over all documents. */
  operations: number;
}

export interface RuntimeSpecSyncArgs {
  reactor: Pick<ReactorContext, "client">;
  driveId: string;
  /** The project: where the record of made documents lives. */
  workdir: string;
  /** The Preview's types, with `documentModels` (a `full` read). */
  types: readonly PreviewModelType[];
  signatureMode?: StudioSignatureMode;
  log?: FsSyncLogger;
}

interface ModelDocument {
  state?: { global?: unknown };
}

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

async function globalStateOf(
  client: SpecDriveClient,
  id: string,
): Promise<{ global: unknown } | undefined> {
  try {
    const doc = (await client.get(id)) as ModelDocument;
    return { global: doc?.state?.global };
  } catch {
    return undefined;
  }
}

/** Bring the Studio drive's model specifications to the report. */
export function syncRuntimeSpecs(args: RuntimeSpecSyncArgs): Promise<RuntimeSpecSyncResult> {
  return serialized(async () => {
    const { driveId, workdir, log } = args;
    const client = args.reactor.client as unknown as SpecDriveClient;
    const mode = args.signatureMode ?? "legacy";
    const result: RuntimeSpecSyncResult = {
      unchanged: [],
      created: [],
      updated: [],
      recreated: [],
      removed: [],
      adopted: [],
      failed: [],
      operations: 0,
    };

    const record = readRuntimeSpecRecord(workdir);
    const targets = new Map<string, { name: string; state: Record<string, unknown> }>();
    for (const type of args.types) {
      if (!type.local) continue;
      const state = reportedModelState(type);
      if (state) targets.set(type.documentType, { name: type.name, state });
    }

    // Model documents the record does not list (the agent's), by the type
    // they describe; read on demand.
    let unlisted: Map<string, string> | undefined;
    const unlistedModels = async (): Promise<Map<string, string>> => {
      if (unlisted) return unlisted;
      const owned = new Set(Object.values(record));
      const found = new Map<string, string>();
      for (const node of await getDriveNodes(client, driveId)) {
        if (node.kind !== "file" || node.documentType !== DOCUMENT_MODEL_TYPE) continue;
        if (owned.has(node.id)) continue;
        const held = await globalStateOf(client, node.id);
        const type = (held?.global as { id?: unknown } | undefined)?.id;
        if (typeof type === "string" && type && !found.has(type)) found.set(type, node.id);
      }
      unlisted = found;
      return found;
    };

    const create = async (documentType: string, name: string, state: unknown) => {
      const doc = createSpecDocument(DOCUMENT_MODEL_TYPE, {
        name,
        initialState: { global: structuredClone(state), local: {} },
        signaturePolicy: mode,
      });
      const id = doc.header.id;
      // Listed before it exists: spec-sync must never see it unlisted.
      record[documentType] = id;
      writeRuntimeSpecRecord(workdir, record);
      await client.create(doc);
      await ensureFileNode(client, driveId, { id, name, documentType: DOCUMENT_MODEL_TYPE }, log);
      // A create that did not take the state gets it as operations, once.
      const made = await globalStateOf(client, id);
      const plan = planModelSpecSync(made?.global, state);
      if (plan.kind === "actions") {
        await client.execute(id, "main", plan.actions);
        result.operations += plan.actions.length;
      } else if (plan.kind === "recreate") {
        throw new Error(`the new document does not hold the reported state: ${plan.reason}`);
      }
    };

    for (const [documentType, target] of targets) {
      try {
        let id = record[documentType];
        let held = id ? await globalStateOf(client, id) : undefined;
        if (!id || !held) {
          // The project now reports the type: its document becomes the
          // runtime's and is brought to the report below.
          const adopted = (await unlistedModels()).get(documentType);
          held = adopted ? await globalStateOf(client, adopted) : undefined;
          if (!adopted || !held) {
            await create(documentType, target.name, target.state);
            result.created.push(documentType);
            continue;
          }
          id = adopted;
          record[documentType] = id;
          writeRuntimeSpecRecord(workdir, record);
          result.adopted.push(documentType);
        }
        const plan = planModelSpecSync(held.global, target.state);
        if (plan.kind === "none") {
          await ensureFileNode(
            client,
            driveId,
            { id, name: target.name, documentType: DOCUMENT_MODEL_TYPE },
            log,
          );
          result.unchanged.push(documentType);
        } else if (plan.kind === "actions") {
          await client.execute(id, "main", plan.actions);
          result.operations += plan.actions.length;
          result.updated.push({ documentType, operations: plan.actions.length });
        } else {
          await removeSpecNode(client, driveId, id, log);
          await create(documentType, target.name, target.state);
          result.recreated.push({ documentType, reason: plan.reason });
        }
      } catch (err) {
        result.failed.push({ documentType, error: message(err) });
      }
    }

    for (const [documentType, id] of Object.entries(record)) {
      if (targets.has(documentType)) continue;
      await removeSpecNode(client, driveId, id, log);
      delete record[documentType];
      writeRuntimeSpecRecord(workdir, record);
      result.removed.push(documentType);
    }
    return result;
  });
}

/** One line for the log, or undefined when the pass changed nothing. */
export function formatRuntimeSpecSync(result: RuntimeSpecSyncResult): string | undefined {
  const parts: string[] = [];
  if (result.created.length) parts.push(`${result.created.length} created`);
  if (result.updated.length) {
    parts.push(
      `${result.updated.length} updated (${result.updated
        .map((u) => `${u.documentType}: ${u.operations}`)
        .join(", ")})`,
    );
  }
  if (result.recreated.length) {
    parts.push(
      `${result.recreated.length} replaced (${result.recreated
        .map((r) => `${r.documentType}: ${r.reason}`)
        .join("; ")})`,
    );
  }
  if (result.removed.length) parts.push(`${result.removed.length} removed`);
  if (result.adopted.length) {
    parts.push(`${result.adopted.length} adopted (${result.adopted.join(", ")})`);
  }
  if (result.failed.length) {
    parts.push(
      `${result.failed.length} failed (${result.failed
        .map((f) => `${f.documentType}: ${f.error}`)
        .join("; ")})`,
    );
  }
  if (parts.length === 0) return undefined;
  return `${parts.join(", ")}; ${result.unchanged.length} unchanged, ${result.operations} operation(s)`;
}
