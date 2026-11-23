// @vitest-environment happy-dom
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "../test-utils/render.js";
import { usePreviewHome } from "./usePreviewHome.js";

const hoisted = vi.hoisted(() => ({
  resolve: [] as Array<() => Promise<unknown>>,
  status: [] as Array<() => Promise<unknown>>,
  resolveCalls: [] as Record<string, unknown>[],
  listeners: [] as Array<() => void>,
}));

vi.mock("../hooks/preview-server-client.js", () => ({
  fetchResolve: (args: Record<string, unknown>) => {
    hoisted.resolveCalls.push(args);
    const next = hoisted.resolve.shift();
    return next ? next() : Promise.reject(new Error("unknown"));
  },
  fetchPreviewStatus: () => {
    const next = hoisted.status.shift();
    return next ? next() : Promise.resolve(undefined);
  },
  subscribePreviewEvents: (fn: () => void) => {
    hoisted.listeners.push(fn);
    return () => {};
  },
}));

function Probe() {
  const home = usePreviewHome();
  return <span data-home={JSON.stringify(home)} />;
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
  });
}

const homeOf = (container: HTMLElement) =>
  JSON.parse(
    container.querySelector("span")?.getAttribute("data-home") ?? "null",
  ) as unknown;

async function event() {
  await act(async () => {
    for (const fn of hoisted.listeners) fn();
    for (let i = 0; i < 6; i++) await Promise.resolve();
  });
}

beforeEach(() => {
  hoisted.resolve = [];
  hoisted.status = [];
  hoisted.resolveCalls = [];
  hoisted.listeners = [];
});

describe("usePreviewHome", () => {
  it("asks for the preview drive's root and goes from starting to ready on an event", async () => {
    hoisted.resolve.push(() => Promise.resolve({ kind: "starting" }));
    hoisted.status.push(() => Promise.resolve({ kind: "starting" }));
    hoisted.resolve.push(() =>
      Promise.resolve({
        kind: "ready",
        driveId: "d1",
        documentId: "d1",
        url: "http://localhost:8092/d/d1?embed=1",
      }),
    );
    const container = render(<Probe />);
    expect(homeOf(container)).toEqual({ kind: "loading" });
    await settle();
    expect(hoisted.resolveCalls[0]).toMatchObject({ home: true });
    expect(homeOf(container)).toEqual({ kind: "starting" });

    await event();
    expect(homeOf(container)).toEqual({
      kind: "ready",
      url: "http://localhost:8092/d/d1?embed=1",
    });
  });

  it("gives the reason a start is refused, and a failed run's error", async () => {
    hoisted.resolve.push(() => Promise.resolve({ kind: "project-stopped" }));
    hoisted.status.push(() =>
      Promise.resolve({
        kind: "unavailable",
        reason: "The project has no @powerhousedao/connect installed",
        hint: "Add it",
      }),
    );
    hoisted.resolve.push(() => Promise.resolve({ kind: "project-stopped" }));
    hoisted.status.push(() =>
      Promise.resolve({ kind: "failed", error: "Readiness timed out" }),
    );
    const container = render(<Probe />);
    await settle();
    expect(homeOf(container)).toEqual({
      kind: "unavailable",
      reason: "The project has no @powerhousedao/connect installed",
      hint: "Add it",
    });
    await event();
    expect(homeOf(container)).toEqual({
      kind: "failed",
      error: "Readiness timed out",
    });
  });

  it("without the owner's status it still tells stopped from starting", async () => {
    hoisted.resolve.push(() => Promise.resolve({ kind: "project-stopped" }));
    hoisted.resolve.push(() => Promise.resolve({ kind: "starting" }));
    hoisted.resolve.push(() =>
      Promise.resolve({ kind: "unknown-project", error: "unknown project" }),
    );
    const container = render(<Probe />);
    await settle();
    expect(homeOf(container)).toEqual({ kind: "stopped" });
    await event();
    expect(homeOf(container)).toEqual({ kind: "starting" });
    await event();
    expect(homeOf(container)).toMatchObject({ kind: "unavailable" });
  });

  it("stays as it is while the local API is not reachable", async () => {
    const container = render(<Probe />);
    await settle();
    expect(homeOf(container)).toEqual({ kind: "loading" });
  });
});
