/**
 * Reactor accessors for the commands that read and write the Studio drive.
 *
 * `getEmbeddedDrive` is for a write that is optional: it resolves the reactor
 * only where the Cli serves. `context.folders` marks that (startup wires it
 * when a personal drive exists, a one-shot run never has it), so a one-shot
 * run does not attach for it. `requireSpecDrive` is for the `spec-*`
 * commands, which have no other store: it always resolves the reactor.
 *
 * The Studio drive has role 'personal', so `personalDriveId` is set;
 * `driveId` is the fallback.
 */
import type { ReactorContext } from "@powerhousedao/clint";

export interface EmbeddedDrive {
  reactor: Pick<ReactorContext, "client">;
  driveId: string;
}

/**
 * Structural view of the command context this accessor reads. Typed loosely
 * (client as `unknown`) so it accepts a `CommandContext<Config, R>` for any
 * registry `R` without tripping `ReactorContext` generic variance.
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
  if (!ctx.folders) return undefined; // one-shot → no attach
  const reactor = await ctx.reactor?.(); // attached at start, no new attach
  const driveId = reactor?.personalDriveId ?? reactor?.driveId;
  if (!reactor || !driveId) return undefined;
  return { reactor: reactor as Pick<ReactorContext, "client">, driveId };
}

/**
 * The Studio drive the `spec-*` commands read and write. Specifications live
 * in the drive only, so a one-shot run attaches too (to the project's running
 * Studio, or `VETRA_SWITCHBOARD_URL`) and a run with no drive to reach is
 * refused.
 */
export async function requireSpecDrive(
  ctx: Pick<RunningReactorCtx, "reactor">,
): Promise<EmbeddedDrive> {
  const lead = "Specifications are kept in the Studio drive, and none can be reached";
  const hint =
    "Start Studio in this project (ph vetra) and run this again, or set " +
    "VETRA_SWITCHBOARD_URL to the drive address (<switchboard>/d/<slug>).";
  let reactor: Awaited<ReturnType<NonNullable<RunningReactorCtx["reactor"]>>>;
  try {
    reactor = await ctx.reactor?.();
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    // The Cli's own refusal already names the two ways in.
    throw new Error(
      cause.includes("VETRA_SWITCHBOARD_URL")
        ? `${lead}: ${cause}`
        : `${lead}: ${cause}. ${hint}`,
    );
  }
  const driveId = reactor?.personalDriveId ?? reactor?.driveId;
  if (!reactor || !driveId) throw new Error(`${lead}. ${hint}`);
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
