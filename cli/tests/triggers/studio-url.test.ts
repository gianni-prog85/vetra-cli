/**
 * The Studio's address the Cli prints: the stack's Connect member when the
 * Cli runs in `ph run studio`.
 */
import { describe, it, expect } from "vitest";
import type { ServiceInstanceStatus } from "@powerhousedao/clint";
import { studioUrlOf } from "../../src/triggers/studio-url.js";

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
