import { type ChildProcess, spawn } from "node:child_process";
import {
  createWriteStream,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";
import type { FullConfig } from "@playwright/test";
import { STUDIO_MEMBERS, memberPids, stopStudio } from "./cleanup.js";
import {
  CACHE_DIR,
  FIXTURE_PROJECT_NAME,
  FIXTURE_PROJECT_VERSION,
  PACKAGE_NAME,
  REPO_ROOT,
  RUN_FILE,
  type RunFile,
  STUDIO_LOG,
  STUDIO_REF,
  homeFor,
  loadFixture,
  phCliEntry,
  phCliRoot,
  projectFor,
  replayFixturePath,
  stackEnv,
} from "./target.js";

/** studioUrlTrigger prints this once the stack is up; whole lines only. */
const STUDIO_LINE = /Vetra Studio:\s*(http:\/\/\S+)\r?\n/;
const BOOT_TIMEOUT_MS = 240_000;

function writeRunFile(run: RunFile): void {
  writeFileSync(RUN_FILE, JSON.stringify(run, null, 2));
}

/** A folder link (a junction on Windows, which needs no privilege). */
function linkDir(target: string, link: string): void {
  mkdirSync(path.dirname(link), { recursive: true });
  symlinkSync(target, link, process.platform === "win32" ? "junction" : "dir");
}

/** The project a user runs Studio in, as small as it can be: a package.json,
 * a powerhouse.config.json, `.ph` ignored, and this package and its ph-cli
 * linked into node_modules (as an install would). */
function createFixtureProject(project: string): void {
  mkdirSync(project, { recursive: true });
  writeFileSync(
    path.join(project, "package.json"),
    `${JSON.stringify(
      {
        name: FIXTURE_PROJECT_NAME,
        version: FIXTURE_PROJECT_VERSION,
        private: true,
        type: "module",
        devDependencies: {
          [PACKAGE_NAME]: "*",
          "@powerhousedao/ph-cli": "*",
        },
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(path.join(project, "powerhouse.config.json"), "{}\n");
  writeFileSync(path.join(project, ".gitignore"), ".ph\nnode_modules\n");
  const scope = path.join(project, "node_modules", "@powerhousedao");
  linkDir(REPO_ROOT, path.join(scope, "vetra-cli"));
  linkDir(realpathSync(phCliRoot()), path.join(scope, "ph-cli"));
}

/** Boots `ph-cli run @powerhousedao/vetra-cli/studio` (switchboard, Connect
 * and the Cli in REPLAY mode) in a fixture project in a temp dir, as a user
 * runs it in theirs, and records the Studio URL, drive id and pids in
 * RUN_FILE; VETRA_E2E_BASE_URL attaches instead. */
export default async function globalSetup(_config: FullConfig): Promise<void> {
  mkdirSync(CACHE_DIR, { recursive: true });
  rmSync(RUN_FILE, { force: true });

  if (process.env.VETRA_E2E_BASE_URL) {
    const baseUrl = process.env.VETRA_E2E_BASE_URL.replace(/\/$/, "");
    // VETRA_E2E_DRIVE_ID skips redirect discovery — the caller already knows the
    // id (e.g. from the studio boot log), so attach doesn't need `/` -> 302.
    const driveId =
      process.env.VETRA_E2E_DRIVE_ID ?? (await discoverDriveId(baseUrl));
    writeRunFile({ baseUrl, driveId, pid: null, members: {}, tmp: null });
    return;
  }

  const fixture = loadFixture();
  const tmp = mkdtempSync(path.join(os.tmpdir(), "vetra-e2e-"));
  const project = projectFor(tmp);
  mkdirSync(homeFor(tmp), { recursive: true });
  createFixtureProject(project);
  const child = spawn(
    process.execPath,
    // The project's own ph-cli, the package's host: the Cli's workdir is the
    // project.
    [phCliEntry(project), "run", STUDIO_REF, "serve"],
    {
      cwd: project,
      // The stop stream: its end (this process ending too) stops the stack.
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      env: {
        ...stackEnv(tmp),
        PH_STOP_ON_STDIN: "1",
        // Under CI, picocolors/Vite colorize even non-TTY.
        NO_COLOR: "1",
        FORCE_COLOR: "0",
        // The pnpm store stays shared (content-addressed, concurrency-safe), so
        // an inner `ph init` install stays warm despite the isolated HOME.
        npm_config_store_dir:
          process.env.npm_config_store_dir ??
          path.join(os.tmpdir(), "vetra-e2e-pnpm-store"),
        VETRA_REACTOR_READINESS_TIMEOUT_MS:
          process.env.VETRA_REACTOR_READINESS_TIMEOUT_MS ?? "240000",
        VETRA_REPLAY_FIXTURE: replayFixturePath(fixture),
        // A placeholder is enough — replay never calls the model.
        VETRA_ANTHROPIC_API_KEY:
          process.env.VETRA_ANTHROPIC_API_KEY ?? "sk-ant-placeholder",
      },
    },
  );
  child.stdin.on("error", () => undefined);
  const run: RunFile = {
    baseUrl: null,
    driveId: null,
    pid: child.pid ?? null,
    members: {},
    tmp,
  };
  // Before the wait: a teardown after a runner crash still finds the stack.
  writeRunFile(run);
  // Tee everything to a file for the whole run (persists past the URL match).
  const logStream = createWriteStream(STUDIO_LOG);
  child.stdout.pipe(logStream);
  child.stderr.pipe(logStream);

  try {
    const url = new URL(await waitForStudio(child));
    const driveId = url.pathname.match(/\/d\/([^/?#]+)/)?.[1];
    if (!driveId) throw new Error(`Could not parse drive id from "${url.href}"`);
    run.baseUrl = url.origin;
    run.driveId = driveId;
    run.members = memberPids(project, STUDIO_MEMBERS);
    writeRunFile(run);
  } catch (err) {
    child.stdin.end();
    await stopStudio(run);
    rmSync(RUN_FILE, { force: true });
    throw err;
  }
  // The stack outlives globalSetup; global-teardown stops it.
  child.unref();
}

function waitForStudio(child: ChildProcess): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let buf = "";
    let settled = false;
    const onData = (chunk: Buffer) => {
      const text = chunk.toString();
      buf += stripVTControlCharacters(text);
      // Mirror boot output so a hang is debuggable in the Playwright log.
      process.stdout.write(text);
      const m = buf.match(STUDIO_LINE);
      if (m && !settled) {
        settled = true;
        cleanup();
        resolve(m[1].trim());
      }
    };
    const onExit = (code: number | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(
        new Error(
          `ph-cli run ${STUDIO_REF} exited (code ${code}) before the Studio was ready. ` +
            `See the boot log above and ${STUDIO_LOG}.`,
        ),
      );
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`Studio not ready within ${BOOT_TIMEOUT_MS}ms`));
    }, BOOT_TIMEOUT_MS);
    function cleanup() {
      clearTimeout(timer);
      child.stdout?.off("data", onData);
      child.stderr?.off("data", onData);
      child.off("exit", onExit);
    }
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.on("exit", onExit);
  });
}

async function discoverDriveId(baseUrl: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/`, {
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    throw new Error(
      `Could not reach VETRA_E2E_BASE_URL ${baseUrl} ` +
        `(${err instanceof Error ? err.message : String(err)}). ` +
        `Is a vetra studio running there in replay mode?`,
    );
  }
  const loc = res.headers.get("location") ?? "";
  const id = loc.match(/\/d\/([^/?#]+)/)?.[1];
  if (!id) {
    throw new Error(
      `${baseUrl}/ did not redirect to /d/<driveId> (got ${res.status} ${loc}): ` +
        `Connect does not redirect to the Studio drive. Set VETRA_E2E_DRIVE_ID to ` +
        `the id in the stack's "Vetra Studio:" line.`,
    );
  }
  return id;
}
