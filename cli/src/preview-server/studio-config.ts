/**
 * `studio.config.json`: what the Studio tab learns from the Cli — where the
 * local API listens and which origin the Studio is — served by the Studio's
 * Connect (`runner.serveFiles` in `hosts/connect`) from
 * `${userData}/.ph/vetra/studio.config.json`, read per request. The Cli
 * writes it once its local API listens and removes it at its end, so a tab
 * never reads another Studio's address (each project has its own file and the
 * local API its own OS port).
 */
import fs from "node:fs";
import path from "node:path";
import { defaultUserDataDir } from "@powerhousedao/host-core";
import { environmentIdOf } from "../auth/studio-mode.js";
import { findRegistryUrl, stackRegistry } from "../cloud/registry-url.js";
import type { Config } from "../framework.js";
import { STUDIO_DIR } from "../helpers/studio-paths.js";
import { originOf } from "./request-auth.js";

export interface StudioConfig {
  /** The local API's base, `http://127.0.0.1:<port>`. */
  previewServerUrl: string;
  /** The Studio's origin (its Connect's): the `aud` of owner bearers. */
  studioOrigin?: string;
  /** The Studio drive's id. */
  studioDriveId?: string;
  /** A cloud Studio's environment document id. */
  environmentId?: string;
  /** The registry a cloud Studio's Deploy view stamps onto environments. */
  packageRegistryUrl?: string;
  /** The cloud switchboard a cloud Studio's Deploy view talks to. */
  cloudSwitchboardUrl?: string;
}

/**
 * Where the Connect host reads the file: `${userData}/.ph/vetra/`, with
 * `${userData}` resolved as the host runners do (`PH_USER_DATA_DIR`, else the
 * project root, the directory `ph run` runs in).
 */
export function studioConfigPath(
  env: Record<string, string | undefined> = process.env,
  projectRoot: string = process.cwd(),
): string {
  return path.join(defaultUserDataDir(projectRoot, env), STUDIO_DIR, "studio.config.json");
}

/**
 * The file's content for a local API at `previewServerUrl`. A cloud Studio
 * (an environment id) also names its environment, cloud switchboard and
 * registry (`registryUrl`, `PH_REGISTRY_URL`, the project's config, else the
 * cloud stack's own).
 */
export function studioConfigFor(args: {
  previewServerUrl: string;
  /** The Studio's URL (its Connect member's), when known. */
  studioUrl?: string;
  studioDriveId?: string;
  config: Pick<Config, "environmentId" | "registryUrl" | "cloudSwitchboardUrl">;
  /** The project, for its `powerhouse.config.json` registry. */
  workdir: string;
  env?: Record<string, string | undefined>;
}): StudioConfig {
  const env = args.env ?? process.env;
  const studioOrigin = originOf(args.studioUrl);
  const result: StudioConfig = {
    previewServerUrl: args.previewServerUrl,
    ...(studioOrigin ? { studioOrigin } : {}),
    ...(args.studioDriveId ? { studioDriveId: args.studioDriveId } : {}),
  };
  const environmentId = environmentIdOf(args.config, env);
  if (!environmentId) return result;
  const cloudSwitchboardUrl = args.config.cloudSwitchboardUrl?.trim() || undefined;
  const packageRegistryUrl =
    findRegistryUrl({ registry: args.config.registryUrl, projectPath: args.workdir, env }) ??
    stackRegistry(cloudSwitchboardUrl);
  return {
    ...result,
    environmentId,
    ...(cloudSwitchboardUrl ? { cloudSwitchboardUrl } : {}),
    ...(packageRegistryUrl ? { packageRegistryUrl } : {}),
  };
}

/** Writes `config` to `file` whole (temp file, then rename). */
export function writeStudioConfig(file: string, config: StudioConfig): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

/** Removes the file when it still names `previewServerUrl` (this Cli's). */
export function removeStudioConfig(file: string, previewServerUrl: string): void {
  try {
    const current = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<StudioConfig>;
    if (current.previewServerUrl !== previewServerUrl) return;
  } catch {
    return;
  }
  fs.rmSync(file, { force: true });
}
