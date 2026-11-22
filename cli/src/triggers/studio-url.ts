// Caps the noisy clint startup banner with one prominent Vetra Studio line,
// and opens it in the browser on an interactive local run (stdout is a TTY).
import { spawn, type SpawnOptions } from "node:child_process";
import type { ServiceInstanceStatus } from "@powerhousedao/clint";
import { defineTrigger } from "../framework.js";

/** The app URL a Connect member reports (its outputs' `endpoints.connect`,
 * flattened by the compound into the member's endpoints). */
const CONNECT_ENDPOINT = "endpoints.connect";

/**
 * The Studio's address: the ready Connect member of the stack the Cli runs in
 * (`ph run studio`). Undefined without one (a Cli attached by
 * `VETRA_SWITCHBOARD_URL`).
 */
export function studioUrlOf(
  instances: readonly ServiceInstanceStatus[],
): string | undefined {
  const connect = instances.find(
    (instance) =>
      instance.status === "ready" &&
      typeof instance.endpoints?.[CONNECT_ENDPOINT] === "string",
  );
  return connect?.endpoints?.[CONNECT_ENDPOINT];
}

export interface BrowserCommand {
  command: string;
  args: string[];
  options: SpawnOptions;
}

/**
 * How the OS default browser opens `url`: `open` (macOS), `xdg-open`, or
 * cmd's `start` (Windows). cmd reads `&`, `|`, `<`, `>` and `^` in an
 * unquoted argument as syntax (a query string's `&` ends the command), so the
 * URL goes to `start` quoted, on a command line passed as written; a `"` in
 * it is percent-encoded so it cannot end the quote.
 */
export function browserCommand(
  url: string,
  platform: NodeJS.Platform = process.platform,
): BrowserCommand {
  const options: SpawnOptions = { stdio: "ignore", detached: true, windowsHide: true };
  if (platform === "darwin") return { command: "open", args: [url], options };
  if (platform === "win32") {
    const quoted = `"${url.replace(/"/g, "%22")}"`;
    return {
      command: "cmd.exe",
      args: ["/d", "/s", "/c", `start "" ${quoted}`],
      options: { ...options, windowsVerbatimArguments: true },
    };
  }
  return { command: "xdg-open", args: [url], options };
}

// Launch the OS default browser, detached and best-effort. A missing opener
// arrives async as an 'error' event (spawn won't throw), so swallow that too.
export function openBrowser(
  url: string,
  spawner: typeof spawn = spawn,
  platform: NodeJS.Platform = process.platform,
): void {
  const { command, args, options } = browserCommand(url, platform);
  try {
    const child = spawner(command, args, options);
    child.on("error", () => {});
    child.unref();
  } catch {
    /* opener unavailable — the printed URL stands */
  }
}

export const studioUrlTrigger = defineTrigger({
  id: "studio-url",
  type: "condition",

  async setup(ctx) {
    const reactor = await ctx.reactor();
    const driveId = reactor?.personalDriveId ?? reactor?.driveId;
    if (!driveId) return;

    const studioUrl = studioUrlOf(ctx.commandContext.services?.list() ?? []);
    if (!studioUrl) return;

    const url = `${studioUrl.replace(/\/+$/, "")}/d/${driveId}`;

    // Non-TTY (CI, lab scripts, pods): emit the exact `Vetra Studio: <url>` line
    // that automated consumers grep for readiness. Keep it byte-stable.
    if (!process.stdout.isTTY) {
      console.log(`Vetra Studio: ${url}`);
      return;
    }

    // Interactive terminal: a prominent, colored call-to-action, then open it.
    const paint = (code: string, s: string) => `\x1b[${code}m${s}\x1b[0m`;
    console.log(
      `\n  ${paint("1;32", "▸ Opening Vetra Studio in your browser…")}\n    ${paint("1;36", url)}\n`,
    );
    openBrowser(url);
  },

  async poll() {
    return null;
  },
});
