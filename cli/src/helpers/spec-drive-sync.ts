/**
 * Studio-drive primitives of the `spec-*` commands and the runtime sync.
 *
 * Every spec doc is an ADD_FILE node (`drive.state.global.nodes`, what Vetra
 * Studio reads) in the folder the package drive layout gives its type, plus a
 * `child` relationship. Attaching checks existing nodes and skips when
 * present. The calls are ones both clients have (the in-process client and
 * the switchboard's GraphQL client).
 */
import type { ReactorContext } from "@powerhousedao/clint";
import {
  ensurePackageDrive,
  findLayoutFolder,
  folderForDocumentType,
  missingLayoutFolders,
  type PackageDriveReport,
} from "@powerhousedao/vetra/drive-layout";

export interface FsSyncLogger {
  debug?: (msg: string) => void;
  info?: (msg: string) => void;
  warn?: (msg: string) => void;
  error?: (msg: string) => void;
}

/** Minimal node shape from the drive document's `state.global.nodes`. */
export interface DriveNode {
  id: string;
  name: string;
  kind: string;
  parentFolder?: string | null;
  documentType?: string;
}

interface OperationLike {
  index?: number;
  action?: { id?: string; scope?: string };
}

interface OperationsPage {
  results: OperationLike[];
  next?: () => Promise<unknown>;
}

/** The client calls the sync makes. */
export interface SpecDriveClient {
  get(id: string): Promise<unknown>;
  create(document: unknown): Promise<unknown>;
  execute(id: string, branch: string, actions: unknown[]): Promise<unknown>;
  getOperations(id: string): Promise<OperationsPage>;
  addRelationship(source: string, target: string, type: string): Promise<unknown>;
  removeRelationship(source: string, target: string, type: string): Promise<unknown>;
  deleteDocument(id: string): Promise<unknown>;
}

export function specClient(reactor: Pick<ReactorContext, "client">): SpecDriveClient {
  return reactor.client as unknown as SpecDriveClient;
}

// One drive write at a time in this process: two attaches of a new document
// would each add its node.
let syncQueue: Promise<unknown> = Promise.resolve();
export function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = syncQueue.then(fn);
  syncQueue = run.catch(() => undefined);
  return run;
}

/** All operations of a document, grouped by scope. */
export async function operationsByScope(
  client: Pick<SpecDriveClient, "getOperations">,
  docId: string,
): Promise<Record<string, OperationLike[]>> {
  const byScope: Record<string, OperationLike[]> = {};
  let page: OperationsPage | undefined = await client.getOperations(docId);
  while (page) {
    for (const op of page.results) {
      const scope = op.action?.scope ?? "global";
      (byScope[scope] ??= []).push(op);
    }
    page = page.next ? ((await page.next()) as OperationsPage) : undefined;
  }
  for (const ops of Object.values(byScope)) {
    ops.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  }
  return byScope;
}

export interface PushedSpec {
  id: string;
  name: string;
  documentType: string;
}

interface DriveActions {
  addFolder: (input: { id: string; name: string; parentFolder: string | null }) => unknown;
  addFile: (input: {
    id: string;
    name: string;
    documentType: string;
    parentFolder: string | null;
  }) => unknown;
  deleteNode: (input: { id: string }) => unknown;
}

let _driveActions: DriveActions | null = null;

/**
 * Lazy-load drive action creators from `@powerhousedao/shared`. Kept lazy so
 * importing this module doesn't pull in the full `@powerhousedao/shared` tree.
 */
async function getDriveActions(): Promise<DriveActions> {
  if (!_driveActions) {
    const mod = (await import(
      "@powerhousedao/shared/document-drive"
    )) as unknown as DriveActions;
    _driveActions = {
      addFolder: mod.addFolder,
      addFile: mod.addFile,
      deleteNode: mod.deleteNode,
    };
  }
  return _driveActions;
}

export async function getDriveNodes(
  client: Pick<SpecDriveClient, "get">,
  driveId: string,
): Promise<DriveNode[]> {
  const drive = (await client.get(driveId)) as {
    state?: { global?: { nodes?: DriveNode[] } };
  };
  return drive?.state?.global?.nodes ?? [];
}

/**
 * Ensure a file node for `docId` exists in the drive, in the folder the
 * package drive layout gives its type (made when missing; the drive root for
 * a type the layout does not place). Idempotent: skips when a file node with
 * the same id is already present (wherever it is filed). On create, also adds
 * the drive's `child` relationship to the doc, which `find({ parentId })` reads.
 */
export async function ensureFileNode(
  client: SpecDriveClient,
  driveId: string,
  spec: PushedSpec,
  log?: FsSyncLogger,
): Promise<void> {
  const nodes = await getDriveNodes(client, driveId);
  if (nodes.some((n) => n.kind === "file" && n.id === spec.id)) return;
  const { addFile, addFolder } = await getDriveActions();
  const path = folderForDocumentType(spec.documentType);
  const folders = path ? missingLayoutFolders(driveId, nodes, [path]) : [];
  const parentFolder = path
    ? (folders.at(-1)?.id ?? findLayoutFolder(nodes, path)?.id ?? null)
    : null;
  await client.execute(driveId, "main", [
    ...folders.map((folder) => addFolder(folder)),
    addFile({
      id: spec.id,
      name: spec.name,
      documentType: spec.documentType,
      parentFolder,
    }),
  ]);
  log?.debug?.(
    `[spec-fs-sync] filed ${spec.documentType} "${spec.name}" ` +
      `documentId=${spec.id} driveId=${driveId} folder=${path ?? "(root)"}`,
  );
  // The file node is what Vetra Studio reads: a relationship failure is
  // reported, not allowed to abort the attach.
  try {
    await client.addRelationship(driveId, spec.id, "child");
  } catch (err) {
    log?.warn?.(
      `[spec-fs-sync] addRelationship failed for ${spec.id}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Give the Studio drive the package drive layout's folders. Adds what is
 * missing, moves no document and makes no package document. Returns what the
 * drive still lacks.
 */
export function ensureDriveLayout(
  reactor: Pick<ReactorContext, "client">,
  driveId: string,
  log?: FsSyncLogger,
): Promise<PackageDriveReport> {
  return serialized(async () => {
    const client = specClient(reactor);
    const { addFolder } = await getDriveActions();
    return ensurePackageDrive(driveId, {
      nodes: () => getDriveNodes(client, driveId),
      addFolders: async (folders) => {
        await client.execute(
          driveId,
          "main",
          folders.map((folder) => addFolder(folder)),
        );
        log?.info?.(
          `[spec-fs-sync] drive layout: added ${folders.length} folder(s) to drive ${driveId}`,
        );
      },
    });
  });
}

/**
 * Remove a spec doc from the drive: delete its file node, drop the drive's
 * `child` relationship, then delete the document itself. Idempotent — a
 * missing node, relationship, or document is treated as already-gone and
 * logged at debug, not error.
 */
export function removeSpecFromDrive(
  reactor: Pick<ReactorContext, "client">,
  driveId: string,
  docId: string,
  log?: FsSyncLogger,
): Promise<void> {
  return serialized(() => removeSpecNode(specClient(reactor), driveId, docId, log));
}

/** {@link removeSpecFromDrive} without the queue, for a caller already in it. */
export async function removeSpecNode(
  client: SpecDriveClient,
  driveId: string,
  docId: string,
  log?: FsSyncLogger,
): Promise<void> {
  try {
    const nodes = await getDriveNodes(client, driveId);
    if (nodes.some((n) => n.kind === "file" && n.id === docId)) {
      const { deleteNode } = await getDriveActions();
      await client.execute(driveId, "main", [deleteNode({ id: docId })]);
      log?.debug?.(
        `[spec-fs-sync] removed spec node from drive: documentId=${docId} driveId=${driveId}`,
      );
    } else {
      log?.debug?.(
        `[spec-fs-sync] no file node for ${docId} in drive ${driveId} — skipping node delete`,
      );
    }
  } catch (err) {
    log?.debug?.(
      `[spec-fs-sync] deleteNode skipped for ${docId}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  try {
    await client.removeRelationship(driveId, docId, "child");
  } catch (err) {
    log?.debug?.(
      `[spec-fs-sync] removeRelationship skipped for ${docId}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  try {
    await client.deleteDocument(docId);
  } catch (err) {
    log?.debug?.(
      `[spec-fs-sync] deleteDocument skipped for ${docId}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
