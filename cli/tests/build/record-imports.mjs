// `node --import` hook for start-path-imports.test.ts: writes the URL of every
// module the process loads (ESM and CJS) to RECORD_IMPORTS_OUT, one per line.
import { writeFileSync } from "node:fs";
import { registerHooks } from "node:module";

const loaded = [];
registerHooks({
  load(url, context, nextLoad) {
    loaded.push(url);
    return nextLoad(url, context);
  },
});
process.on("exit", () => {
  writeFileSync(process.env.RECORD_IMPORTS_OUT, loaded.join("\n"));
});
