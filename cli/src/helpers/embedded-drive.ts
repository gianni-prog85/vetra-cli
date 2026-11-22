/**
 * Running-reactor accessor for the commands that write the Studio drive.
 *
 * The `spec-*` commands write the filesystem `specs/` unconditionally
 * (codegen's source of truth) and, when the Cli serves, ALSO push the change
 * into the Studio drive on the switchboard so Vetra Studio reflects it
 * directly — without waiting on the `spec-fs-sync` watcher round-trip.
 *
 * `context.folders` is the "reactor attached" signal: the Cli's startup wires
 * it only when a personal drive exists, and a one-shot run never does. Calling
 * `ctx.reactor()` blindly would attach just to write a spec — so we gate on
 * `folders` first and only then resolve the already-attached reactor. The
 * Studio drive has role 'personal', so `personalDriveId` is set; fall back to
 * `driveId` for safety.
 */
import type { ReactorContext } from "@powerhousedao/clint";

export interface EmbeddedDrive {
  reactor: Pick<ReactorContext, "client">;
  driveId: string;
}

/**
 * Structural view of the command context this accessor reads. Typed loosely
 * (client as `unknown`) so it accepts a `CommandContext<Config, R>` for any
 * registry `R` without tripping `ReactorContext` generic variance — the caller
 * passes its concrete client straight through to `applyFsChangesToReactor`.
 */
interface RunningReactorCtx {
  folders?: unknown;
  reactor?: () => Promise<
    | { client: unknown; personalDriveId?: string; driveId?: string }
    | undefined
  >;
}

export async function getEmbeddedDrive(
  ctx: RunningReactorCtx,
): Promise<EmbeddedDrive | undefined> {
  if (!ctx.folders) return undefined; // one-shot → no attach, FS only
  const reactor = await ctx.reactor?.(); // attached at start, no new attach
  const driveId = reactor?.personalDriveId ?? reactor?.driveId;
  if (!reactor || !driveId) return undefined;
  return { reactor: reactor as Pick<ReactorContext, "client">, driveId };
}

/** A document `find` returns. */
export interface FoundDocument {
  header: { id: string; name?: string };
  state?: { global?: Record<string, unknown> };
}

interface FindPage {
  results: FoundDocument[];
  next?: () => Promise<FindPage>;
}

/** The `find` both reactor clients have (the drive's `child` documents). */
export interface DriveFindClient {
  find(search: { type: string; parentId: string }): Promise<FindPage>;
}

/**
 * The documents of `type` the drive holds as `child`, over every page: the
 * type filter applies per page, so a match can sit behind an empty one.
 */
export async function findInDrive(
  client: DriveFindClient,
  driveId: string,
  type: string,
): Promise<FoundDocument[]> {
  const found: FoundDocument[] = [];
  let page: FindPage | undefined = await client.find({ type, parentId: driveId });
  while (page) {
    found.push(...page.results);
    page = page.next ? await page.next() : undefined;
  }
  return found;
}
