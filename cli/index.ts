// The package's ./cli export (`ph build` builds it to dist/node/cli/index.mjs):
// the Cli a host runner loads, and what bin/vetra.mjs runs. The startup guards
// come first so they run before the Cli's import graph, on either path.
import "./src/ensure-node-version.js";
import "./src/ensure-home.js";
import "./src/allow-fresh-deps.js";
import "./src/version-banner.js";

export { cli } from "./src/cli.js";
export { ensureModelAuth } from "./src/setup-auth.js";
