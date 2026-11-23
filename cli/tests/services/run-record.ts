/** The run record of a Preview run (`ph run @powerhousedao/vetra-cli/preview dev`). */
import { readFileSync } from "node:fs";
import { runRecordSchema, type RunRecord } from "@powerhousedao/host-core";
import { previewEndpoints } from "../../src/services/reactor-project.js";

export function recordFixture(): RunRecord {
  const raw = readFileSync(new URL("./vetra-run-record.json", import.meta.url), "utf8");
  return runRecordSchema.parse(JSON.parse(raw));
}

/** The endpoints a ready instance of that run reports (`services.list()`). */
export function recordedEndpoints(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(previewEndpoints(recordFixture())).map(([name, e]) => [name, e.url]),
  );
}
