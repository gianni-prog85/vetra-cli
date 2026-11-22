/**
 * Whether a deploy follow-target is the deploy of the project the Studio runs
 * in (pure, unit-testable). A `reactor-project-publish` is; a
 * `deploy-environment-update --addPackage` install is when the package is
 * the project's own (matched against its resolved package name).
 *
 * Returns `null` while that can't be told yet (the package data hasn't
 * loaded); `false` for a package that isn't the project's (an external dep).
 */
import type { ProjectPackageInfo } from "./useProjectPackageInfo.js";
import type { DeployTarget } from "../hooks/useSessionDeployTarget.js";

export function resolveDeployProject(
  target: DeployTarget,
  /** The project's package; undefined while loading, null when it has none. */
  pkg: ProjectPackageInfo | null | undefined,
): boolean | null {
  if (target.publish) return true;
  if (!target.packageName) return false;
  if (pkg === undefined) return null;
  return pkg?.name === target.packageName;
}
