/**
 * Publish the project's package for the Deploy flow (the project the Cli works
 * in), using the same sequence the agent's `reactor-project-publish` runs (see
 * `publishReactorProject` in `commands/reactor-project/publish-core.ts`). Adds
 * the deploy-specific bits: skip the publish when the current source is
 * already the latest published version, otherwise pick the next free version
 * and let the shared core bump-and-retry on a registry conflict — so the
 * browser never has to.
 *
 * Publishing uses the agent's Renown identity (the studio "Authorize agent"
 * credential).
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { resolveRegistryUrl } from "../cloud/registry-url.js";
import { getRegistryToken } from "../auth/renown.js";
import { fetchPackument } from "../cloud/registry-packument.js";
import {
  nextPublishVersion,
  publishReactorProject,
} from "../commands/reactor-project/publish-core.js";
import {
  computeProjectContentHash,
  CONTENT_HASH_FIELD,
} from "../helpers/project-fingerprint.js";
import { projectRoot } from "../helpers/project.js";

export type PublishProjectResult =
  | {
      kind: "ok";
      packageName: string;
      version: string;
      registry: string;
      /** false when the source was already the latest published version. */
      published: boolean;
    }
  | { kind: "unknown-project"; error: string }
  | { kind: "no-package"; error: string }
  | { kind: "auth-required"; error: string }
  | { kind: "failed"; error: string };

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function publishProjectForDeploy(opts: {
  workdir: string;
  /** Registry override (query param > configured default); the resolver applies
   * the rest of the precedence (env > project config > built-in default). */
  registryUrl?: string;
  renownUrl: string;
}): Promise<PublishProjectResult> {
  const { workdir, registryUrl: registryOverride, renownUrl } = opts;

  let projectPath: string;
  try {
    projectPath = await projectRoot(workdir);
  } catch (err) {
    return { kind: "unknown-project", error: message(err) };
  }

  let pkg: { name?: string; version?: string };
  try {
    const raw = await readFile(path.join(projectPath, "package.json"), "utf-8");
    pkg = JSON.parse(raw) as typeof pkg;
  } catch (err) {
    return { kind: "no-package", error: message(err) };
  }
  if (!pkg.name) {
    return { kind: "no-package", error: 'package.json has no "name" field.' };
  }
  const packageName = pkg.name;
  const localVersion = pkg.version ?? null;

  const currentHash = await computeProjectContentHash(projectPath);
  const registryUrl = resolveRegistryUrl({
    registry: registryOverride,
    projectPath,
  });
  const token = await getRegistryToken(workdir, renownUrl, registryUrl);
  if (!token) {
    return {
      kind: "auth-required",
      error:
        'Agent not authorized to publish. Authorize the agent (the studio "Authorize agent" button, or `ph login`), then retry.',
    };
  }

  const packument = await fetchPackument(registryUrl, packageName, token);
  if (packument.kind === "auth-required") {
    return {
      kind: "auth-required",
      error: `Registry requires auth (HTTP ${packument.status}).`,
    };
  }
  if (packument.kind === "error") {
    return { kind: "failed", error: packument.reason };
  }

  const versions = packument.kind === "ok" ? packument.versions : {};
  const latest = packument.kind === "ok" ? packument.latest : null;
  const latestVersion = latest ? versions[latest] : undefined;
  const rawHash = latestVersion?.powerhouse?.[CONTENT_HASH_FIELD];
  const publishedHash = typeof rawHash === "string" ? rawHash : null;

  // Source already matches the latest published version — skip the publish and
  // let the caller install that version.
  if (latest && publishedHash && publishedHash === currentHash) {
    return {
      kind: "ok",
      packageName,
      version: latest,
      registry: registryUrl,
      published: false,
    };
  }

  // Same publish sequence the agent uses; bump-and-retry resolves a stale-
  // packument version collision without surfacing it to the user.
  const result = await publishReactorProject({
    projectPath,
    workdir,
    renownUrl,
    registry: registryOverride,
    version: nextPublishVersion(localVersion, Object.keys(versions)),
    contentHash: currentHash,
    bumpOnConflict: true,
  });

  if (result.kind === "ok") {
    return {
      kind: "ok",
      packageName: result.packageName,
      version: result.version,
      registry: result.registry,
      published: true,
    };
  }
  if (result.kind === "auth-required") {
    return { kind: "auth-required", error: result.error };
  }
  if (result.kind === "no-package") {
    return { kind: "no-package", error: result.error };
  }
  return { kind: "failed", error: result.error };
}
