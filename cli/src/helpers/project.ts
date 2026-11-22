import { stat } from "node:fs/promises";
import path from "node:path";

/**
 * The project the Cli works in: its workdir, which must be a Reactor Package
 * (a `powerhouse.config.json`). Studio runs inside one project; there is no
 * project to pick and none to discover under the workdir.
 */
export async function projectRoot(workdir: string): Promise<string> {
  if (await pathExists(path.join(workdir, "powerhouse.config.json"))) {
    return workdir;
  }
  throw new Error(
    [
      `The workdir is not a Reactor Package project (no powerhouse.config.json at ${workdir}).`,
      "Studio works inside one project: run it in the project's folder (a new one starts with ph init).",
    ].join("\n"),
  );
}

/**
 * Refuse a project that was never installed: no `node_modules` means no
 * installed toolchain, so codegen would fetch `ph-cli` from the public
 * registry (and 404). Used by the spec commands that write into or generate
 * from the project.
 */
export async function assertProjectInstalled(base: string): Promise<void> {
  if (await pathExists(path.join(base, "node_modules"))) return;
  throw new Error(
    [
      `The project is not installed (no node_modules at ${base}).`,
      "Install it (pnpm install in its folder) before writing or generating specs; never hand-write its files.",
    ].join("\n"),
  );
}

export async function pathExists(p: string): Promise<boolean> {
  return stat(p).then(
    () => true,
    () => false,
  );
}
