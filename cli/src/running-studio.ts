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
