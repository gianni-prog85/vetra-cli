import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/** A program and its leading arguments, for `execFile` (no shell). */
export interface BinCommand {
  file: string;
  args: string[];
}

/**
 * How to start a project's `node_modules/.bin/<name>` without a shell; null
 * when the project lacks it. On POSIX that is the shim itself. On Windows the
 * shims cannot be started by `execFile`: the extensionless one is a sh script
 * (ENOENT) and `.cmd` needs a shell (EINVAL). There this node runs the
 * package's own JS bin, which is what the shim does.
 */
export function projectBin(
  root: string,
  name: string,
  pkg: string = name,
  platform: NodeJS.Platform = process.platform,
): BinCommand | null {
  const shim = path.join(root, "node_modules", ".bin", name);
  if (!existsSync(shim)) return null;
  if (platform !== "win32") return { file: shim, args: [] };
  const entry = packageBin(path.join(root, "node_modules", pkg), name);
  return entry ? { file: process.execPath, args: [entry] } : null;
}

/** The absolute path of `name` in the `bin` of the package at `dir`. */
function packageBin(dir: string, name: string): string | undefined {
  try {
    const { bin } = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")) as {
      bin?: string | Record<string, string>;
    };
    const rel = typeof bin === "string" ? bin : bin?.[name];
    return rel ? path.join(dir, rel) : undefined;
  } catch {
    return undefined;
  }
}
