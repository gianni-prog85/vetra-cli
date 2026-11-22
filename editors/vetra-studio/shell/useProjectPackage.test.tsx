// @vitest-environment happy-dom
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "../test-utils/render.js";
import { useProjectPackage } from "./useProjectPackage.js";

const hoisted = vi.hoisted(() => ({
  calls: [] as Record<string, unknown>[],
  results: [] as Array<() => Promise<unknown>>,
  listeners: [] as Array<() => void>,
}));

vi.mock("../hooks/preview-server-client.js", () => ({
  fetchProjectPackage: (args: Record<string, unknown>) => {
    hoisted.calls.push(args);
    const next = hoisted.results.shift();
    return next ? next() : Promise.reject(new Error("unknown"));
  },
  subscribePreviewEvents: (fn: () => void) => {
    hoisted.listeners.push(fn);
    return () => {};
  },
}));

function Probe() {
  const project = useProjectPackage();
  return (
    <span
      data-name={project?.name ?? ""}
      data-version={project?.version ?? ""}
    />
  );
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  hoisted.calls = [];
  hoisted.results = [];
  hoisted.listeners = [];
});

describe("useProjectPackage", () => {
  it("reads the Studio's own project (no project named) and reads again on an event", async () => {
    hoisted.results.push(() =>
      Promise.reject(new Error("local API not known yet")),
    );
    hoisted.results.push(() =>
      Promise.resolve({ kind: "ok", name: "@acme/shop", version: "1.0.9" }),
    );
    const container = render(<Probe />);
    await settle();
    expect(hoisted.calls).toHaveLength(1);
    expect(hoisted.calls[0]).not.toHaveProperty("project");
    expect(container.querySelector("span")?.getAttribute("data-name")).toBe("");

    // The local API's events open once its address is known.
    act(() => hoisted.listeners.forEach((fn) => fn()));
    await settle();
    const span = container.querySelector("span");
    expect(span?.getAttribute("data-name")).toBe("@acme/shop");
    expect(span?.getAttribute("data-version")).toBe("1.0.9");
  });
});
