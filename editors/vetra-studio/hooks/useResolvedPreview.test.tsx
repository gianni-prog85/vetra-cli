// @vitest-environment happy-dom
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "../test-utils/render.js";
import { useResolvedPreview } from "./useResolvedPreview.js";
import type { PreviewTarget } from "./useSessionPreviewTarget.js";

const hoisted = vi.hoisted(() => ({
  resolves: [] as Record<string, unknown>[],
  starts: [] as Record<string, unknown>[],
  kind: "project-stopped",
}));

vi.mock("./preview-server-client.js", () => ({
  fetchResolve: (args: Record<string, unknown>) => {
    hoisted.resolves.push(args);
    return Promise.resolve({ kind: hoisted.kind });
  },
  fetchStart: (args: Record<string, unknown>) => {
    hoisted.starts.push(args);
    return Promise.resolve({ kind: "started" });
  },
  subscribePreviewEvents: () => () => {},
}));

function Probe({
  target,
  autoStart,
}: {
  target: PreviewTarget;
  autoStart?: boolean;
}) {
  const state = useResolvedPreview(target, { autoStart });
  return <span data-kind={state.kind} />;
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  hoisted.resolves = [];
  hoisted.starts = [];
  hoisted.kind = "project-stopped";
});

describe("useResolvedPreview", () => {
  it("asks for the home view and never starts a stopped project for it", async () => {
    const container = render(
      <Probe target={{ home: true, callId: "s1" }} autoStart={false} />,
    );
    await settle();
    expect(hoisted.resolves.at(-1)).toMatchObject({ home: true });
    // The project is the Studio's own: no call names one.
    expect(hoisted.resolves.at(-1)).not.toHaveProperty("project");
    expect(
      container.querySelector("[data-kind]")?.getAttribute("data-kind"),
    ).toBe("project-stopped");
    expect(hoisted.starts).toEqual([]);
  });

  it("starts a stopped project once for a shared screen", async () => {
    render(<Probe target={{ doc: "d1", callId: "c1" }} />);
    await settle();
    expect(hoisted.resolves.at(-1)).toMatchObject({ doc: "d1" });
    expect(hoisted.starts).toHaveLength(1);
    expect(hoisted.starts[0]).not.toHaveProperty("project");
  });

  it("never starts anything while the Studio's project run is off", async () => {
    hoisted.kind = "preview-off";
    const container = render(<Probe target={{ doc: "d1", callId: "c1" }} />);
    await settle();
    expect(
      container.querySelector("[data-kind]")?.getAttribute("data-kind"),
    ).toBe("preview-off");
    expect(hoisted.starts).toEqual([]);
  });
});
