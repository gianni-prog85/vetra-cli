/**
 * The specification documents of the Studio drive, as the `spec-*` commands
 * read them. The drive's file nodes are the list (a document made in the
 * drive explorer may lack the `child` relationship), and each document is
 * read through the client.
 */
import type { PHDocument } from "@powerhousedao/shared/document-model";
import { requireOption, unknownValueError } from "../../helpers/cli-errors.js";
import {
  requireSpecDrive,
  type EmbeddedDrive,
} from "../../helpers/embedded-drive.js";
import {
  getDriveNodes,
  operationsByScope,
  specClient,
  type SpecDriveClient,
} from "../../helpers/spec-drive-sync.js";
import {
  listSpecTypes,
  listSpecTypesByCategory,
  type SpecCategory,
} from "./registry.js";

export interface SpecDrive {
  client: SpecDriveClient;
  driveId: string;
}

export function specDriveOf(drive: EmbeddedDrive): SpecDrive {
  return { client: specClient(drive.reactor), driveId: drive.driveId };
}

/**
 * Every specification document the drive files. Narrow with `documentType`
 * (one type) or `category` (product vs project family), in type order and by
 * name within a type. A node whose document cannot be read is left out.
 */
export async function listDriveSpecs(
  drive: SpecDrive,
  opts: { documentType?: string; category?: SpecCategory } = {},
): Promise<PHDocument[]> {
  const types = opts.documentType
    ? [opts.documentType]
    : opts.category
      ? listSpecTypesByCategory(opts.category)
      : listSpecTypes();
  const nodes = (await getDriveNodes(drive.client, drive.driveId)).filter(
    (n) => n.kind === "file" && !!n.documentType,
  );
  const out: PHDocument[] = [];
  for (const documentType of types) {
    const ofType: PHDocument[] = [];
    for (const node of nodes) {
      if (node.documentType !== documentType) continue;
      try {
        ofType.push((await drive.client.get(node.id)) as PHDocument);
      } catch {
        // Filed, but the document is gone.
      }
    }
    // By name, then id: the drive's node order is not a listing order.
    ofType.sort(
      (a, b) =>
        (a.header.name ?? "").localeCompare(b.header.name ?? "") ||
        a.header.id.localeCompare(b.header.id),
    );
    out.push(...ofType);
  }
  return out;
}

/* Match priority: name → slug → id. The first non-empty match set wins, so a
 * name that equals another document's slug is not an ambiguity. An empty slug
 * never matches. */
const MATCH_STRATEGIES: Array<
  (header: PHDocument["header"], query: string) => boolean
> = [
  (h, q) => h.name === q,
  (h, q) => !!h.slug && h.slug === q,
  (h, q) => h.id === q,
];

/**
 * Resolve a specification by display name, slug or id (in that order).
 * Throws when the name is missing, unknown or ambiguous.
 */
export async function findSpecInDrive(
  drive: SpecDrive,
  name: string,
): Promise<PHDocument> {
  const docs = await listDriveSpecs(drive);
  if (!name) {
    const names = docs
      .map((d) => d.header.name)
      .filter((n): n is string => typeof n === "string" && n.length > 0);
    requireOption(
      name,
      "name",
      names.length > 0
        ? `Available specs: ${names.join(", ")}`
        : "No specs found in this project.",
    );
  }
  for (const pred of MATCH_STRATEGIES) {
    const matches = docs.filter((d) => pred(d.header, name));
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) {
      throw new Error(
        `Multiple specs match "${name}" — name/slug/id must be unique.`,
      );
    }
  }
  /* Case-insensitive, so a slug and a name that differ in case only are
   * suggested once; the name is seen first and wins. */
  const seen = new Map<string, string>();
  for (const d of docs) {
    for (const s of [d.header.name, d.header.slug]) {
      if (typeof s !== "string" || s.length === 0) continue;
      const key = s.toLowerCase();
      if (!seen.has(key)) seen.set(key, s);
    }
  }
  throw unknownValueError({
    subject: "spec",
    value: name,
    candidates: [...seen.values()],
  });
}

/**
 * The drive and the specification `name` names in it. With no drive to reach,
 * a missing name is reported first.
 */
export async function findSpec(
  ctx: Parameters<typeof requireSpecDrive>[0],
  name: string,
): Promise<{ drive: SpecDrive; embedded: EmbeddedDrive; doc: PHDocument }> {
  let embedded: EmbeddedDrive;
  try {
    embedded = await requireSpecDrive(ctx);
  } catch (err) {
    requireOption(name, "name");
    throw err;
  }
  const drive = specDriveOf(embedded);
  return { drive, embedded, doc: await findSpecInDrive(drive, name) };
}

/** Content operations (global and local) the drive holds for a document. */
export async function contentOperationCount(
  drive: SpecDrive,
  docId: string,
): Promise<number> {
  const ops = await operationsByScope(drive.client, docId);
  return (ops.global?.length ?? 0) + (ops.local?.length ?? 0);
}
