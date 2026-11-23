/**
 * `GET /resolve` — given the `doc` id/slug a session extracted from its chat
 * history, return the live preview URL in the project's run (the project the
 * Cli works in) or a state code the editor can render.
 *
 * `home` (no doc, no drive) asks for the project's preview drive root — the
 * Connect drive view the Studio shows from the moment the project's preview
 * is up until the agent first shares a screen.
 *
 * Read-only. Never mutates ServiceManager state. The `/start` handler is the
 * sole mutator.
 */
import type { ServiceManager } from "@powerhousedao/clint";
import { projectRoot } from "../helpers/project.js";
import {
  buildPreviewDocPath,
  buildPreviewDriveRootPath,
  driveRemoteUrl,
  previewDriveIdOf,
} from "../helpers/reactor-project-preview.js";
import type { ResolveResult } from "./config.js";

export async function resolvePreview(args: {
  services: ServiceManager;
  workdir: string;
  doc: string;
  drive?: string;
  /** No doc or drive: the preview drive's root (see the module comment). */
  home?: boolean;
}): Promise<ResolveResult> {
  if (!args.drive && !args.doc && !args.home) return { kind: "no-target" };

  let projectPath: string;
  try {
    projectPath = await projectRoot(args.workdir);
  } catch (err) {
    return {
      kind: "unknown-project",
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const instance = args.services
    .list("reactor-project")
    .find((i) => i.workdir === projectPath);

  const stopped = (): ResolveResult => ({ kind: "project-stopped", projectPath });
  if (!instance) return stopped();
  // The preview drive's id comes with the run record, once it is live.
  const defaultDriveId = previewDriveIdOf(instance);
  const targetDriveId = args.drive ?? defaultDriveId;
  const starting = (): ResolveResult => ({
    kind: "starting",
    projectPath,
    ...(targetDriveId ? { driveId: targetDriveId } : {}),
  });
  if (instance.status === "starting") return starting();
  if (instance.status !== "ready") return stopped();

  const connectUrl = instance.endpoints?.["vetra-studio"];
  if (!connectUrl) return starting();

  const base = connectUrl.replace(/\/+$/, "");

  if (args.drive) {
    // Append the drive's remote URL so Connect registers the ad-hoc app drive
    // via addRemoteDrive on load; otherwise it bounces to the drive picker.
    const switchboardUrl = instance.endpoints?.["vetra-switchboard"];
    const docPath = buildPreviewDriveRootPath(
      args.drive,
      switchboardUrl ? driveRemoteUrl(switchboardUrl, args.drive) : undefined,
    );
    return {
      kind: "ready",
      projectPath,
      driveId: args.drive,
      documentId: args.drive,
      url: `${base}${docPath}`,
    };
  }

  // The preview drive is Connect's own drive: no remote URL to register.
  if (!defaultDriveId) return starting();
  const docPath = args.doc
    ? buildPreviewDocPath(defaultDriveId, args.doc)
    : buildPreviewDriveRootPath(defaultDriveId);
  return {
    kind: "ready",
    projectPath,
    driveId: defaultDriveId,
    documentId: args.doc || defaultDriveId,
    url: `${base}${docPath}`,
  };
}
