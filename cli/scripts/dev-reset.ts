#!/usr/bin/env tsx
/**
 * `pnpm dev:reset`: wipe the dev Cli's state, `<workdir>/.ph/vetra` (logs,
 * agent memory, service state), for the `dev` script's workdir
 * (`../vetra-test` from the package root; `--workdir <dir>` names another).
 * The Studio switchboard's stores (its host's, under `${userData}/.ph/vetra`)
 * are not touched.
 *
 * Refuses while a process holds a file of the store open (a running
 * `pnpm dev` holds its agent memory): on POSIX by asking `lsof`, when it is
 * installed; on Windows by opening each file without sharing, which fails
 * while another handle is open. Neither OS refuses the delete itself.
 */
import { spawnSync } from "node:child_process";
import { closeSync, constants, existsSync, openSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const CLI_NAME = "vetra";

/** libuv's UV_FS_O_EXLOCK: on Windows an open with share mode 0, which fails
 * with EBUSY while any other handle on the file is open. Node does not export
 * the constant. */
const UV_FS_O_EXLOCK = 0x10000000;

function storeDir(argv: string[]): string {
  const i = argv.indexOf("--workdir");
  const workdir =
    i >= 0 && argv[i + 1] ? path.resolve(argv[i + 1]) : path.resolve(ROOT, "..", "vetra-test");
  return path.join(workdir, ".ph", CLI_NAME);
}

/** Pids holding files under `dir` open, per lsof; empty when lsof is missing. */
function lsofHolders(dir: string): string[] {
  const r = spawnSync("lsof", ["-t", "+D", dir], { encoding: "utf8", windowsHide: true });
  if (r.error) return [];
  return [...new Set(r.stdout.split(/\s+/).filter(Boolean))];
}

/** Files under `dir` another handle holds open (Windows). */
function busyFiles(dir: string): string[] {
  const busy: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath, entry.name);
    try {
      closeSync(openSync(file, constants.O_RDONLY | UV_FS_O_EXLOCK));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EBUSY") busy.push(path.relative(dir, file));
    }
  }
  return busy;
}

const store = storeDir(process.argv.slice(2));
if (!existsSync(store)) {
  console.log(`nothing to wipe — no store at ${store}`);
  process.exit(0);
}

const inUse =
  process.platform === "win32"
    ? busyFiles(store).map((f) => `${f} is open`)
    : lsofHolders(store).map((pid) => `pid ${pid} holds it`);
if (inUse.length > 0) {
  console.error(`✗ the store is in use (${inUse.join(", ")}): ${store}`);
  console.error("  Stop it first: Ctrl+C your `pnpm dev`, then re-run this.");
  process.exit(1);
}

console.log(`wiping ${store}`);
rmSync(store, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
console.log("✓ workspace store wiped — next `pnpm dev` starts clean");
