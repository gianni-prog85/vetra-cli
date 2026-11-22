import path from "node:path";
import { z } from "zod";
import { formatStatus } from "@powerhousedao/clint";
import { defineCommand } from "../../framework.js";
import { resolveReactorProjectPath } from "../../helpers/project.js";

/**
 * Idempotent `reactor-project-start`. Overrides the ph-clint auto-injected
 * version (user-defined commands win in `defineCli`'s command map) so that
 * calling start against an already-running workdir returns the existing
 * instance instead of failing with "Service has reached max instances (1)".
 *
 * The system prompt promises this behaviour ("idempotent and a no-op when
 * already running"): a start the Studio's preview pane makes and the agent's
 * explicit one never race into a stop/start dance. Ports and reloads are the
 * project's host data (`hosts/vetra`).
 */
export const reactorProjectStart = defineCommand({
  id: "reactor-project-start",
  description: "Start Reactor Project (idempotent)",
  inputSchema: z.object({
    workdir: z
      .string()
      .optional()
      .describe("Working directory for the service"),
  }),
  execute: async (input, context) => {
    const services = context.services;
    if (!services) throw new Error("No services configured");
 
    const resolvedWorkdir = await resolveReactorProjectPath(
      context.workdir,
      input.workdir,
    );

    const existing = services
      .list("reactor-project")
      .find(
        (s) =>
          s.workdir === resolvedWorkdir &&
          (s.status === "ready" || s.status === "starting"),
      );
    // The project the Studio's preview pane shows from now on, even when the
    // agent left `workdir` out (the workspace's only project).
    const data = {
      project: path.relative(context.workdir, resolvedWorkdir) || ".",
      projectPath: resolvedWorkdir,
    };
    if (existing) {
      return { text: formatStatus(existing), data };
    }

    try {
      const instanceId = await services.start("reactor-project", {
        workdir: resolvedWorkdir,
        cwd: resolvedWorkdir,
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
