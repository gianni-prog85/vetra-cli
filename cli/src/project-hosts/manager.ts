/**
 * The project's own hosts (its `hosts/` folder, as `ph run` finds them), for
 * the Preview mode of the Studio's Test / Preview panel: which there are,
 * which run, and a start and a stop of one.
 *
 * A start is `ph run <host> dev` in the project through host-core's
 * `spawnHost`, with the project as its data dir (the project's own stores)
 * and this process's environment. What runs is read from the project's run
 * records, so a host started in a terminal shows as running too. A stop asks
 * the host to stop (the end of its stdin for one started here, its stop
 * channel for any other); nothing is ended by name.
 */
import fs from "node:fs";
import path from "node:path";
import {
  loadHost,
  probeHostsFolder,
  probeRun,
  readProjectName,
  spawnHost,
  stopRun,
  type RunRecord,
  type SpawnedHost,
} from "@powerhousedao/host-core";

const CONNECT_RUNNER = "@powerhousedao/ph-cli/runners/connect";
const SWITCHBOARD_RUNNER = "@powerhousedao/ph-cli/runners/switchboard";
const COMPOUND_RUNNER = "@powerhousedao/host-core/runners/compound";

/** The runners that serve from a background process: the ones started here.
 * Any other host (a native shell, a terminal Cli, an agent) is shown with
 * its command. */
const STARTED_HERE = new Set([
  CONNECT_RUNNER,
  SWITCHBOARD_RUNNER,
  COMPOUND_RUNNER,
]);

/** The verb a project host is started at. */
export const PROJECT_HOST_VERB = "dev";

const READY_TIMEOUT_MS =
  Number(process.env.VETRA_REACTOR_READINESS_TIMEOUT_MS) || 300_000;
/** How long a host may take to stop before its process tree is ended. */
const STOP_TIMEOUT_MS = 60_000;

export interface ProjectHostLink {
  name: string;
  url: string;
}

export type ProjectHostState =
  | { kind: "stopped" }
  | { kind: "starting" }
  | { kind: "stopping" }
  | {
      kind: "running";
      pid: number;
      startedAt: string;
      verb: string;
      links: ProjectHostLink[];
      /** The address of its web app, when it serves one. */
      webUrl?: string;
      /** Started by this Studio (else in a terminal). */
      startedHere: boolean;
    }
  | { kind: "failed"; reason: string; logFile?: string };

export interface ProjectHost {
  /** Its folder under `hosts/`: what `ph run` takes. */
  host: string;
  /** The host file's `name`: the key of its run record. */
  name: string;
  runner: string;
  /** Whether the Studio starts it; otherwise `command` is for a terminal. */
  startable: boolean;
  command: string;
  state: ProjectHostState;
}

export type ProjectHostsResult =
  | { kind: "ok"; projectPath: string; hosts: ProjectHost[] }
  /** The project has no `hosts/` folder, or one with no host in it. */
  | { kind: "none"; projectPath: string; reason: string };

export type ProjectHostActionResult =
  | { kind: "ok"; host: ProjectHost }
  | { kind: "unknown-host"; error: string }
  | { kind: "refused"; error: string }
  | { kind: "failed"; error: string; host?: ProjectHost };

export interface ProjectHostsDeps {
  probeHostsFolder: typeof probeHostsFolder;
  loadHost: (
    projectRoot: string,
    host: string,
  ) => Promise<{ host: { name: string; runner: { module: string } } }>;
  probeRun: typeof probeRun;
  readProjectName: typeof readProjectName;
  spawnHost: typeof spawnHost;
  stopRun: typeof stopRun;
  env: () => NodeJS.ProcessEnv;
  now: () => number;
  /** A file's modification time (0 when it is not there). */
  stamp: (file: string) => number;
  /** Makes the folder a host's log is written in. */
  mkdir: (dir: string) => void;
}

function fileStamp(file: string): number {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

const defaultDeps: ProjectHostsDeps = {
  probeHostsFolder,
  loadHost,
  probeRun,
  readProjectName,
  spawnHost,
  stopRun,
  env: () => process.env,
  now: () => Date.now(),
  stamp: fileStamp,
  mkdir: (dir) => {
    fs.mkdirSync(dir, { recursive: true });
  },
};

type Entry =
  | { phase: "starting"; abort: AbortController; settled: Promise<void> }
  | { phase: "running"; spawned: SpawnedHost }
  | { phase: "stopping"; done: Promise<unknown> }
  | { phase: "failed"; reason: string; logFile?: string };

interface Described {
  host: string;
  name: string;
  runner: string;
  loadError?: string;
}

function isHttp(value: unknown): value is string {
  return typeof value === "string" && /^https?:\/\//.test(value);
}

function endpointsOf(outputs: unknown): Record<string, string> {
  const endpoints = (outputs as { endpoints?: unknown } | undefined)?.endpoints;
  if (endpoints === null || typeof endpoints !== "object") return {};
  const found: Record<string, string> = {};
  for (const [key, value] of Object.entries(endpoints)) {
    if (isHttp(value)) found[key] = value;
  }
  return found;
}

/** The addresses a run record gives: the host's own endpoints, then each
 * member's (named `<member> <endpoint>`), and its web app's when one is a
 * Connect. */
export function linksOfRecord(record: RunRecord): {
  links: ProjectHostLink[];
  webUrl?: string;
} {
  const links: ProjectHostLink[] = [];
  let webUrl: string | undefined;
  const own = endpointsOf(record.outputs);
  for (const [name, url] of Object.entries(own)) links.push({ name, url });
  webUrl = own.connect;
  for (const [member, entry] of Object.entries(record.members ?? {})) {
    const endpoints = endpointsOf(entry.outputs);
    for (const [name, url] of Object.entries(endpoints)) {
      links.push({ name: `${member} ${name}`, url });
    }
    webUrl ??= endpoints.connect;
  }
  return { links, ...(webUrl ? { webUrl } : {}) };
}

function reasonOf(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  // The output tail is in the log.
  return message.split("\n--- output tail ---\n")[0]!.trim();
}

export interface ProjectHosts {
  list(projectPath: string): Promise<ProjectHostsResult>;
  /** Resolves once the start is under way; `settled` when it is running or
   * has failed. */
  start(
    projectPath: string,
    host: string,
  ): Promise<{ result: ProjectHostActionResult; settled: Promise<void> }>;
  stop(projectPath: string, host: string): Promise<ProjectHostActionResult>;
  /** Stops every host started here. */
  stopAll(): Promise<void>;
}

export function createProjectHosts(
  overrides: Partial<ProjectHostsDeps> = {},
): ProjectHosts {
  const deps = { ...defaultDeps, ...overrides };
  const entries = new Map<string, Entry>();
  const keyOf = (projectPath: string, host: string) =>
    `${path.resolve(projectPath)}\n${host}`;

  // A host file is read again when it changes on disk.
  const described = new Map<string, { stamp: number; value: Described }>();

  async function describe(projectPath: string, host: string): Promise<Described> {
    const key = keyOf(projectPath, host);
    const stamp = deps.stamp(path.join(projectPath, "hosts", host, "host.js"));
    const cached = described.get(key);
    if (cached && cached.stamp === stamp) return cached.value;
    let value: Described;
    try {
      const loaded = await deps.loadHost(projectPath, host);
      value = {
        host,
        name: loaded.host.name,
        runner: loaded.host.runner.module,
      };
    } catch (error) {
      value = { host, name: host, runner: "", loadError: reasonOf(error) };
    }
    described.set(key, { stamp, value });
    return value;
  }

  function stateOf(projectPath: string, described: Described): ProjectHostState {
    if (described.loadError) {
      return { kind: "failed", reason: described.loadError };
    }
    const entry = entries.get(keyOf(projectPath, described.host));
    if (entry?.phase === "starting") return { kind: "starting" };
    if (entry?.phase === "stopping") return { kind: "stopping" };
    const probe = deps.probeRun(
      projectPath,
      described.name,
      deps.readProjectName(projectPath),
      deps.env(),
    );
    if (probe.status === "live") {
      const { record } = probe;
      return {
        kind: "running",
        pid: record.pid,
        startedAt: record.startedAt,
        verb: record.verb,
        ...linksOfRecord(record),
        startedHere:
          entry?.phase === "running" && entry.spawned.pid === record.pid,
      };
    }
    if (entry?.phase === "failed") {
      return {
        kind: "failed",
        reason: entry.reason,
        ...(entry.logFile ? { logFile: entry.logFile } : {}),
      };
    }
    return { kind: "stopped" };
  }

  function toHost(projectPath: string, described: Described): ProjectHost {
    const startable = STARTED_HERE.has(described.runner);
    return {
      host: described.host,
      name: described.name,
      runner: described.runner,
      startable,
      command: startable
        ? `ph run ${described.host} ${PROJECT_HOST_VERB}`
        : `ph run ${described.host}`,
      state: stateOf(projectPath, described),
    };
  }

  function folders(projectPath: string): string[] | string {
    const probe = deps.probeHostsFolder(projectPath);
    if (probe.kind === "absent") return "This project has no hosts/ folder.";
    if (probe.kind === "empty") {
      return `hosts/ at ${probe.dir} contains no <name>/host.js.`;
    }
    return probe.hosts;
  }

  async function one(
    projectPath: string,
    host: string,
  ): Promise<Described | Extract<ProjectHostActionResult, { kind: "unknown-host" }>> {
    const found = folders(projectPath);
    if (typeof found === "string" || !found.includes(host)) {
      const has = typeof found === "string" ? "none" : found.join(", ");
      return {
        kind: "unknown-host",
        error: `The project has no host "${host}" (its hosts: ${has}).`,
      };
    }
    return describe(projectPath, host);
  }

  return {
    async list(projectPath) {
      const found = folders(projectPath);
      if (typeof found === "string") {
        return { kind: "none", projectPath, reason: found };
      }
      const described = await Promise.all(
        found.map((host) => describe(projectPath, host)),
      );
      return {
        kind: "ok",
        projectPath,
        hosts: described.map((d) => toHost(projectPath, d)),
      };
    },

    async start(projectPath, host) {
      const done = Promise.resolve();
      const described = await one(projectPath, host);
      if ("kind" in described) return { result: described, settled: done };
      if (described.loadError) {
        return {
          result: { kind: "failed", error: described.loadError },
          settled: done,
        };
      }
      const current = toHost(projectPath, described);
      if (!current.startable) {
        return {
          result: {
            kind: "refused",
            error: `The ${host} host is not started from the Studio. Start it from the project folder: ${current.command}`,
          },
          settled: done,
        };
      }
      const key = keyOf(projectPath, host);
      const held = entries.get(key);
      if (
        current.state.kind === "running" ||
        current.state.kind === "starting"
      ) {
        return {
          result: { kind: "ok", host: current },
          settled: held?.phase === "starting" ? held.settled : done,
        };
      }
      if (current.state.kind === "stopping") {
        return {
          result: { kind: "refused", error: `The ${host} host is stopping.` },
          settled: done,
        };
      }

      const logFile = path.join(
        projectPath,
        ".ph",
        "services",
        "hosts",
        host,
        `${host}.${deps.now()}.log`,
      );
      try {
        deps.mkdir(path.dirname(logFile));
      } catch {
        // The host runs without a log file.
      }
      // The child gets a stdin of its own to stop on.
      const baseEnv: NodeJS.ProcessEnv = { ...deps.env() };
      delete baseEnv.PH_STOP_ON_STDIN;
      delete baseEnv.PH_USER_DATA_DIR;
      const abort = new AbortController();
      const settled = deps
        .spawnHost({
          projectRoot: projectPath,
          dataDir: projectPath,
          host,
          verb: PROJECT_HOST_VERB,
          baseEnv,
          stopOnStdin: true,
          logFile,
          readyTimeoutMs: READY_TIMEOUT_MS,
          stopTimeoutMs: STOP_TIMEOUT_MS,
          signal: abort.signal,
        })
        .then(
          (spawned) => {
            entries.set(key, { phase: "running", spawned });
            void spawned.exited.then((exit) => {
              const now = entries.get(key);
              if (now?.phase !== "running" || now.spawned !== spawned) return;
              entries.set(key, {
                phase: "failed",
                reason: `The ${host} host ended on its own (exit code ${exit.code ?? "none"}).`,
                logFile,
              });
            });
          },
          (error: unknown) => {
            if (abort.signal.aborted) entries.delete(key);
            else {
              entries.set(key, {
                phase: "failed",
                reason: reasonOf(error),
                logFile,
              });
            }
          },
        );
      entries.set(key, { phase: "starting", abort, settled });
      return {
        result: { kind: "ok", host: toHost(projectPath, described) },
        settled,
      };
    },

    async stop(projectPath, host) {
      const described = await one(projectPath, host);
      if ("kind" in described) return described;
      const key = keyOf(projectPath, host);
      const entry = entries.get(key);
      const stopped = (): ProjectHostActionResult => ({
        kind: "ok",
        host: toHost(projectPath, described),
      });

      if (entry?.phase === "stopping") {
        await entry.done;
        return stopped();
      }
      if (entry?.phase === "starting") {
        entry.abort.abort();
        await entry.settled;
        return stopped();
      }
      if (entry?.phase === "running") {
        const done = entry.spawned.stop();
        entries.set(key, { phase: "stopping", done });
        const exit = await done;
        entries.delete(key);
        if (exit.forced) {
          return {
            kind: "failed",
            error: `The ${host} host did not stop within ${STOP_TIMEOUT_MS / 1000} s and was ended.`,
            host: toHost(projectPath, described),
          };
        }
        return stopped();
      }
      if (entry?.phase === "failed") entries.delete(key);

      // Started in a terminal: asked through its stop channel, never ended.
      const done = deps.stopRun(projectPath, described.name, {
        timeoutMs: STOP_TIMEOUT_MS,
        env: deps.env(),
      });
      entries.set(key, { phase: "stopping", done });
      const result = await done.finally(() => entries.delete(key));
      if (result.status === "stopped" || result.status === "none") {
        return stopped();
      }
      const why =
        result.status === "foreign"
          ? `its run record belongs to another project (${result.projectName})`
          : result.status === "unreachable"
            ? "it has no stop channel"
            : `it was asked and still runs after ${STOP_TIMEOUT_MS / 1000} s`;
      return {
        kind: "failed",
        error: `The ${host} host (pid ${result.pid}) was not stopped: ${why}. Stop it where it was started.`,
        host: toHost(projectPath, described),
      };
    },

    async stopAll() {
      const waits: Promise<unknown>[] = [];
      for (const [key, entry] of entries) {
        if (entry.phase === "starting") {
          entry.abort.abort();
          waits.push(entry.settled);
        } else if (entry.phase === "running") {
          const done = entry.spawned.stop();
          entries.set(key, { phase: "stopping", done });
          waits.push(done.finally(() => entries.delete(key)));
        } else if (entry.phase === "stopping") {
          waits.push(entry.done);
        }
      }
      await Promise.allSettled(waits);
    },
  };
}

const SLOT = Symbol.for("vetra-cli.project-hosts");

/** This process's project hosts: the ones it started are stopped with it. */
export function projectHosts(): ProjectHosts {
  const holder = globalThis as { [SLOT]?: ProjectHosts };
  return (holder[SLOT] ??= createProjectHosts());
}
