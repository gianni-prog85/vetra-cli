// Side-effecting startup banner. Imported first by cli/index.ts so it logs the
// running vetra version before the rest of the import graph evaluates —
// a crash in a downstream import (e.g. a mismatched clint dependency)
// still leaves the version in the logs. Reads package.json directly to avoid
// importing clint.
import { readOwnPackage } from './own-package.js';
import { DEFAULT_PH_VERSION } from './ph-version.gen.js';

const pkg = readOwnPackage();

export const VETRA_CLI_VERSION = pkg.version;

console.log(`${pkg.name} v${pkg.version} (ph ${DEFAULT_PH_VERSION})`);
