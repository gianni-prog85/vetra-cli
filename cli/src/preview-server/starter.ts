/**
 * `POST /start` — idempotently bring the project's run online
 * (`POST /restart` stops it first, see `restartPreview`). The project is the
 * one the Cli works in (the workdir).
 *
 * Side-effecty. Triggered by the browser on `project-stopped`; can also be
 * called by the agent (the `reactor-project-start` command is equivalent).
 * When an instance for the project is already `starting` or `ready`, we
 * return the existing instance without spawning a second one.
 */
import type { ServiceManager } from "@powerhousedao/clint";
import { projectRoot } from "../helpers/project.js";
import { previewDriveIdOf } from "../helpers/reactor-project-preview.js";
import type { StartResult } from "./config.js";

/** The project the start acts on, or the refusal when the workdir is none. */
async function projectOf(
  workdir: string,
): Promise<{ projectPath: string } | Extract<StartResult, { kind: "unknown-project" }>> {
  try {
    return { projectPath: await projectRoot(workdir) };
  } catch (err) {
    return {
      kind: "unknown-project",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function startPreview(args: {
  services: ServiceManager;
  workdir: string;
}): Promise<StartResult> {
  const project = await projectOf(args.workdir);
  if ("kind" in project) return project;
  const { projectPath } = project;

  const existing = args.services
    .list("reactor-project")
    .find(
      (i) =>
        i.workdir === projectPath &&
        (i.status === "ready" || i.status === "starting"),
    );
  if (existing) {
    const driveId = previewDriveIdOf(existing);
    return {
      kind: "already-running",
      projectPath,
      instanceId: existing.instanceId ?? "",
      ...(driveId ? { driveId } : {}),
      status: existing.status as "starting" | "ready",
    };
  }

  return spawn(args, projectPath);
}

async function spawn(
  args: { services: ServiceManager },
  projectPath: string,
): Promise<StartResult> {
  try {
    const instanceId = await args.services.start("reactor-project", {
      workdir: projectPath,
      cwd: projectPath,
    });
    // Ready: the run record named the preview drive.
    const ready = args.services
      .list("reactor-project")
      .find((i) => i.instanceId === instanceId);
    const driveId = ready ? previewDriveIdOf(ready) : undefined;
    return {
      kind: "started",
      projectPath,
      instanceId,
      ...(driveId ? { driveId } : {}),
    };
  } catch (err) {
    return {
      kind: "failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Instance states a restart stops (one stuck `starting` included). */
const RUNNING = new Set(["starting", "ready"]);

/** Restarts in flight, per project path: overlapping calls share one. */
const restarts = new Map<string, Promise<StartResult>>();
/** Requests in flight, per workdir (before the path is known). */
const requests = new Map<string, Promise<StartResult>>();

/**
 * `POST /restart` — stop the project's running instances (including one
 * stuck `starting`) and start a fresh one. Overlapping restarts share a
 * single restart.
 */
export function restartPreview(args: {
  services: ServiceManager;
  workdir: string;
}): Promise<StartResult> {
  // Keyed before any await, so a second call can't slip past the first.
  const key = args.workdir;
  const pending = requests.get(key);
  if (pending) return pending;
  const request = restartProject(args).finally(() => requests.delete(key));
  requests.set(key, request);
  return request;
}

async function restartProject(args: {
  services: ServiceManager;
  workdir: string;
}): Promise<StartResult> {
  const project = await projectOf(args.workdir);
  if ("kind" in project) return project;
  const { projectPath } = project;

  const inFlight = restarts.get(projectPath);
  if (inFlight) return inFlight;
  const restart = stopThenSpawn(args, projectPath).finally(() => {
    restarts.delete(projectPath);
  });
  restarts.set(projectPath, restart);
  return restart;
}

async function stopThenSpawn(
  args: { services: ServiceManager },
  projectPath: string,
): Promise<StartResult> {
  const running = (instanceId?: string) =>
    args.services
      .list("reactor-project")
      .filter(
        (i) =>
          i.workdir === projectPath &&
          RUNNING.has(i.status) &&
          (instanceId === undefined || i.instanceId === instanceId),
      );
  for (const instance of running()) {
    try {
      await args.services.stop("reactor-project", instance.instanceId);
    } catch (err) {
      // Already stopping or gone meanwhile: nothing left to stop.
      if (running(instance.instanceId).length === 0) continue;
      return {
        kind: "failed",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
  return spawn(args, projectPath);
}
