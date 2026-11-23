// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import type { ProjectHost } from "../hooks/preview-server-client.js";
import { click, render } from "../test-utils/render.js";
import {
  HOSTS_LOADING,
  HOSTS_NONE,
  HOSTS_UNKNOWN_PROJECT,
  HOST_FAILED,
  HOST_NO_WEB,
  HOST_STARTING,
  HOST_STOPPED,
  HOST_STOPPING,
  HOST_TERMINAL,
  PreviewHostsView,
} from "./PreviewHosts.js";
import type {
  ProjectHostsHandle,
  ProjectHostsView,
} from "./useProjectHosts.js";

const host = (over: Partial<ProjectHost> = {}): ProjectHost => ({
  host: "connect",
  name: "acme-connect",
  runner: "@powerhousedao/ph-cli/runners/connect",
  startable: true,
  command: "ph run connect dev",
  state: { kind: "stopped" },
  ...over,
});

const running = (webUrl?: string): ProjectHost["state"] => ({
  kind: "running",
  pid: 7,
  startedAt: "2026-11-23T10:00:00.000Z",
  verb: "dev",
  links: [
    { name: "connect", url: "about:blank#connect" },
    { name: "graphql", url: "about:blank#graphql" },
  ],
  ...(webUrl ? { webUrl } : {}),
  startedHere: true,
});

function handle(
  view: ProjectHostsView,
  over: Partial<ProjectHostsHandle> = {},
): ProjectHostsHandle {
  return {
    view,
    pending: undefined,
    actionError: undefined,
    start: vi.fn(),
    stop: vi.fn(),
    ...over,
  };
}

const ok = (...hosts: ProjectHost[]): ProjectHostsView => ({
  kind: "ok",
  projectPath: "/p",
  hosts,
});

describe("PreviewHostsView", () => {
  it("says it is reading, that there are no hosts, or that there is no project", () => {
    expect(
      render(<PreviewHostsView hosts={handle({ kind: "loading" })} />)
        .textContent,
    ).toContain(HOSTS_LOADING);
    const none = render(
      <PreviewHostsView
        hosts={handle({
          kind: "none",
          projectPath: "/p",
          reason: "No hosts/ folder.",
        })}
      />,
    );
    expect(none.textContent).toContain(HOSTS_NONE);
    expect(none.textContent).toContain("No hosts/ folder.");
    expect(
      render(
        <PreviewHostsView
          hosts={handle({ kind: "unknown-project", error: "unknown project" })}
        />,
      ).textContent,
    ).toContain(HOSTS_UNKNOWN_PROJECT);
  });

  it("lists the hosts as chips and starts the chosen one", () => {
    const hosts = handle(
      ok(host(), host({ host: "switchboard", name: "acme-switchboard" })),
    );
    const container = render(<PreviewHostsView hosts={hosts} />);
    expect(
      Array.from(container.querySelectorAll("[data-host]")).map((b) => [
        b.getAttribute("data-host"),
        b.getAttribute("data-host-state"),
        b.getAttribute("aria-pressed"),
      ]),
    ).toEqual([
      ["connect", "stopped", "true"],
      ["switchboard", "stopped", "false"],
    ]);
    expect(container.textContent).toContain(HOST_STOPPED);
    expect(container.querySelector("iframe")).toBeNull();

    click(container.querySelector('[data-host="switchboard"]'));
    expect(container.querySelector("[data-host-status]")?.textContent).toBe(
      "switchboard · stopped",
    );
    click(container.querySelector("[data-host-start]"));
    expect(hosts.start).toHaveBeenCalledWith("switchboard");
  });

  it("frames the running host's web address, with its links, and stops it", () => {
    const hosts = handle(ok(host({ state: running("about:blank#connect") })));
    const container = render(<PreviewHostsView hosts={hosts} />);
    expect(
      container
        .querySelector("iframe[data-preview-frame]")
        ?.getAttribute("src"),
    ).toBe("about:blank#connect");
    expect(container.querySelector("[data-host-address]")?.textContent).toBe(
      "about:blank#connect",
    );
    expect(container.querySelector("[data-host-status]")?.textContent).toBe(
      "connect · running",
    );
    expect(
      Array.from(container.querySelectorAll("[data-host-links] a")).map((a) =>
        a.getAttribute("href"),
      ),
    ).toEqual(["about:blank#connect", "about:blank#graphql"]);
    expect(container.querySelector("[data-host-start]")).toBeNull();
    click(container.querySelector("[data-host-stop]"));
    expect(hosts.stop).toHaveBeenCalledWith("connect");
  });

  it("shows a running web host first", () => {
    const container = render(
      <PreviewHostsView
        hosts={handle(
          ok(
            host({ host: "cli", startable: false, command: "ph run cli" }),
            host({ host: "switchboard", state: running() }),
            host({ state: running("about:blank#connect") }),
          ),
        )}
      />,
    );
    expect(
      container
        .querySelector('[aria-pressed="true"]')
        ?.getAttribute("data-host"),
    ).toBe("connect");
  });

  it("says a running host without a web app has nothing to frame", () => {
    const container = render(
      <PreviewHostsView
        hosts={handle(ok(host({ host: "switchboard", state: running() })))}
      />,
    );
    expect(container.textContent).toContain(HOST_NO_WEB);
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.querySelector("[data-host-links]")).not.toBeNull();
  });

  it("says a host is starting or stopping; a starting one can be stopped", () => {
    const starting = render(
      <PreviewHostsView
        hosts={handle(ok(host({ state: { kind: "starting" } })))}
      />,
    );
    expect(starting.textContent).toContain(HOST_STARTING);
    expect(starting.querySelector("[data-host-status]")?.textContent).toBe(
      "connect · starting…",
    );
    expect(starting.querySelector("[data-host-stop]")).not.toBeNull();

    const stopping = render(
      <PreviewHostsView
        hosts={handle(ok(host({ state: { kind: "stopping" } })))}
      />,
    );
    expect(stopping.textContent).toContain(HOST_STOPPING);
    expect(
      (stopping.querySelector("[data-host-start]") as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("gives the reason a host failed, and lets it start again", () => {
    const container = render(
      <PreviewHostsView
        hosts={handle(
          ok(
            host({
              state: {
                kind: "failed",
                reason: "Port 3000 is taken.",
                logFile: "/p/.ph/services/hosts/connect/connect.1.log",
              },
            }),
          ),
        )}
      />,
    );
    expect(container.textContent).toContain(HOST_FAILED);
    expect(container.textContent).toContain("Port 3000 is taken.");
    expect(container.textContent).toContain("connect.1.log");
    expect(container.querySelector("[data-host-start]")).not.toBeNull();
  });

  it("shows the command of a host that runs in a terminal, with no Start", () => {
    const container = render(
      <PreviewHostsView
        hosts={handle(
          ok(
            host({
              host: "desktop",
              startable: false,
              command: "ph run desktop",
            }),
          ),
        )}
      />,
    );
    expect(container.textContent).toContain(HOST_TERMINAL);
    expect(container.querySelector("[data-host-command]")?.textContent).toBe(
      "ph run desktop",
    );
    expect(container.querySelector("[data-host-start]")).toBeNull();
    expect(container.querySelector("[data-host-stop]")).toBeNull();
  });

  it("shows what a start or stop answered when it was not done", () => {
    const container = render(
      <PreviewHostsView
        hosts={handle(ok(host()), {
          actionError:
            "The connect host did not stop within 60 s and was ended.",
          pending: "connect",
        })}
      />,
    );
    expect(
      container.querySelector("[data-host-action-error]")?.textContent,
    ).toBe("The connect host did not stop within 60 s and was ended.");
    expect(
      (container.querySelector("[data-host-start]") as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});
