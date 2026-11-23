import { isDeepStrictEqual } from "node:util";
import type { PHDocument } from "@powerhousedao/shared/document-model";
import { defineCommand } from "../../framework.js";
import { projectRoot } from "../../helpers/project.js";
import { requireSpecDrive } from "../../helpers/embedded-drive.js";
import { planModelSpecSync } from "../../helpers/model-spec-diff.js";
import { readRuntimeSpecRecord } from "../../helpers/runtime-spec-record.js";
import {
  ensureFileNode,
  removeSpecNode,
  serialized,
} from "../../helpers/spec-drive-sync.js";
import { studioSignatureMode } from "../../auth/studio-mode.js";
import { extractSpecDocuments } from "../../generation/run.js";
import { DOCUMENT_MODEL_TYPE } from "./document-model.js";
import { listDriveSpecs, specDriveOf, type SpecDrive } from "./drive-specs.js";
import { createSpecDocument } from "./registry.js";
import { slugify } from "./_helpers.js";
import { specExtractMeta } from "./meta.js";

type Outcome = "created" | "updated" | "unchanged" | "left to inspection";

const globalOf = (doc: PHDocument): unknown =>
  (doc.state as { global?: unknown } | undefined)?.global;

const modelTypeOf = (doc: PHDocument): string | undefined => {
  const id = (globalOf(doc) as { id?: unknown } | undefined)?.id;
  return typeof id === "string" && id ? id : undefined;
};

/** A state without the ids of its list items: each extract makes new ones. */
function withoutItemIds(value: unknown, inList = false): unknown {
  if (Array.isArray(value)) return value.map((item) => withoutItemIds(item, true));
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (inList && key === "id") continue;
    out[key] = withoutItemIds(item);
  }
  return out;
}

/** The drive's document of the same type and name; a model's by its type id. */
function findExisting(held: PHDocument[], doc: PHDocument): PHDocument | undefined {
  const modelType =
    doc.header.documentType === DOCUMENT_MODEL_TYPE ? modelTypeOf(doc) : undefined;
  return (
    (modelType ? held.find((h) => modelTypeOf(h) === modelType) : undefined) ??
    held.find((h) => h.header.name === doc.header.name)
  );
}

/** Bring one extracted document into the drive. Runs inside the write queue. */
async function writeExtracted(
  drive: SpecDrive,
  doc: PHDocument,
  existing: PHDocument | undefined,
  signaturePolicy: "legacy" | "v2-required",
  log: Parameters<typeof ensureFileNode>[3],
): Promise<Outcome> {
  const { documentType, name } = doc.header;
  if (existing) {
    if (documentType === DOCUMENT_MODEL_TYPE) {
      const plan = planModelSpecSync(globalOf(existing), globalOf(doc));
      if (plan.kind === "none") return "unchanged";
      if (plan.kind === "actions") {
        await drive.client.execute(existing.header.id, "main", plan.actions);
        return "updated";
      }
    } else if (
      isDeepStrictEqual(
        withoutItemIds(globalOf(existing)),
        withoutItemIds(globalOf(doc)),
      )
    ) {
      return "unchanged";
    }
    // No operations reach the extracted state: the document is built again.
    await removeSpecNode(drive.client, drive.driveId, existing.header.id, log);
  }
  const fresh = createSpecDocument(documentType, {
    name,
    initialState: structuredClone(doc.state),
    signaturePolicy,
  });
  fresh.header.slug = existing?.header.slug || slugify(name);
  await drive.client.create(fresh);
  await ensureFileNode(
    drive.client,
    drive.driveId,
    { id: fresh.header.id, name, documentType },
    log,
  );
  return existing ? "updated" : "created";
}

export const specExtract = defineCommand({
  ...specExtractMeta,
  execute: async (input, context) => {
    const { workdir } = context;
    const embedded = await requireSpecDrive(context);
    const drive = specDriveOf(embedded);
    const base = await projectRoot(workdir);
    const docs = extractSpecDocuments(input.type, base);
    if (docs.length === 0) return { text: "(no specs extracted)" };

    const signaturePolicy = await studioSignatureMode(
      embedded.reactor,
      context.config,
      context.log,
    );
    // Model types the running project reports are kept by inspection.
    const inspected =
      input.type === "all"
        ? new Set(Object.keys(readRuntimeSpecRecord(workdir)))
        : new Set<string>();

    const lines: string[] = [];
    let failure: Error | undefined;
    await serialized(async () => {
      const held = new Map<string, PHDocument[]>();
      for (const doc of docs) {
        const { documentType, name } = doc.header;
        const label = `${documentType} "${name}"`;
        if (documentType === DOCUMENT_MODEL_TYPE && inspected.has(modelTypeOf(doc) ?? "")) {
          lines.push(`  ${label}: left to inspection`);
          continue;
        }
        try {
          if (!held.has(documentType)) {
            held.set(documentType, await listDriveSpecs(drive, { documentType }));
          }
          const outcome = await writeExtracted(
            drive,
            doc,
            findExisting(held.get(documentType) ?? [], doc),
            signaturePolicy,
            context.log,
          );
          lines.push(`  ${label}: ${outcome}`);
        } catch (err) {
          // The rest is still written; the first failure is reported after.
          const error = err instanceof Error ? err : new Error(String(err));
          failure ??= error;
          lines.push(`  ${label}: failed (${error.message})`);
        }
      }
    });

    if (failure) throw failure;
    return {
      text: `Extracted ${docs.length} spec(s) into the Studio drive:\n${lines.join("\n")}`,
    };
  },
});
