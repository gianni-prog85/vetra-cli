/**
 * Spec ↔ Studio-drive sync primitives.
 *
 * Shared between the `spec-fs-sync` chokidar trigger (filesystem → drive mirror
 * for external edits) and the `spec-*` write commands (which push their FS
 * writes straight into the Studio switchboard). Both call
 * `applyFsChangesToReactor` to materialize-if-absent → replay content actions
 * → attach the doc to the drive. `spec-delete` calls `removeSpecFromDrive` to
 * tear a doc back out.
 *
 * A spec `.phd` carries content-scope (`global` / `local`) ops plus the
 * `document`-scope create ops `createDocument()` records. The reactor can't
 * replay a create for a document it materializes itself, so the document is
 * materialized separately and only content scopes are replayed: the actions
 * whose ids the reactor does not hold yet are executed through the client, so
 * re-feeding the same file is a no-op and later edits ship as deltas. The
 * calls are ones both clients have (the in-process client and the
 * switchboard's GraphQL client); there is no load API over the wire.
 *
 * Drive attachment: the Studio works in one project, so every spec doc is an
 * ADD_FILE node at the drive root (`drive.state.global.nodes`, what Vetra
 * Studio reads) plus a `child` relationship. The step checks existing nodes
 * and skips when present, so re-attaching is a no-op. ADD_FILE mutates the
 * drive document (`powerhouse/document-drive`), not a spec type, so it never
 * feeds back into `spec-sync` (drive → FS).
 */
import path from "node:path";
import { baseLoadFromFile } from "document-model/node";
import { signaturePolicyOf } from "document-model";
import type { ReactorContext } from "@powerhousedao/clint";
import {
  createSpecDocument,
  listSpecTypes,
  resolveSpecEntry,
  saveSpec,
} from "../commands/spec/registry.js";
import type { StudioSignatureMode } from "../auth/studio-mode.js";

export const SPECS_DIRNAME = "specs";

export interface SpecRegistration {
  documentType: string;
  subdir: string;
  reducer: (state: unknown, action: unknown) => unknown;
}

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

function specClient(reactor: Pick<ReactorContext, "client">): SpecDriveClient {
  return reactor.client as unknown as SpecDriveClient;
}

// One sync at a time in this process: a command's push and the watcher's poll
// of the same file would each find its actions unknown and execute them twice,
// and two attaches of a new file would each add its node.
let syncQueue: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = syncQueue.then(fn);
  syncQueue = run.catch(() => undefined);
  return run;
}

// Built from the merged registry (codegen builder specs + vetra-app domain
// models like brand-sheet), so every spec type the `spec-*` tools can write is
// recognized — not just the five builder types.
const SUBDIR_TO_SPEC = new Map<string, SpecRegistration>();
for (const documentType of listSpecTypes()) {
  const entry = resolveSpecEntry(documentType);
  SUBDIR_TO_SPEC.set(entry.subdir, {
    documentType,
    subdir: entry.subdir,
    reducer: entry.reducer as never,
  });
}

/**
 * Infer the spec registration for a `.phd` path from the `specs/<subdir>/`
 * tail (`<project>/specs/<subdir>/<file>`). Returns undefined when the path
 * doesn't sit directly under a `specs/<known-subdir>/` directory.
 */
export function specForPath(filePath: string): SpecRegistration | undefined {
  const segments = filePath.split(path.sep);
  const specsIdx = segments.lastIndexOf(SPECS_DIRNAME);
  // Need `specs/<subdir>/<file>`: a subdir segment and a file after it.
  if (specsIdx === -1 || specsIdx + 2 > segments.length - 1) return undefined;
  return SUBDIR_TO_SPEC.get(segments[specsIdx + 1]);
}

interface LoadedDoc {
  header: {
    id: string;
    name: string;
    documentType: string;
    branch?: string;
    protocolVersions?: Record<string, number> | null;
  };
  state?: unknown;
  operations: Record<string, unknown[]>;
}

/**
 * Load a `.phd`. Returns undefined when the path isn't a known spec or the
 * file fails to load.
 */
async function loadSpecForFile(
  filePath: string,
  log?: FsSyncLogger,
): Promise<LoadedDoc | undefined> {
  const spec = specForPath(filePath);
  if (!spec) {
    log?.warn?.(
      `[spec-fs-sync] skip ${filePath}: not under a known specs/<subdir>/`,
    );
    return undefined;
  }
  try {
    return (await baseLoadFromFile(filePath, spec.reducer as never)) as LoadedDoc;
  } catch (err) {
    log?.warn?.(
      `[spec-fs-sync] load failed for ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return undefined;
  }
}

async function hasDocument(client: SpecDriveClient, id: string): Promise<boolean> {
  try {
    await client.get(id);
    return true;
  } catch {
    return false;
  }
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

/**
 * Execute the file's content actions the reactor does not hold, one call per
 * scope, in file order. An action without an id cannot be matched on the next
 * sync, so it is skipped rather than replayed on every pass.
 */
async function replayUnknownActions(
  client: SpecDriveClient,
  doc: LoadedDoc,
  log?: FsSyncLogger,
): Promise<number> {
  const existing = await operationsByScope(client, doc.header.id);
  const branch = doc.header.branch || "main";
  let executed = 0;
  for (const [scope, ops] of Object.entries(doc.operations)) {
    if (scope === "document" || !Array.isArray(ops) || ops.length === 0) continue;
    const known = new Set(
      (existing[scope] ?? []).map((op) => op.action?.id).filter(Boolean),
    );
    const actions = ops
      .map((op) => (op as { action?: Record<string, unknown> }).action)
      .filter((action): action is Record<string, unknown> => Boolean(action));
    const withoutId = actions.filter((action) => typeof action.id !== "string");
    if (withoutId.length > 0) {
      log?.warn?.(
        `[spec-fs-sync] ${doc.header.id}: skipped ${withoutId.length} ${scope} action(s) without an id`,
      );
    }
    const unknown = actions.filter(
      (action) => typeof action.id === "string" && !known.has(action.id),
    );
    if (unknown.length === 0) continue;
    // In a signed Studio the client signs them; it throws SignerNotReadyError
    // while it cannot, and then nothing is submitted.
    await client.execute(doc.header.id, branch, unknown);
    executed += unknown.length;
  }
  if (executed > 0) {
    log?.debug?.(
      `[spec-fs-sync] executed ${executed} action(s) on ${doc.header.documentType} ${doc.header.id}`,
    );
  }
  return executed;
}

interface PushedSpec {
  id: string;
  name: string;
  documentType: string;
}

/**
 * Bring one loaded spec into the reactor and return the document it now is.
 * A document the reactor holds gets the file's unknown content actions.
 * Legacy: a document it lacks is created empty under the file's id and type,
 * then gets them too. `v2-required`: a document it lacks is created from the
 * file's state, which holds the content, so nothing is replayed; a signed
 * file keeps its id, a legacy one can never become a v2 document, so a new
 * signed one is built.
 */
async function pushSpec(
  client: SpecDriveClient,
  doc: LoadedDoc,
  mode: StudioSignatureMode,
  log?: FsSyncLogger,
): Promise<PushedSpec> {
  const { id, name, documentType } = doc.header;
  if (!(await hasDocument(client, id))) {
    if (mode === "v2-required") {
      if (signaturePolicyOf(doc.header as never) === "v2-required") {
        await client.create(doc);
        log?.debug?.(`[spec-fs-sync] created signed ${documentType} ${id}`);
        return { id, name, documentType };
      }
      const fresh = createSpecDocument(documentType, {
        name,
        initialState: doc.state,
        signaturePolicy: "v2-required",
      });
      await client.create(fresh);
      log?.info?.(
        `[spec-fs-sync] created signed ${documentType} "${name}" ${fresh.header.id} from ${id} (this Studio keeps no unsigned documents).`,
      );
      return { id: fresh.header.id, name, documentType };
    }
    const fresh = createSpecDocument(documentType) as {
      header: { id: string; name: string; documentType: string };
    };
    fresh.header.id = id;
    fresh.header.documentType = documentType;
    fresh.header.name = name;
    await client.create(fresh);
    log?.debug?.(`[spec-fs-sync] materialized ${documentType} ${id}`);
  }
  await replayUnknownActions(client, doc, log);
  return { id, name, documentType };
}

interface DriveActions {
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
      addFile: mod.addFile,
      deleteNode: mod.deleteNode,
    };
  }
  return _driveActions;
}

async function getDriveNodes(
  client: SpecDriveClient,
  driveId: string,
): Promise<DriveNode[]> {
  const drive = (await client.get(driveId)) as {
    state?: { global?: { nodes?: DriveNode[] } };
  };
  return drive?.state?.global?.nodes ?? [];
}

/**
 * Ensure a file node for `docId` exists at the drive root. Idempotent: skips
 * when a file node with the same id is already present (wherever it is filed).
 * On create, also adds the drive's `child` relationship to the doc, which
 * `find({ parentId })` reads.
 */
async function ensureFileNode(
  client: SpecDriveClient,
  driveId: string,
  spec: PushedSpec,
  log?: FsSyncLogger,
): Promise<void> {
  const nodes = await getDriveNodes(client, driveId);
  if (nodes.some((n) => n.kind === "file" && n.id === spec.id)) return;
  const { addFile } = await getDriveActions();
  await client.execute(driveId, "main", [
    addFile({
      id: spec.id,
      name: spec.name,
      documentType: spec.documentType,
      parentFolder: null,
    }),
  ]);
  log?.debug?.(
    `[spec-fs-sync] filed ${spec.documentType} "${spec.name}" ` +
      `documentId=${spec.id} driveId=${driveId}`,
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

export interface ApplyFsChangesOptions {
  /**
   * `v2-required` (a signed Studio): documents the reactor does not have are
   * created through the client (signed), a legacy file gets a new signed
   * document from its state, and each file is rewritten from the signed
   * document. A write that cannot be signed is refused and logged, never
   * submitted unsigned.
   */
  signatureMode?: StudioSignatureMode;
}

/**
 * Sync each `.phd` path into the reactor and the Studio drive: materialize a
 * document the reactor lacks, execute the content actions it does not hold,
 * and attach the doc at the drive root. `workdir` is the project (where a
 * signed file is mirrored back). Returns the number of files synced. Used by
 * the trigger's poll, the `spec-*` write commands, and integration tests.
 *
 * `onLoaded` is invoked once per synced spec with its file path and document
 * id — the trigger uses it to maintain a path→docId map for resolving
 * external deletes.
 */
export function applyFsChangesToReactor(
  paths: ReadonlyArray<string>,
  workdir: string,
  reactor: Pick<ReactorContext, "client">,
  driveId: string | undefined,
  log?: FsSyncLogger,
  onLoaded?: (filePath: string, docId: string) => void,
  options: ApplyFsChangesOptions = {},
): Promise<number> {
  return serialized(async () => {
    const client = specClient(reactor);
    const mode = options.signatureMode ?? "legacy";
    let synced = 0;
    for (const filePath of paths) {
      const doc = await loadSpecForFile(filePath, log);
      if (!doc) continue;
      try {
        const pushed = await pushSpec(client, doc, mode, log);
        if (mode === "v2-required") {
          await mirrorSignedSpec(client, pushed.id, workdir, log);
        }
        onLoaded?.(filePath, pushed.id);
        if (driveId) await ensureFileNode(client, driveId, pushed, log);
        synced += 1;
      } catch (err) {
        log?.error?.(
          `[spec-fs-sync] sync failed for ${doc.header.documentType} "${doc.header.name}" (${filePath}): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    if (!driveId && synced > 0) {
      log?.warn?.(
        `[spec-fs-sync] no drive id — synced ${synced} doc(s) but skipped drive attachment`,
      );
    }
    return synced;
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
  return serialized(async () => {
    const client = specClient(reactor);
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
  });
}

/** Write the reactor's (signed) version of a document over its `.phd`. */
export async function mirrorSignedSpec(
  client: Pick<SpecDriveClient, "get" | "getOperations">,
  docId: string,
  projectDir: string,
  log?: FsSyncLogger,
): Promise<string | undefined> {
  const doc = (await client.get(docId)) as {
    header: { name?: string; documentType: string };
  };
  const operations = await operationsByScope(client, docId);
  const written = await saveSpec(
    { ...(doc as unknown as Record<string, unknown>), operations } as never,
    projectDir,
  );
  log?.debug?.(`[spec-fs-sync] mirrored signed ${doc.header.documentType} "${doc.header.name}" → ${written}`);
  return written;
}
