/**
 * Preview-run trigger — starts the Preview run when the Cli starts, so the
 * Studio has the project's code loaded without anyone asking for it.
 *
 * The start is not awaited: the Cli is up before the Preview is. Off with
 * `previewRun: false` (env `VETRA_PREVIEW_RUN=0`); the `reactor-project-*`
 * commands and `POST /start` still start it on request. The service manager
 * stops the run with the Cli.
 */
import type { ServiceManager } from "@powerhousedao/clint";
import { defineTrigger } from "../framework.js";
import { startPreview } from "../preview-server/starter.js";

interface Log {
  info?: (msg: string) => void;
  warn?: (msg: string) => void;
}

/** Start the Preview run of `workdir`; never throws. */
export async function autostartPreview(args: {
  services: ServiceManager;
  workdir: string;
  log?: Log;
}): Promise<void> {
  try {
    const result = await startPreview(args);
    if (result.kind === "unknown-project") {
      args.log?.info?.(`[preview-run] no Preview run: ${result.error}`);
    } else if (result.kind === "failed") {
      args.log?.warn?.(`[preview-run] the Preview run did not start: ${result.error}`);
    }
  } catch (err) {
    args.log?.warn?.(
      `[preview-run] the Preview run did not start: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export const previewRunTrigger = defineTrigger<{ started: Promise<void> | undefined }>({
  id: "preview-run",
  type: "condition",
  state: () => ({ started: undefined }),

  async setup(ctx) {
    if (!ctx.context.config.previewRun) return;
    const services = ctx.commandContext.services;
    if (!services) {
      ctx.context.log?.warn?.("[preview-run] no ServiceManager in context — skipping start");
      return;
    }
    ctx.state.started = autostartPreview({
      services,
      workdir: ctx.context.workdir,
      log: ctx.context.log,
    });
  },

  async poll() {
    return null;
  },
});
