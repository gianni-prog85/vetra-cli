import { z } from "zod";
import { formatStatus } from "@powerhousedao/clint";
import { defineCommand } from "../../framework.js";
import { projectRoot } from "../../helpers/project.js";

/**
 * Idempotent `reactor-project-start`. Overrides the ph-clint auto-injected
 * version (user-defined commands win in `defineCli`'s command map) so that
 * calling start against a running project returns the existing instance
 * instead of failing with "Service has reached max instances (1)".
 *
 * The system prompt promises this behaviour ("idempotent and a no-op when
 * already running"): a start the Studio's preview pane makes and the agent's
 * explicit one never race into a stop/start dance. It starts the Preview run
 * of the project the Cli works in (the workdir); ports and reloads are the
 * package's host data (`hosts/preview`).
 */
export const reactorProjectStart = defineCommand({
  id: "reactor-project-start",
  description: "Start the Preview run of the project (idempotent)",
  inputSchema: z.object({}),
  execute: async (_input, context) => {
    const services = context.services;
    if (!services) throw new Error("No services configured");

    const projectPath = await projectRoot(context.workdir);

    const existing = services
      .list("reactor-project")
      .find(
        (s) =>
          s.workdir === projectPath &&
          (s.status === "ready" || s.status === "starting"),
      );
    // The project the Studio's preview pane shows from now on.
    const data = { projectPath };
    if (existing) {
      return { text: formatStatus(existing), data };
    }

    try {
      const instanceId = await services.start("reactor-project", {
        workdir: projectPath,
        cwd: projectPath,
      });
      const status = services
        .list("reactor-project")
        .find((s) => s.instanceId === instanceId);
      return { text: status ? formatStatus(status) : "", data };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { text: `✗ reactor-project: ${msg}` };
    }
  },
});
