import { type ChildProcess, spawn } from "node:child_process";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import net from "node:net";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";
import { CACHE_DIR, STUDIO_REF, phCliEntry } from "../support/target.js";
import globalTeardown from "./global-teardown.js";
import {
  PREVIEW_RUN_FILE,
  PREVIEW_STUDIO_LOG,
  type PreviewRun,
  previewProject,
} from "./run.js";

const STUDIO_LINE = /Vetra Studio:\s*(http:\/\/\S+)\r?\n/;
const BOOT_TIMEOUT_MS = 300_000;
/** The Studio stack's and its Preview's fixed ports. */
const PORTS = [8090, 8091, 8092, 8093];

function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: "127.0.0.1" });
    socket.once("connect", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(true));
  });
}

function writeRun(run: PreviewRun): void {
  writeFileSync(PREVIEW_RUN_FILE, JSON.stringify(run, null, 2));
}

function parseStudioUrl(href: string): { baseUrl: string; driveId: string } {
  const url = new URL(href);
  const driveId = url.pathname.match(/\/d\/([^/?#]+)/)?.[1];
  if (!driveId) throw new Error(`Could not parse the drive id from "${href}"`);
  return { baseUrl: url.origin, driveId };
}

/** Starts the Studio in the project (`ph-cli run
 * @powerhousedao/vetra-cli/studio serve`, the project's own ph-cli) and
 * records where it is; `VETRA_E2E_STUDIO_URL` (the `Vetra Studio:` address of
 * a Studio already running in that project) attaches instead. */
export default async function globalSetup(): Promise<void> {
  const project = previewProject();
  if (!existsSync(path.join(project, "powerhouse.config.json"))) {
    throw new Error(`${project} is not a Reactor Package project`);
  }
  mkdirSync(CACHE_DIR, { recursive: true });
  rmSync(PREVIEW_RUN_FILE, { force: true });

  const attach = process.env.VETRA_E2E_STUDIO_URL;
  if (attach) {
    writeRun({ ...parseStudioUrl(attach), pid: null, project });
    return;
  }

  // Never over a running stack: its stores are open.
  for (const port of PORTS) {
    if (!(await portFree(port))) {
      throw new Error(
        `Port ${port} is in use: stop the Studio that holds it, or attach with VETRA_E2E_STUDIO_URL`,
      );
    }
  }

  const child = spawn(
    process.execPath,
    [phCliEntry(project), "run", STUDIO_REF, "serve"],
    {
      cwd: project,
      // The stop stream: its end (this process ending too) stops the stack.
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      env: {
        ...process.env,
        PH_STOP_ON_STDIN: "1",
        PORTLE_AUTOSTART: "0",
        NO_COLOR: "1",
        FORCE_COLOR: "0",
      },
    },
  );
  child.stdin.on("error", () => undefined);
  const run: PreviewRun = {
    baseUrl: null,
    driveId: null,
    pid: child.pid ?? null,
    project,
  };
  // Before the wait: a teardown after a crash still finds the stack.
  writeRun(run);
  const log = createWriteStream(PREVIEW_STUDIO_LOG);
  child.stdout.pipe(log);
  child.stderr.pipe(log);

  try {
    const href = await waitForStudio(child);
    writeRun({ ...run, ...parseStudioUrl(href) });
  } catch (err) {
    // No teardown follows a failed setup: stop the stack here.
    child.stdin.end();
    await globalTeardown();
    throw err;
  }
  child.unref();
}

function waitForStudio(child: ChildProcess): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let buf = "";
    const done = (fn: () => void) => {
      clearTimeout(timer);
      child.stdout?.off("data", onData);
      child.off("exit", onExit);
      fn();
    };
    const onData = (chunk: Buffer) => {
      buf += stripVTControlCharacters(chunk.toString());
      const m = buf.match(STUDIO_LINE);
      if (m) done(() => resolve(m[1].trim()));
    };
    const onExit = (code: number | null) => {
      done(() =>
        reject(
          new Error(
            `ph-cli run ${STUDIO_REF} exited (code ${code}) before the Studio was ready; see ${PREVIEW_STUDIO_LOG}`,
          ),
        ),
      );
    };
    const timer = setTimeout(() => {
      done(() =>
        reject(new Error(`Studio not ready within ${BOOT_TIMEOUT_MS} ms`)),
      );
    }, BOOT_TIMEOUT_MS);
    child.stdout?.on("data", onData);
    child.on("exit", onExit);
  });
}
