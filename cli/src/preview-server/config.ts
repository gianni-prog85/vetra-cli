/**
 * Preview-server configuration.
 *
 * The server runs alongside the vetra daemon and gives the embedded
 * vetra-studio editor a way to resolve, on each render, the live URL of the
 * currently previewed reactor-project document — and to start the project if
 * it isn't running yet. It listens on an OS port, so two Studios on one
 * machine never share one; the tab reads the address from
 * `studio.config.json` (see `studio-config.ts`).
 */
export const DEFAULT_PREVIEW_SERVER_PORT = 0;

export const PREVIEW_SERVER_HOST = "127.0.0.1";

/** The workdir is no Reactor Package project: there is nothing to preview. */
type UnknownProject = { kind: "unknown-project"; error: string };

export type ResolveResult =
  | { kind: "no-target" }
  | UnknownProject
  | { kind: "project-stopped"; projectPath: string }
  /** Not running, and the project run is off (`projectRun`): no start. */
  | { kind: "preview-off" }
  /** `driveId`: absent until the run record names the preview drive. */
  | { kind: "starting"; projectPath: string; driveId?: string }
  | {
      kind: "ready";
      projectPath: string;
      driveId: string;
      documentId: string;
      /** The project's Connect, at the URL its run record gives. */
      url: string;
    };

/** `driveId`: the preview drive, absent until the run record names it. */
export type StartResult =
  | { kind: "started"; projectPath: string; instanceId: string; driveId?: string }
  | { kind: "already-running"; projectPath: string; instanceId: string; driveId?: string; status: "starting" | "ready" }
  | UnknownProject
  | { kind: "failed"; error: string };

export type SseEvent = {
  type:
    | "service:starting"
    | "service:ready"
    | "service:stopped"
    | "service:restarting"
    | "service:failed";
  instanceId?: string;
  workdir?: string;
  driveId?: string;
  error?: string;
};
