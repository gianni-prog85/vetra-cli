// Side-effecting startup banner. Imported first by cli/index.ts so it logs the
// running vetra version before the rest of the import graph evaluates —
// a crash in a downstream import (e.g. a mismatched clint dependency)
// still leaves the version in the logs. Reads package.json directly to avoid
// importing clint.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_PH_VERSION } from './ph-version.gen.js';

/** The nearest package.json above this module with a name and version: the
 * source (`cli/src/`) and the build (`dist/node/...`) sit at different depths. */
function readOwnPackage(): { name: string; version: string } {
  const start = path.dirname(fileURLToPath(import.meta.url));
  for (let dir = start; ; dir = path.dirname(dir)) {
    const file = path.join(dir, 'package.json');
    if (existsSync(file)) {
      const raw = JSON.parse(readFileSync(file, 'utf8')) as {
        name?: unknown;
        version?: unknown;
      };
      if (typeof raw.name === 'string' && typeof raw.version === 'string') {
        return { name: raw.name, version: raw.version };
      }
    }
    if (path.dirname(dir) === dir) {
      throw new Error(`No package.json with a name and version above ${start}`);
    }
  }
}

const pkg = readOwnPackage();

export const VETRA_CLI_VERSION = pkg.version;

console.log(`${pkg.name} v${pkg.version} (ph ${DEFAULT_PH_VERSION})`);
