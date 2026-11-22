import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
/** cli/e2e */
export const E2E_DIR = path.resolve(here, "..");
/** The package root: where `ph-cli run studio` runs. */
export const REPO_ROOT = path.resolve(E2E_DIR, "..", "..");
export const CACHE_DIR = path.join(E2E_DIR, ".cache");
/** Written by global-setup once the studio boots: where to point the test. */
export const RUN_FILE = path.join(CACHE_DIR, "run.json");
/** Full studio stdout/stderr; the spec tails it to fail fast on a replay error
 * rather than waiting out the preview timeout. */
export const STUDIO_LOG = path.join(CACHE_DIR, "studio.log");

/** The package's own ph-cli entry, run with `process.execPath` (no shell). */
export function phCliEntry(): string {
  const require_ = createRequire(path.join(REPO_ROOT, "package.json"));
  const pkg = require_.resolve("@powerhousedao/ph-cli/package.json");
  return path.join(path.dirname(pkg), "dist", "cli.mjs");
}

/** HOME of the run: clint roots its service state at homedir()/.ph/<cli>. */
export function homeFor(tmp: string): string {
  return path.join(tmp, "home");
}

/** The Cli's workdir (`-- --workdir`). */
export function workdirFor(tmp: string): string {
  return path.join(tmp, "work");
}

/** What setup and teardown give every ph-cli they start: the stack's stores,
 * run records and member logs land under `<tmp>/.ph`, its home under
 * `<tmp>/home` (Windows' homedir() reads USERPROFILE). */
export function stackEnv(tmp: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PH_USER_DATA_DIR: tmp,
    HOME: homeFor(tmp),
    USERPROFILE: homeFor(tmp),
    PORTLE_AUTOSTART: "0",
  };
}

/** `.cache/run.json`. `pid` and `tmp` are null when attached. */
export interface RunFile {
  baseUrl: string | null;
  driveId: string | null;
  /** The `ph-cli run studio` process. */
  pid: number | null;
  /** Member pids from their run records, by member. */
  members: Record<string, number>;
  tmp: string | null;
}

export function readRunFile(): RunFile | undefined {
  try {
    return JSON.parse(readFileSync(RUN_FILE, "utf8")) as RunFile;
  } catch {
    return undefined;
  }
}

/** A seeded run: the prompt that kicks off the build, the recorded tool
 * sequence the replay agent executes, and the editor state the BUILD pane
 * should end up showing. One fixture == one reproducible build. */
export interface StudioFixture {
  name: string;
  /** Typed into the chat to start the agent (replay ignores its content). */
  prompt: string;
  /** Replay fixture filename under e2e/fixtures/ (tool steps). */
  replay: string;
  /** What the BUILD-pane preview iframe should render once the build lands. */
  preview: {
    project: string;
    documentName: string;
    items: { text: string; completed: boolean }[];
  };
}

export function loadFixture(): StudioFixture {
  const name = process.env.VETRA_FIXTURE ?? "todo-list";
  const file = path.join(E2E_DIR, "fixtures", `${name}.json`);
  return JSON.parse(readFileSync(file, "utf8")) as StudioFixture;
}

/** Absolute path to the replay fixture — passed to the CLI as
 * VETRA_REPLAY_FIXTURE by global-setup. */
export function replayFixturePath(fx: StudioFixture): string {
  return path.join(E2E_DIR, "fixtures", fx.replay);
}

/** Where the studio is + which drive to open. Resolved by global-setup
 * (boot) or via env when attaching to a manually-started replay studio. */
export interface RunTarget {
  baseUrl: string;
  driveId: string;
}

export function loadRun(): RunTarget {
  if (process.env.VETRA_BASE_URL && process.env.VETRA_DRIVE_ID) {
    return {
      baseUrl: process.env.VETRA_BASE_URL.replace(/\/$/, ""),
      driveId: process.env.VETRA_DRIVE_ID,
    };
  }
  return JSON.parse(readFileSync(RUN_FILE, "utf8")) as RunTarget;
}
