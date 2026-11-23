/**
 * Runtime-spec-sync trigger — the Preview's loaded models → the Studio drive.
 *
 * When the Preview run is ready, and again on each new inspector report (a
 * package reload), brings the drive's model specification documents to the
 * report (`helpers/runtime-spec-sync.ts`). It writes the drive only.
 */
import fs from "node:fs";
import type { ReactorContext } from "@powerhousedao/clint";
import { defineTrigger } from "../framework.js";
import { studioSignatureMode } from "../auth/studio-mode.js";
import { previewModels } from "../helpers/preview-inspector.js";
import { formatRuntimeSpecSync, syncRuntimeSpecs } from "../helpers/runtime-spec-sync.js";
import { studioPath } from "../helpers/studio-paths.js";

const RETRY_MS = 10_000;
const MAX_TRIES = 5;

interface TriggerState {
  /** The report file as last looked at (mtime and size). */
  seen: string | undefined;
  /** The report last synced (`sequence` and `writtenAt`). */
  synced: string | undefined;
  retryAt: number;
  failures: number;
}

/** Schedule another pass over the same report; false once it had its tries. */
function retry(state: TriggerState): boolean {
  state.failures += 1;
  if (state.failures >= MAX_TRIES) return false;
  state.retryAt = Date.now() + RETRY_MS;
  return true;
}

function fileStamp(file: string): string | undefined {
  try {
    const stat = fs.statSync(file);
    return `${stat.mtimeMs}:${stat.size}`;
  } catch {
    return undefined;
  }
}

export const runtimeSpecSyncTrigger = defineTrigger<TriggerState>({
  id: "runtime-spec-sync",
  type: "condition",
  state: () => ({ seen: undefined, synced: undefined, retryAt: 0, failures: 0 }),

  async poll(ctx) {
    const services = ctx.commandContext.services;
    if (!services) return null;
    const workdir = ctx.context.workdir;
    const stamp = fileStamp(studioPath(workdir, "previewInspector"));
    if (!stamp || stamp === ctx.state.seen) return null;
    if (Date.now() < ctx.state.retryAt) return null;

    // Not ready yet: the same file is read again once the run is.
    const models = previewModels(services, workdir, { full: true });
    if (models.kind !== "ready") return null;
    const report = `${models.sequence}:${models.writtenAt}`;
    if (report === ctx.state.synced) {
      ctx.state.seen = stamp;
      return null;
    }
    const reactor = await ctx.reactor();
    if (!reactor) return null;
    const driveId =
      (reactor as { personalDriveId?: string }).personalDriveId ??
      (reactor as { driveId?: string }).driveId;
    if (!driveId) return null;

    const log = ctx.context.log;
    try {
      const result = await syncRuntimeSpecs({
        reactor: reactor as unknown as Pick<ReactorContext, "client">,
        driveId,
        workdir,
        types: models.types,
        signatureMode: await studioSignatureMode(reactor, ctx.context.config, log),
        log,
      });
      const line = formatRuntimeSpecSync(result);
      if (line) {
        log?.info?.(`[runtime-spec-sync] report ${models.sequence}: ${line}`);
      } else {
        log?.info?.(
          `[runtime-spec-sync] report ${models.sequence}: ${result.unchanged.length} model specification(s) unchanged, 0 operations`,
        );
      }
      if (result.failed.length > 0 && retry(ctx.state)) return null;
      ctx.state.failures = 0;
      ctx.state.seen = stamp;
      ctx.state.synced = report;
    } catch (err) {
      log?.warn?.(
        `[runtime-spec-sync] sync failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      if (!retry(ctx.state)) {
        ctx.state.failures = 0;
        ctx.state.seen = stamp;
      }
    }
    return null;
  },
});
