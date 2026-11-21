// The package this module ships in: the nearest package.json with a name and
// version above it. The source (`cli/src/`) and the build (`dist/node/...`)
// sit at different depths, so no fixed `..` count works for both. No
// framework import: version-banner.ts reads it before the import graph loads.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface OwnPackage {
  /** The package root (the directory of its package.json). */
  root: string;
  name: string;
  version: string;
}

export function readOwnPackage(): OwnPackage {
  const start = path.dirname(fileURLToPath(import.meta.url));
  for (let dir = start; ; dir = path.dirname(dir)) {
    const file = path.join(dir, "package.json");
    if (existsSync(file)) {
      const raw = JSON.parse(readFileSync(file, "utf8")) as {
        name?: unknown;
        version?: unknown;
      };
      if (typeof raw.name === "string" && typeof raw.version === "string") {
        return { root: dir, name: raw.name, version: raw.version };
      }
    }
    if (path.dirname(dir) === dir) {
      throw new Error(`No package.json with a name and version above ${start}`);
    }
  }
}
