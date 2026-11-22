/**
 * Read the project's package identity (name + version) from its
 * package.json: the project the Cli works in (the workdir). Powers the
 * project home's header and the Deploy section's read-only package display.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { projectRoot } from "../helpers/project.js";

export type ProjectPackageResult =
  | { kind: "ok"; name: string; version: string }
  | { kind: "unknown-project"; error: string }
  | { kind: "no-package"; error: string };

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function readProjectPackage(
  workdir: string,
): Promise<ProjectPackageResult> {
  let projectPath: string;
  try {
    projectPath = await projectRoot(workdir);
  } catch (err) {
    return { kind: "unknown-project", error: message(err) };
  }
  try {
    const raw = await readFile(path.join(projectPath, "package.json"), "utf-8");
    const json = JSON.parse(raw) as { name?: string; version?: string };
    if (!json.name) {
      return {
        kind: "no-package",
        error: `package.json in ${projectPath} has no "name" field.`,
      };
    }
    return { kind: "ok", name: json.name, version: json.version ?? "0.0.0" };
  } catch (err) {
    return { kind: "no-package", error: message(err) };
  }
}
