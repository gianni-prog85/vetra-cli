/**
 * Drive-layout trigger — gives the Studio drive the package drive layout's
 * folders once the drive can be reached. Adds what is missing, moves no
 * document.
 */
import type { ReactorContext } from "@powerhousedao/clint";
import { defineTrigger } from "../framework.js";
import { ensureDriveLayout } from "../helpers/spec-drive-sync.js";

interface TriggerState {
  /** The layout was applied, or refused, this session. */
  done: boolean;
}

export const driveLayoutTrigger = defineTrigger<TriggerState>({
  id: "drive-layout",
  type: "condition",
  state: () => ({ done: false }),

  async poll(ctx) {
    if (ctx.state.done) return null;
    const reactor = await ctx.reactor();
    if (!reactor) return null;
    const driveId =
      (reactor as { personalDriveId?: string }).personalDriveId ??
      (reactor as { driveId?: string }).driveId;
    if (!driveId) return null;

    // Once per session; a drive that refuses the folders still takes documents.
    ctx.state.done = true;
    const log = ctx.context.log;
    try {
      await ensureDriveLayout(
        reactor as unknown as Pick<ReactorContext, "client">,
        driveId,
        log,
      );
    } catch (err) {
      log?.warn?.(
        `[drive-layout] not applied: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return null;
  },
});
