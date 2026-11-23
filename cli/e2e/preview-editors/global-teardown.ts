import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { alive, killTrees, waitGone } from "../support/cleanup.js";
import { STUDIO_REF, phCliEntry } from "../support/target.js";
import { PREVIEW_RUN_FILE, readPreviewRun } from "./run.js";

const STOP_COMMAND_MS = 120_000;
const STOP_WAIT_MS = 60_000;

/** `ph-cli run @powerhousedao/vetra-cli/studio serve --stop` in the project. */
function runStop(project: string): Promise<void> {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [phCliEntry(project), "run", STUDIO_REF, "serve", "--stop"],
      {
        cwd: project,
        env: { ...process.env, PORTLE_AUTOSTART: "0" },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    const timer = setTimeout(() => child.kill(), STOP_COMMAND_MS);
    const echo = (chunk: Buffer) =>
      process.stdout.write(`[preview-editors] ${chunk.toString()}`);
    child.stdout.on("data", echo);
    child.stderr.on("data", echo);
    child.on("error", () => undefined);
    child.on("close", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/** Stops the stack global-setup started (by its ref; its process tree as the
 * last resort). An attached Studio is left running. */
export default async function globalTeardown(): Promise<void> {
  const run = readPreviewRun();
  if (!run) return;
  if (run.pid !== null) {
    if (alive(run.pid)) await runStop(run.project);
    const left = await waitGone([run.pid], STOP_WAIT_MS);
    if (left.length > 0) {
      console.log(
        `[preview-editors] still running, killing the tree of ${left.join(", ")}`,
      );
      killTrees(left);
    }
  }
  rmSync(PREVIEW_RUN_FILE, { force: true });
}
