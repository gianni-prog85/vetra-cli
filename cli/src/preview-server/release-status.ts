/**
 * Decide whether a reactor-project needs a new release: compare the project's
 * current source content hash against the hash embedded in the latest published
 * version on the registry. Powers the Deploy section's "up to date" / "needs
 * release" indicator.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { resolveRegistryUrl } from "../cloud/registry-url.js";
import { getRegistryToken } from "../auth/renown.js";
import { fetchPackument } from "../cloud/registry-packument.js";
import {
  computeProjectContentHash,
  CONTENT_HASH_FIELD,
} from "../helpers/project-fingerprint.js";
import { projectRoot } from "../helpers/project.js";

export type ReleaseStatusResult =
  | {
      kind: "ok";
      packageName: string;
      localVersion: string | null;
      publishedVersion: string | null;
      upToDate: boolean;
      needsRelease: boolean;
      reason: "never-published" | "no-baseline" | "content-changed" | "up-to-date";
    }
  | { kind: "unknown-project"; error: string }
  | { kind: "no-package"; error: string }
  | { kind: "unknown"; error: string };

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** The release status of the project the Cli works in (the workdir). */
export async function checkReleaseStatus(opts: {
  workdir: string;
  /** Registry override (query param > configured default); the resolver applies
   * the rest of the precedence (env > project config > built-in default). */
  registryUrl?: string;
  renownUrl: string;
}): Promise<ReleaseStatusResult> {
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
  const packument = await fetchPackument(registryUrl, packageName, token);

  const ok = (
    publishedVersion: string | null,
    upToDate: boolean,
    reason: "never-published" | "no-baseline" | "content-changed" | "up-to-date",
  ): ReleaseStatusResult => ({
    kind: "ok",
    packageName,
    localVersion,
    publishedVersion,
    upToDate,
    needsRelease: !upToDate,
    reason,
  });

  if (packument.kind === "not-found") {
    return ok(null, false, "never-published");
  }
  if (packument.kind === "auth-required") {
    return {
      kind: "unknown",
      error: `registry requires auth (HTTP ${packument.status})`,
    };
  }
  if (packument.kind === "error") {
    return { kind: "unknown", error: packument.reason };
  }

  const latest = packument.latest;
  const latestVersion = latest ? packument.versions[latest] : undefined;
  if (!latest || !latestVersion) {
    return ok(null, false, "never-published");
  }

  const ph = latestVersion.powerhouse;
  const rawHash = ph?.[CONTENT_HASH_FIELD];
  const publishedHash = typeof rawHash === "string" ? rawHash : null;
  if (!publishedHash) {
    return ok(latest, false, "no-baseline");
  }

  const upToDate = publishedHash === currentHash;
  return ok(latest, upToDate, upToDate ? "up-to-date" : "content-changed");
}
