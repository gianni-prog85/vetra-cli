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
 * sequence the replay agent executes, and what the spec using it asserts.
 * One fixture == one reproducible build. A boot replays one fixture and an
 * empty Studio starts one product, so one product spec runs per boot. */
export interface StudioFixture {
  name: string;
  /** Typed into the chat to start the agent (replay ignores its content). */
  prompt: string;
  /** Replay fixture filename under e2e/fixtures/ (tool steps). */
  replay: string;
  /** studio-build: what the BUILD-pane preview iframe should render. */
  preview?: {
    project: string;
    documentName: string;
    items: { text: string; completed: boolean }[];
  };
  /** studio-chat: the spec document the replay writes into the Studio drive. */
  spec?: {
    documentType: string;
    name: string;
    modelId: string;
    description: string;
  };
  /** studio-chat: the file sent into the build's conversation afterwards. */
  attachment?: {
    fileName: string;
    mimeType: string;
    content: string;
    /** The message's text part. */
    text: string;
  };
}

/** The boot's fixture: `VETRA_FIXTURE`, default `chat-spec` (the one that
 * needs no published packages). */
export const DEFAULT_FIXTURE = "chat-spec";

export function loadFixture(): StudioFixture {
  const name = process.env.VETRA_FIXTURE ?? DEFAULT_FIXTURE;
  const file = path.join(E2E_DIR, "fixtures", `${name}.json`);
  return JSON.parse(readFileSync(file, "utf8")) as StudioFixture;
}

/** Absolute path to the replay fixture — passed to the CLI as
 * VETRA_REPLAY_FIXTURE by global-setup. */
export function replayFixturePath(fx: StudioFixture): string {
  return path.join(E2E_DIR, "fixtures", fx.replay);
}

/** The replay fixture's closing text: the agent's last message. */
export function replayDoneText(fx: StudioFixture): string | undefined {
  const replay = JSON.parse(readFileSync(replayFixturePath(fx), "utf8")) as {
    done?: string;
  };
  return replay.done;
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

/** The Cli's workdir and log of the run: the temp dir and `STUDIO_LOG` of a
 * boot; attached, `VETRA_E2E_WORKDIR` and `VETRA_E2E_LOG` (undefined when
 * unset, and the checks that need them are skipped). */
export function cliPaths(): { workdir?: string; log?: string } {
  const tmp = readRunFile()?.tmp;
  if (tmp) return { workdir: workdirFor(tmp), log: STUDIO_LOG };
  return {
    workdir: process.env.VETRA_E2E_WORKDIR,
    log: process.env.VETRA_E2E_LOG,
  };
}

/** The local API (preview server) of the Cli: `127.0.0.1:5180`. */
export const LOCAL_API = "http://127.0.0.1:5180";

/** One GraphQL request to the Studio switchboard through Connect's proxy
 * (`<baseUrl>/graphql`); throws on a transport or GraphQL error. */
export async function studioGraphql<T>(
  baseUrl: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`${baseUrl}/graphql`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (!res.ok || body.errors?.length || !body.data) {
    throw new Error(
      `GraphQL ${res.status}: ${body.errors?.map((e) => e.message).join("; ") ?? "no data"}`,
    );
  }
  return body.data;
}
