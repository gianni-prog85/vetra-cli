import { readFileSync } from "node:fs";
import path from "node:path";
import { CACHE_DIR, E2E_DIR } from "../support/target.js";

/** Written by global-setup: where the Studio of the project under check is. */
export const PREVIEW_RUN_FILE = path.join(
  CACHE_DIR,
  "preview-editors-run.json",
);
/** The stack's output when this check started it. */
export const PREVIEW_STUDIO_LOG = path.join(
  CACHE_DIR,
  "preview-editors-studio.log",
);

export interface PreviewRun {
  baseUrl: string | null;
  driveId: string | null;
  /** The `ph-cli run @powerhousedao/vetra-cli/studio` process; null when attached. */
  pid: number | null;
  project: string;
}

export function readPreviewRun(): PreviewRun | undefined {
  try {
    return JSON.parse(readFileSync(PREVIEW_RUN_FILE, "utf8")) as PreviewRun;
  } catch {
    return undefined;
  }
}

/** The project under check: `VETRA_PREVIEW_PROJECT`, an installed Reactor
 * Package project that has this package. */
export function previewProject(): string {
  const project = process.env.VETRA_PREVIEW_PROJECT;
  if (!project) {
    throw new Error(
      "VETRA_PREVIEW_PROJECT is not set: give the path of the project to check",
    );
  }
  return path.resolve(project);
}

/** Where the screenshots go: `VETRA_PREVIEW_SHOTS`, else the test results. */
export function shotsDir(): string {
  return path.resolve(
    process.env.VETRA_PREVIEW_SHOTS ??
      path.join(E2E_DIR, "test-results", "preview-editors"),
  );
}

/** A screenshot's path: `VETRA_PREVIEW_SHOT_PREFIX` before `name`. */
export function shotPath(name: string): string {
  const prefix = process.env.VETRA_PREVIEW_SHOT_PREFIX ?? "";
  return path.join(shotsDir(), `${prefix}${name}.png`);
}
