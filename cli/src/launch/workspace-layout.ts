/**
 * The cloud Studio's workspace layout, which the product layer (launch,
 * versions, rollback, the upgrade of older Studios) keeps until Labs replaces
 * it (plan decision D8): a workspace whose Reactor Package projects are its
 * immediate subfolders. The rest of the Cli works in one project, the
 * workdir; in such a Studio there are no project subfolders, and the product
 * layer is unreachable there anyway (no product document is ever created).
 */
import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { pathExists } from "../helpers/project.js";

/**
 * Immediate subfolders of `workdir` that are Reactor packages (have a
 * `powerhouse.config.json`), by name. One `readdir` with `withFileTypes`.
 */
export async function workspaceProjectDirs(workdir: string): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(workdir, { withFileTypes: true });
  } catch {
    return [];
  }
  const checks = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map(async (e) =>
      (await pathExists(path.join(workdir, e.name, "powerhouse.config.json")))
        ? e.name
        : null,
    );
  return (await Promise.all(checks))
    .filter((n): n is string => n !== null)
    .sort();
}
