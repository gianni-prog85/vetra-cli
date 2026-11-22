import { rmSync } from "node:fs";
import { stopStudio } from "./cleanup.js";
import { RUN_FILE, readRunFile } from "./target.js";

/** Stops the stack global-setup booted (`ph-cli run
 * @powerhousedao/vetra-cli/studio --stop` by its ref, a tree kill as the last
 * resort), keeps its logs and removes its temp dir. */
export default async function globalTeardown(): Promise<void> {
  const run = readRunFile();
  if (!run) return;
  await stopStudio(run);
  // Its pids are stale now: a later run must not act on them.
  rmSync(RUN_FILE, { force: true });
}
