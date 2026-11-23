/**
 * `GET /preview/status` — why the Preview run is or is not there, in words
 * the Studio shows. Read-only: it starts nothing.
 *
 * `unavailable` is a start that would be refused (the workdir is no project,
 * or one of the run's preflight checks fails); `failed` is a run that
 * started and ended in an error.
 */
import type { PreflightContext, ServiceManager } from "@powerhousedao/clint";
import { projectRoot } from "../helpers/project.js";
import { reactorProject } from "../services/reactor-project.js";

export type PreviewStatus =
  | { kind: "ready" }
  | { kind: "starting" }
  | { kind: "stopped" }
  | { kind: "unavailable"; reason: string; hint?: string }
  | { kind: "failed"; error: string };

/** The first preflight check of the Preview run that `projectPath` fails. */
export async function previewPreflight(
  projectPath: string,
): Promise<{ reason: string; hint?: string } | undefined> {
  const ctx: PreflightContext = {
    cwd: projectPath,
    config: {},
    command: "",
  };
  for (const check of reactorProject.preflight ?? []) {
    const result = await (
      check as (c: PreflightContext) => ReturnType<typeof check>
    )(ctx);
    if (!result.ok) {
      return {
        reason: result.message,
        ...(result.hint ? { hint: result.hint } : {}),
      };
    }
  }
  return undefined;
}

export async function previewStatus(args: {
  services: Pick<ServiceManager, "list">;
  workdir: string;
}): Promise<PreviewStatus> {
  let projectPath: string;
  try {
    projectPath = await projectRoot(args.workdir);
  } catch (err) {
    const [reason, hint] = (
      err instanceof Error ? err.message : String(err)
    ).split("\n");
    return { kind: "unavailable", reason, ...(hint ? { hint } : {}) };
  }

  const instances = args.services
    .list("reactor-project")
    .filter((i) => i.workdir === projectPath);
  if (instances.some((i) => i.status === "ready")) return { kind: "ready" };
  if (instances.some((i) => i.status === "starting"))
    return { kind: "starting" };

  const refused = await previewPreflight(projectPath);
  if (refused) return { kind: "unavailable", ...refused };

  const failed = instances.find((i) => i.status === "failed");
  if (failed) {
    return { kind: "failed", error: failed.error ?? "The Preview run failed." };
  }
  return { kind: "stopped" };
}
