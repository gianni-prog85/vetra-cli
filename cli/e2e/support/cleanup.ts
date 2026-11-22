import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { killTree } from "@powerhousedao/host-core/kill-tree";
import { CACHE_DIR, REPO_ROOT, type RunFile, homeFor, phCliEntry, stackEnv } from "./target.js";

/** The studio compound's own-process members (the Cli runs in its process). */
export const STUDIO_MEMBERS = ["switchboard", "connect"] as const;

const STOP_WAIT_MS = 30_000;
const STOP_COMMAND_MS = 90_000;

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** `ph-cli run studio --stop` under the run's data dir; its output is echoed. */
function runStop(tmp: string): Promise<number | null> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [phCliEntry(), "run", "studio", "--stop"], {
      cwd: REPO_ROOT,
      env: stackEnv(tmp),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const timer = setTimeout(() => {
      console.log("[e2e] ph-cli run studio --stop did not end; killing it");
      child.kill();
    }, STOP_COMMAND_MS);
    const echo = (chunk: Buffer) => process.stdout.write(`[e2e] ${chunk.toString()}`);
    child.stdout.on("data", echo);
    child.stderr.on("data", echo);
    child.on("error", (err) => {
      console.log(`[e2e] ph-cli run studio --stop: ${err.message}`);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

/** Stops the run's stack (`--stop`, then a tree kill of whatever still runs
 * after 30 s), saves its logs to `.cache/service-logs` and removes its temp
 * dir. Nothing to do when attached. */
export async function stopStudio(run: RunFile): Promise<void> {
  if (!run.tmp) return;
  const tmp = run.tmp;
  const members = { ...memberPids(tmp, STUDIO_MEMBERS), ...run.members };
  const pids = [...(run.pid ? [run.pid] : []), ...Object.values(members)];
  console.log(
    `[e2e] stopping studio: pid ${run.pid ?? "-"}, members ${JSON.stringify(members)}`,
  );
  if (pids.some(alive)) await runStop(tmp);
  const left = await waitGone(pids, STOP_WAIT_MS);
  if (left.length > 0) {
    console.log(`[e2e] still running after ${STOP_WAIT_MS} ms, killing trees: ${left.join(", ")}`);
    killTrees(left);
    const survivors = await waitGone(left, 5_000);
    if (survivors.length > 0) console.log(`[e2e] could not kill: ${survivors.join(", ")}`);
  }

  collectServiceLogs(
    [
      { label: "ph", dir: path.join(tmp, ".ph", "services") },
      { label: "home", dir: path.join(homeFor(tmp), ".ph") },
    ],
    path.join(CACHE_DIR, "service-logs"),
  );
  if (process.env.VETRA_E2E_KEEP_WORKDIR) {
    console.log(`[e2e] kept temp dir for inspection: ${tmp}`);
    return;
  }
  // Windows may hold a file a moment past its process.
  rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
}

export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Waits until none of `pids` runs; returns the ones still running. */
export async function waitGone(
  pids: readonly number[],
  timeoutMs: number,
): Promise<number[]> {
  const deadline = Date.now() + timeoutMs;
  let left = pids.filter(alive);
  while (left.length > 0 && Date.now() < deadline) {
    await wait(250);
    left = left.filter(alive);
  }
  return left;
}

/** Last resort: each pid's whole tree (`taskkill /T /F` on Windows). A hard
 * kill leaves the stores as a crash does. */
export function killTrees(pids: readonly number[]): void {
  for (const pid of pids) {
    if (Number.isInteger(pid) && pid > 1) killTree(pid, "SIGKILL");
  }
}

/** Pids of the members' run records under `<userData>/.ph/run`, by member. */
export function memberPids(
  userData: string,
  members: readonly string[],
): Record<string, number> {
  const pids: Record<string, number> = {};
  for (const member of members) {
    try {
      const file = path.join(userData, ".ph", "run", `${member}.json`);
      const record = JSON.parse(readFileSync(file, "utf8")) as { pid?: unknown };
      if (typeof record.pid === "number") pids[member] = record.pid;
    } catch {
      // no record
    }
  }
  return pids;
}

/** Copy every `*.log` under each root into `dest`, flattened, so they reach
 * CI artifacts before the temp dir goes. */
export function collectServiceLogs(
  roots: readonly { label: string; dir: string }[],
  dest: string,
): void {
  for (const { label, dir } of roots) {
    if (!existsSync(dir)) continue;
    const walk = (current: string): void => {
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".log")) {
          mkdirSync(dest, { recursive: true });
          // Characters CI artifact upload rejects (e.g. ':') become '_'.
          const rel = `${label}_${path.relative(dir, full)}`.replace(
            /[/\\:<>"|*?\r\n]/g,
            "_",
          );
          try {
            copyFileSync(full, path.join(dest, rel));
          } catch {
            /* ignore */
          }
        }
      }
    };
    walk(dir);
  }
}
