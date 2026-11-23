/**
 * The Studio that runs for a project, from its run record
 * (`<data folder>/.ph/run/`). On the start path of every command: it reads
 * the record only (no runner, no reactor).
 */
import path from "node:path";
import {
  findRunningInstance,
  type RunningInstance,
} from "@powerhousedao/host-core/instance";

type Env = Readonly<Record<string, string | undefined>>;

/**
 * The Studio compounds, as run records key them: supplied by this package
 * (`ph vetra` in a project), and this repository's own hosts.
 */
export const STUDIO_HOSTS = [
  "@powerhousedao/vetra-cli/studio",
  "@powerhousedao/vetra-cli/studio-signed",
  "studio",
  "studio-signed",
] as const;

/** The Studio drive's declared slug on the switchboard member. */
export const STUDIO_DRIVE_SLUG = "studio";

/** The folder a run works in: `--workdir` / `-w`, else the current one. */
export function workdirOf(
  argv: readonly string[],
  cwd: string = process.cwd(),
): string {
  for (const [index, arg] of argv.entries()) {
    if (arg === "--") break;
    if (arg === "--workdir" || arg === "-w") {
      const value = argv[index + 1];
      return value === undefined ? cwd : path.resolve(cwd, value);
    }
    if (arg.startsWith("--workdir=")) {
      return path.resolve(cwd, arg.slice("--workdir=".length));
    }
  }
  return cwd;
}

/** The running Studio of the project in `projectDir`, if any. */
export function runningStudio(
  projectDir: string,
  env: Env = process.env,
): RunningInstance | undefined {
  return findRunningInstance(projectDir, { host: STUDIO_HOSTS, env });
}

/**
 * The drive address a run of the bin attaches to: `VETRA_SWITCHBOARD_URL`
 * when set, else the Studio drive of the Studio that runs for the project a
 * command works in. A run without a command (the shell) attaches by the
 * variable only.
 */
export function studioDriveUrl(
  argv: readonly string[],
  env: Env = process.env,
  cwd: string = process.cwd(),
): string | undefined {
  if (env.VETRA_SWITCHBOARD_URL) return env.VETRA_SWITCHBOARD_URL;
  if (argv.length === 0) return undefined;
  try {
    return runningStudio(workdirOf(argv, cwd), env)?.drives[STUDIO_DRIVE_SLUG]
      ?.url;
  } catch {
    // An unreadable record is no Studio to attach to.
    return undefined;
  }
}

/** How Studio is started in a project: named when a command finds none. */
export const STUDIO_START_COMMAND = "ph vetra";

/**
 * Commands that build what they use in their own process on purpose, and so
 * are never sent to the running Studio: the agent-eval harness drives an
 * agent of its own.
 */
export const STANDALONE_COMMANDS: readonly string[] = ["vetra-agent-run"];

const VALUE_FLAGS = new Set(["--workdir", "-w", "--config", "-c", "--resume"]);

const HERE_FLAGS = new Set(["--local", "-i", "--interactive"]);

/** The first word of a run: its command's name, or the start of a prompt. */
function firstWord(argv: readonly string[]): string | undefined {
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (!arg.startsWith("-")) return arg;
    if (VALUE_FLAGS.has(arg)) index++;
  }
  return undefined;
}

/** Where a run of the bin gets the reactor and the agent its commands need. */
export interface StudioRun {
  /** The drive this process attaches to itself. */
  url?: string;
  /** The running Studio the commands run in (clint's `RunOptions.forward`). */
  forward?: {
    required: true;
    target?: { control?: RunningInstance["control"]; protocol?: number; pid: number };
  };
  serveCommand?: string;
}

/**
 * How a run of the bin reaches a reactor and an agent.
 *
 * A command that needs either (`needs` in its meta) runs in the Studio that
 * runs for its project: this process sends it over that Studio's control
 * channel and builds neither; with no Studio it is refused. This process
 * attaches by address itself, as before, in four cases: the address is given
 * (`VETRA_SWITCHBOARD_URL`: cloud Studio and scripts), the run has `--local`
 * (clint reads it before the command name), it is the shell (`-i`, or no
 * arguments), or the command is one of {@link STANDALONE_COMMANDS}.
 */
export function studioRun(
  argv: readonly string[],
  env: Env = process.env,
  cwd: string = process.cwd(),
): StudioRun {
  if (env.VETRA_SWITCHBOARD_URL) return { url: env.VETRA_SWITCHBOARD_URL };
  if (argv.length === 0) return {};
  let studio: RunningInstance | undefined;
  try {
    studio = runningStudio(workdirOf(argv, cwd), env);
  } catch {
    // An unreadable record is no Studio.
  }
  const word = firstWord(argv);
  const end = argv.indexOf("--");
  const here =
    argv.slice(0, end === -1 ? argv.length : end).some((arg) => HERE_FLAGS.has(arg)) ||
    (word !== undefined && STANDALONE_COMMANDS.includes(word));
  if (here) {
    const url = studio?.drives[STUDIO_DRIVE_SLUG]?.url;
    return url ? { url } : {};
  }
  return {
    forward: {
      required: true,
      ...(studio
        ? {
            target: {
              ...(studio.control ? { control: studio.control } : {}),
              ...(studio.controlProtocol === undefined
                ? {}
                : { protocol: studio.controlProtocol }),
              pid: studio.pid,
            },
          }
        : {}),
    },
    serveCommand: STUDIO_START_COMMAND,
  };
}
