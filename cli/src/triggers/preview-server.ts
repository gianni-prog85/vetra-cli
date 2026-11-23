/**
 * Preview-server trigger — long-running HTTP endpoint for the vetra-studio
 * BUILD pane.
 *
 * Triggers are the framework's contract for side-effecty work that needs
 * full runtime access (services + event bus). We use one here because:
 *   - `/resolve` and `/start` need `services.list()` and `services.start()`,
 *     which only the framework-issued `ServiceManager` provides.
 *   - `/events` (SSE) needs to bridge the framework's event bus to browser
 *     EventSource clients, which `ctx.context.on` exposes.
 *
 * `setup()` boots the http server on an OS port (each Studio its own) and
 * writes `studio.config.json` (`preview-server/studio-config.ts`), which the
 * Studio's Connect serves to the tab. `poll()` returns null forever — this
 * trigger never emits work items; it exists purely for its setup-lifetime
 * side effects. `teardown()` removes the file and closes the server.
 */
import { processControlChannel } from "@powerhousedao/host-core";
import { defineTrigger } from "../framework.js";
import { projectRoot } from "../helpers/project.js";
import { localProjectHosts, serveProjectHosts } from "../project-hosts/control.js";
import { projectHosts } from "../project-hosts/manager.js";
import {
  DEFAULT_PREVIEW_SERVER_PORT,
  PREVIEW_SERVER_HOST,
  startPreviewServer,
  type PreviewServerHandle,
} from "../preview-server/index.js";
import {
  removeStudioConfig,
  studioConfigFor,
  studioConfigPath,
  writeStudioConfig,
} from "../preview-server/studio-config.js";
import { setRequireAdminIdentity } from "../auth/renown.js";
import { isCloudStudio, studioSignatureMode } from "../auth/studio-mode.js";
import { resolveCloudConfig, resolveStudioRenownUrl } from "../cloud/config.js";
import { getEmbeddedDrive } from "../helpers/embedded-drive.js";
import { studioUrlOf } from "./studio-url.js";
import { DEFAULT_PH_VERSION } from "../ph-version.gen.js";
import { VETRA_CLI_VERSION } from "../version-banner.js";

interface TriggerState {
  handle: PreviewServerHandle | undefined;
  /** The studio.config.json this Cli wrote, and the address it names. */
  studioConfig: { file: string; previewServerUrl: string } | undefined;
}

export const previewServerTrigger = defineTrigger<TriggerState>({
  id: "preview-server",
  type: "condition",
  state: () => ({ handle: undefined, studioConfig: undefined }),

  async setup(ctx) {
    const services = ctx.commandContext.services;
    const on = ctx.commandContext.on;
    const workdir = ctx.context.workdir;
    if (!services) {
      ctx.context.log?.warn?.(
        "[preview-server] no ServiceManager in context — skipping start",
      );
      return;
    }
    if (!on) {
      ctx.context.log?.warn?.(
        "[preview-server] no event-bus accessor in context — skipping start",
      );
      return;
    }

    const { renownUrl } = resolveCloudConfig(ctx.context.config);
    // Cloud Studio (an environment id): the agent's Renown identity must be
    // an ADMINS wallet. Same test as the agent's identity on the attach.
    const cloud = isCloudStudio(ctx.context.config);
    setRequireAdminIdentity(cloud);
    // The switchboard's create policy against that identity, read once at
    // start without waiting: a mismatch is logged, never a reason not to start.
    const drive = await getEmbeddedDrive(ctx.commandContext);
    if (drive) {
      void studioSignatureMode(drive.reactor, ctx.context.config, ctx.context.log).catch(
        (err: unknown) =>
          ctx.context.log?.warn?.(
            `[signing] could not read the switchboard's create policy: ${err instanceof Error ? err.message : String(err)}`,
          ),
      );
    }

    let handle: PreviewServerHandle;
    try {
      handle = ctx.state.handle = await startPreviewServer({
        services,
        subscribe: (event, handler) => on(event, handler),
        workdir,
        renownUrl,
        registryUrl: ctx.context.config.registryUrl,
        port: DEFAULT_PREVIEW_SERVER_PORT,
        versions: { vetraCli: VETRA_CLI_VERSION, ph: DEFAULT_PH_VERSION },
        getReactor: () => getEmbeddedDrive(ctx.commandContext),
        agentLogging: ctx.context.config.agentLogging,
        cloud,
        // Verify owner bearers on the Renown the Studio's Connect logs in on.
        gateRenownUrl: resolveStudioRenownUrl(
          process.env.RENOWN_URL,
          ctx.context.config.cloudRenownUrl,
          { warn: (m) => ctx.context.log?.warn?.(m) },
        ),
        // Read per request: the Connect member reports its URL once ready.
        getStudioUrl: () => studioUrlOf(services.list()),
        log: {
          info: (m) => ctx.context.log?.info?.(m),
          error: (m) => ctx.context.log?.error?.(m),
          debug: (m) => ctx.context.log?.debug?.(m),
        },
      });
    } catch (err) {
      ctx.context.log?.error?.(
        `[preview-server] failed to start: ${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }

    // A command in a second terminal reaches the hosts this Cli started.
    const channel = processControlChannel();
    try {
      const projectPath = await projectRoot(workdir);
      if (channel) {
        serveProjectHosts(channel, localProjectHosts(projectHosts(), projectPath));
      }
    } catch {
      // No project in the workdir: no hosts to serve.
    }

    // Tell the tab where the local API is, through the Studio's Connect.
    const previewServerUrl = `http://${PREVIEW_SERVER_HOST}:${handle.port}`;
    const file = studioConfigPath();
    try {
      writeStudioConfig(
        file,
        studioConfigFor({
          previewServerUrl,
          studioUrl: studioUrlOf(services.list()),
          studioDriveId: drive?.driveId,
          config: ctx.context.config,
          workdir,
        }),
      );
      ctx.state.studioConfig = { file, previewServerUrl };
      ctx.context.log?.debug?.(`[preview-server] ${previewServerUrl}, named in ${file}`);
    } catch (err) {
      ctx.context.log?.error?.(
        `[preview-server] could not write ${file}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },

  async teardown(ctx) {
    const written = ctx.state.studioConfig;
    if (written) removeStudioConfig(written.file, written.previewServerUrl);
    ctx.state.studioConfig = undefined;
    await ctx.state.handle?.stop();
    ctx.state.handle = undefined;
    // The project hosts started here stop with the Studio.
    await projectHosts().stopAll();
  },

  async poll() {
    return null;
  },
});
