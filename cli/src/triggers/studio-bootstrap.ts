/**
 * Studio bootstrap trigger (Task 5.SIG, ruling X39) — first-run creation order.
 *
 * A new cloud Studio creates its drive `v2-required`, which needs a signature
 * and therefore the owner's delegation: once writes become possible
 * (`powerhouse:writes:ready`) the drive is created through
 * `cloudStudioDriveConfig`, its pointer recorded so the Studio is sticky, and
 * the Connect bundle pointed at it (`stampStudioDrive`).
 *
 * Off until B3. The v2 mode is off (`STUDIO_V2_SIGNING`), and on the remote
 * attach this trigger cannot create the drive: clint's `ensureDrive` takes the
 * plain `IReactorClient`, while `ReactorContext` holds only the registry-typed
 * view of it. TODO(B3): a signer through `runCli`, `powerhouse:writes:ready`,
 * and the Studio drive from the switchboard host or a workdir-aware
 * `remote.drives` (the creation code is in the history of this file).
 */
import { defineTrigger } from "../framework.js";
import { activeStudioSigning } from "../auth/studio-mode.js";

export interface StudioBootstrapOptions {
  /** Path to the package root (the Connect bundle lives under it). */
  vetraAppDir: string;
  /** Relative path to the prebuilt Connect bundle. Defaults to "dist/connect". */
  connectDir?: string;
}

export function studioBootstrapTrigger(_options: StudioBootstrapOptions) {
  return defineTrigger({
    id: "studio-bootstrap",
    type: "condition",

    async setup(ctx) {
      const { config, workdir, log } = ctx.context;
      if (activeStudioSigning(workdir, config).mode !== "v2-required") return;
      log?.warn(
        "[studio-bootstrap] this Studio would create its drive v2-required, but signing on a remote switchboard is not available yet; no drive is created.",
      );
    },

    async poll() {
      return null;
    },
  });
}
