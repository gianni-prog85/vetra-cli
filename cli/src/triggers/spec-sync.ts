/**
 * Spec-sync trigger — Vetra-drive → filesystem mirror.
 *
 * Subscribes to spec document changes on the Studio switchboard and writes
 * each doc to disk via `saveSpec`, into the
 * project the Cli works in: `<workdir>/specs/<subdir>/`.
 *
 * Sibling of `spec-fs-sync` (FS → drive). The loop closes via that trigger's
 * action-id and node dedup — re-feeding a `.phd` it just wrote is a no-op.
 */
import { createDocumentChangeTrigger } from "@powerhousedao/clint";
import { loadByName } from "../commands/spec/_helpers.js";
import { listSpecTypes, saveSpec } from "../commands/spec/registry.js";
import { withProjectCodegenLock } from "../helpers/project-lock.js";

// Every spec type the `spec-*` tools can produce: the five codegen builder
// specs plus vetra-app domain models (brand-sheet, feature, …). Mirroring all
// of them keeps drive→FS symmetric with FS→drive.
const SPEC_DOC_TYPES = listSpecTypes();

interface SpecLogger {
  debug: (msg: string) => void;
  warn: (msg: string) => void;
}

/** Minimal slice of the reactor operation history we read. */
interface Operation {
  index: number;
  action?: { scope?: string };
}
interface OperationsPage {
  results: Operation[];
  next?: () => Promise<OperationsPage>;
}
interface OperationsClient {
  getOperations: (docId: string) => Promise<OperationsPage>;
}

// Pull full op history from the reactor store so the mirrored `.phd` preserves
// every scope (incl. document-scope create ops), matching `spec-*` command writes.
async function operationsByScope(
  client: OperationsClient,
  docId: string,
): Promise<Record<string, Operation[]>> {
  const byScope: Record<string, Operation[]> = {};
  let page: OperationsPage | undefined = await client.getOperations(docId);
  while (page) {
    for (const op of page.results) {
      const scope = op.action?.scope ?? "global";
      (byScope[scope] ??= []).push(op);
    }
    page = page.next ? await page.next() : undefined;
  }
  for (const ops of Object.values(byScope)) ops.sort((a, b) => a.index - b.index);
  return byScope;
}

// Content-revision proxy: non-document op count (content scopes are append-only,
// so higher = newer; document scope is constant, excluded to keep sides symmetric).
export function specRevision(ops: Record<string, unknown[]> | undefined): number {
  if (!ops) return 0;
  let n = 0;
  for (const [scope, list] of Object.entries(ops)) {
    if (scope === "document") continue;
    n += Array.isArray(list) ? list.length : 0;
  }
  return n;
}

type SpecDoc = { header: { id: string; documentType: string; name: string } };

// I/O the mirror decision depends on; injected so the decision is unit-testable
// without a real filesystem, reactor, or lock.
export interface SpecMirrorIo {
  loadExisting: (
    projectDir: string,
    docId: string,
  ) => Promise<{ operations?: Record<string, unknown[]> }>;
  save: (doc: unknown, projectDir: string) => Promise<string>;
  withLock: <T>(base: string, fn: () => Promise<T>) => Promise<T>;
}

const realSpecMirrorIo: SpecMirrorIo = {
  loadExisting: (projectDir, docId) => loadByName(projectDir, docId),
  save: (doc, projectDir) => saveSpec(doc as never, projectDir),
  withLock: withProjectCodegenLock,
};

// Mirror one doc to its `.phd` under the codegen lock, skipping when the drive
// revision isn't newer than disk. Keyed by doc id (not name) for an exact read.
export async function mirrorSpecDoc(
  doc: SpecDoc,
  operations: Record<string, unknown[]>,
  projectDir: string,
  io: SpecMirrorIo,
  log?: SpecLogger,
): Promise<"written" | "skipped"> {
  return io.withLock(projectDir, async () => {
    const incoming = specRevision(operations);
    let onDisk = -1;
    try {
      const existing = await io.loadExisting(projectDir, doc.header.id);
      onDisk = specRevision(existing.operations);
    } catch {
      // No on-disk spec yet (first write) — proceed.
    }
    if (incoming <= onDisk) {
      log?.debug(
        `[spec-sync] skip "${doc.header.name}": drive rev ${incoming} <= disk rev ${onDisk}`,
      );
      return "skipped";
    }
    const written = await io.save({ ...doc, operations }, projectDir);
    log?.debug(
      `[spec-sync] wrote ${doc.header.documentType} "${doc.header.name}" → ${written}`,
    );
    return "written";
  });
}

/** Mirror `docs` into the project (`workdir`), each to its `.phd` under `specs/`. */
export async function syncSpecsToFs(
  docs: ReadonlyArray<{ header: { id: string; documentType: string; name: string } }>,
  workdir: string,
  opts?: {
    log?: SpecLogger;
    client?: OperationsClient;
    io?: SpecMirrorIo;
  },
): Promise<void> {
  const log = opts?.log;
  const io = opts?.io ?? realSpecMirrorIo;
  for (const doc of docs) {
    try {
      // Re-attach the operation history the change event omits, so the `.phd`
      // is a full document and not a state-only snapshot.
      const operations = opts?.client
        ? await operationsByScope(opts.client, doc.header.id)
        : ((doc as { operations?: Record<string, unknown[]> }).operations ?? {});
      await mirrorSpecDoc(
        doc,
        operations as Record<string, unknown[]>,
        workdir,
        io,
        log,
      );
    } catch (err) {
      log?.warn(
        `[spec-sync] failed to save "${doc.header.name}": ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}

export const specSyncTrigger = createDocumentChangeTrigger({
  id: "spec-sync",
  // Spec types aren't in the typed registry (which only knows ChatSession);
  // the trigger uses the doc type only as an event filter.
  documentType: SPEC_DOC_TYPES,
  initialReconcile: false,
  async onChange(docs, ctx) {
    const reactor = await ctx.reactor?.();
    await syncSpecsToFs(docs, ctx.context.workdir, {
      log: ctx.context.log,
      client: reactor?.client as OperationsClient | undefined,
    });
    // Side-effect-only trigger — no agent work item produced.
    return null;
  },
});
