/**
 * The Studio's address the Cli prints: the stack's Connect member when the
 * Cli runs in `ph run studio`; and the browser opener, per platform, with an
 * injected spawner (no browser is opened).
 */
import { spawnSync, type ChildProcess } from "node:child_process";
import { describe, it, expect, vi } from "vitest";
import type { ServiceInstanceStatus } from "@powerhousedao/clint";
import { browserCommand, openBrowser, studioUrlOf } from "../../src/triggers/studio-url.js";

const member = (
  name: string,
  status: ServiceInstanceStatus["status"],
  endpoints: Record<string, string>,
): ServiceInstanceStatus => ({
  serviceId: name,
  instanceId: name,
  name,
  status,
  endpoints,
});

// What the compound reports for its members: their URL outputs, flattened.
const switchboard = member("switchboard", "ready", {
  origin: "http://localhost:8091",
  "endpoints.graphql": "http://localhost:8091/graphql",
  "drives.studio.url": "http://localhost:8091/d/studio",
});
const connect = member("connect", "ready", {
  origin: "http://127.0.0.1:8090",
  "endpoints.connect": "http://127.0.0.1:8090/",
});

describe("studioUrlOf", () => {
  it("takes the ready Connect member's app url", () => {
    expect(studioUrlOf([switchboard, connect])).toBe("http://127.0.0.1:8090/");
  });

  it("skips a Connect member that is not ready", () => {
    const stopped = member("connect", "stopped", connect.endpoints ?? {});
    expect(studioUrlOf([switchboard, stopped])).toBeUndefined();
  });

  it("is undefined without a Connect member", () => {
    expect(studioUrlOf([switchboard])).toBeUndefined();
    expect(studioUrlOf([])).toBeUndefined();
  });
});

const URL_WITH_QUERY = "http://127.0.0.1:8090/d/abc?embed=1&tab=build";

function fakeSpawner() {
  const child = { on: vi.fn(), unref: vi.fn() };
  const spawner = vi.fn(() => child as unknown as ChildProcess);
  return { spawner, child };
}

describe("openBrowser", () => {
  it("macOS: open, detached, the url as one argument", () => {
    const { spawner, child } = fakeSpawner();
    openBrowser(URL_WITH_QUERY, spawner as never, "darwin");
    expect(spawner).toHaveBeenCalledWith("open", [URL_WITH_QUERY], {
      stdio: "ignore",
      detached: true,
      windowsHide: true,
    });
    expect(child.on).toHaveBeenCalledWith("error", expect.any(Function));
    expect(child.unref).toHaveBeenCalled();
  });

  it("Linux: xdg-open", () => {
    const { spawner } = fakeSpawner();
    openBrowser(URL_WITH_QUERY, spawner as never, "linux");
    expect(spawner).toHaveBeenCalledWith("xdg-open", [URL_WITH_QUERY], expect.any(Object));
  });

  it("Windows: cmd's start with the url quoted, hidden, the line passed as written", () => {
    const { spawner } = fakeSpawner();
    openBrowser(URL_WITH_QUERY, spawner as never, "win32");
    expect(spawner).toHaveBeenCalledWith(
      "cmd.exe",
      ["/d", "/s", "/c", `start "" "${URL_WITH_QUERY}"`],
      { stdio: "ignore", detached: true, windowsHide: true, windowsVerbatimArguments: true },
    );
  });

  it('Windows: a " in the url cannot end the quote', () => {
    expect(browserCommand('http://x/d/a"&calc', "win32").args.at(-1)).toBe(
      'start "" "http://x/d/a%22&calc"',
    );
  });

  it("swallows a spawner that throws (no opener: the printed url stands)", () => {
    const spawner = vi.fn(() => {
      throw new Error("ENOENT");
    });
    expect(() => openBrowser(URL_WITH_QUERY, spawner as never, "linux")).not.toThrow();
  });

  // cmd itself, with `echo` in place of `start`: what start would be handed.
  it.runIf(process.platform === "win32")(
    "Windows: cmd hands the whole url on, where the old unquoted form split it at &",
    () => {
      const { command, args, options } = browserCommand(URL_WITH_QUERY, "win32");
      const echoed = spawnSync(command, [...args.slice(0, -1), args.at(-1)!.replace('start ""', "echo")], {
        windowsHide: options.windowsHide,
        windowsVerbatimArguments: options.windowsVerbatimArguments,
        encoding: "utf8",
      });
      expect(echoed.stdout.trim()).toBe(`"${URL_WITH_QUERY}"`);

      const old = spawnSync("cmd", ["/c", "echo", URL_WITH_QUERY], { encoding: "utf8", windowsHide: true });
      expect(old.stdout.trim()).toBe("http://127.0.0.1:8090/d/abc?embed=1");
    },
  );
});
