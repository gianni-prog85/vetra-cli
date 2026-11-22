import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

import {
  browserDriveRemoteUrl,
  buildPreviewDriveRootPath,
  createEmptyPreviewDocument,
  createPreviewDrive,
  driveRemoteUrl,
  findPreviewByName,
  findPreviewDriveByPreferredEditor,
  listPreviewDocuments,
  resolvePreviewEndpoint,
} from "../../src/helpers/reactor-project-preview.js";
import { recordedEndpoints } from "../services/run-record.js";

const PROJECT_PATH = "/tmp/some-reactor-project";
const SWITCHBOARD_URL = "http://localhost:5555/graphql";

function makeServices(instances: Array<{
  status: string;
  workdir?: string;
  endpoints?: Record<string, string>;
}>) {
  return {
    list: () => instances,
  } as never;
}

describe("resolvePreviewEndpoint", () => {
  it("throws when no service manager is available", () => {
    expect(() => resolvePreviewEndpoint(undefined, PROJECT_PATH, "demo")).toThrow(
      /service manager not available/i,
    );
  });

  it("throws with a start-hint when no live instance matches the path", () => {
    const services = makeServices([
      { status: "stopped", workdir: PROJECT_PATH },
      { status: "ready", workdir: "/other/path" },
    ]);
    expect(() =>
      resolvePreviewEndpoint(services, PROJECT_PATH, "demo"),
    ).toThrow(/reactor-project-start demo/);
  });

  it("treats 'starting' instances as live but errors when endpoint not captured yet", () => {
    const services = makeServices([
      { status: "starting", workdir: PROJECT_PATH },
    ]);
    expect(() =>
      resolvePreviewEndpoint(services, PROJECT_PATH, "demo"),
    ).toThrow(/starting up/i);
  });

  it("returns the switchboard, Connect and preview drive the run record names", () => {
    const services = makeServices([
      { status: "ready", workdir: PROJECT_PATH, endpoints: recordedEndpoints() },
    ]);
    expect(resolvePreviewEndpoint(services, PROJECT_PATH, "demo")).toEqual({
      switchboardUrl: "http://localhost:4001/graphql",
      connectUrl: "http://localhost:3001/",
      driveId: "vetra-preview-1a2b3c4d",
    });
  });

  it("treats a ready instance without the preview drive as still starting", () => {
    const services = makeServices([
      { status: "ready", workdir: PROJECT_PATH, endpoints: { "vetra-switchboard": SWITCHBOARD_URL } },
    ]);
    expect(() => resolvePreviewEndpoint(services, PROJECT_PATH, "demo")).toThrow(/starting up/i);
  });
});

describe("findPreviewByName", () => {
  const driveId = "preview-abcd1234";
  const items = [
    { id: "doc-1", slug: "alpha", name: "Alpha", documentType: "x", revisionsList: [] },
    { id: "doc-2", slug: "beta", name: "Beta", documentType: "x", revisionsList: [] },
    { id: "doc-3", slug: "gamma", name: "Gamma", documentType: "x", revisionsList: [] },
  ];

  let fetchSpy: MockInstance<typeof globalThis.fetch>;

  beforeEach(() => {
    fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({ data: { findDocuments: { items } } }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        ),
      );
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("matches by display name", async () => {
    const row = await findPreviewByName(SWITCHBOARD_URL, driveId, "Beta");
    expect(row.id).toBe("doc-2");
  });

  it("matches by slug when name doesn't match", async () => {
    const row = await findPreviewByName(SWITCHBOARD_URL, driveId, "gamma");
    expect(row.id).toBe("doc-3");
  });

  it("matches by id when name and slug don't match", async () => {
    const row = await findPreviewByName(SWITCHBOARD_URL, driveId, "doc-1");
    expect(row.id).toBe("doc-1");
  });

  it("throws with candidates when nothing matches", async () => {
    await expect(
      findPreviewByName(SWITCHBOARD_URL, driveId, "missing"),
    ).rejects.toThrow(/missing/);
  });

  it("throws on ambiguous name match", async () => {
    fetchSpy.mockImplementationOnce(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            data: {
              findDocuments: {
                items: [
                  { id: "a", slug: "a", name: "Same", documentType: "x", revisionsList: [] },
                  { id: "b", slug: "b", name: "Same", documentType: "x", revisionsList: [] },
                ],
              },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
    await expect(
      findPreviewByName(SWITCHBOARD_URL, driveId, "Same"),
    ).rejects.toThrow(/multiple/i);
  });
});

describe("gqlRequest error paths (via findPreviewByName)", () => {
  const driveId = "preview-abcd1234";
  let fetchSpy: MockInstance<typeof globalThis.fetch>;

  afterEach(() => {
    fetchSpy?.mockRestore();
  });

  it("surfaces GraphQL errors with the joined messages", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ errors: [{ message: "boom" }, { message: "kaboom" }] }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
    await expect(
      findPreviewByName(SWITCHBOARD_URL, driveId, "anything"),
    ).rejects.toThrow(/boom; kaboom/);
  });

  it("surfaces HTTP failures with status code and body", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(
        new Response("server exploded", { status: 502, statusText: "Bad Gateway" }),
      ),
    );
    await expect(
      findPreviewByName(SWITCHBOARD_URL, driveId, "anything"),
    ).rejects.toThrow(/502/);
  });
});

describe("findPreviewDriveByPreferredEditor", () => {
  const drives = [
    { id: "drive-1", slug: "a", name: "Alpha Preview", documentType: "powerhouse/document-drive", preferredEditor: "alpha-app", revisionsList: [] },
    { id: "drive-2", slug: "b", name: "Beta Preview", documentType: "powerhouse/document-drive", preferredEditor: "beta-app", revisionsList: [] },
  ];

  let fetchSpy: MockInstance<typeof globalThis.fetch>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ data: { findDocuments: { items: drives } } }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  /* Regression guard: SearchFilterInput's field is `type`, not `documentType`.
   * Sending `documentType` makes the reactor reject the variable, which broke
   * spec-preview-create-drive (it always calls this first for idempotency). */
  it("filters drives by SearchFilterInput.type, never documentType", async () => {
    await findPreviewDriveByPreferredEditor(SWITCHBOARD_URL, "beta-app");
    const body = JSON.parse(
      (fetchSpy.mock.calls[0][1] as RequestInit).body as string,
    ) as { variables: { search: Record<string, unknown> } };
    expect(body.variables.search).toEqual({ type: "powerhouse/document-drive" });
    expect(body.variables.search).not.toHaveProperty("documentType");
  });

  it("matches by preferredEditor (not by name)", async () => {
    const row = await findPreviewDriveByPreferredEditor(SWITCHBOARD_URL, "beta-app");
    expect(row?.id).toBe("drive-2");
  });

  it("returns null when no drive is bound to that editor", async () => {
    const row = await findPreviewDriveByPreferredEditor(SWITCHBOARD_URL, "missing-app");
    expect(row).toBeNull();
  });
});

describe("createPreviewDrive (mutation ordering)", () => {
  let fetchSpy: MockInstance<typeof globalThis.fetch>;
  let ops: string[];

  beforeEach(() => {
    ops = [];
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => {
      const q = JSON.parse((init as RequestInit).body as string).query as string;
      let data: Record<string, unknown>;
      if (q.includes("createEmptyDocument")) {
        ops.push("create");
        data = { createEmptyDocument: { id: "drv-1", slug: "drv-1", name: "", documentType: "powerhouse/document-drive", preferredEditor: null, state: {}, revisionsList: [] } };
      } else if (q.includes("renameDocument")) {
        ops.push("rename");
        data = { renameDocument: { id: "drv-1", slug: "drv-1", name: "My App Preview", documentType: "powerhouse/document-drive", preferredEditor: null, state: {}, revisionsList: [] } };
      } else {
        ops.push("setPreferredEditor");
        data = { setPreferredEditor: { id: "drv-1", slug: "drv-1", name: "My App Preview", documentType: "powerhouse/document-drive", preferredEditor: "my-app" } };
      }
      return Promise.resolve(
        new Response(JSON.stringify({ data }), { status: 200, headers: { "Content-Type": "application/json" } }),
      );
    });
  });
  afterEach(() => fetchSpy.mockRestore());

  /* Regression guard: renameDocument resets header.meta, so setPreferredEditor
   * MUST run last or the binding is wiped (drive opens with the generic
   * explorer instead of the app). */
  it("renames BEFORE setting preferredEditor", async () => {
    const r = await createPreviewDrive(SWITCHBOARD_URL, "My App Preview", "my-app");
    expect(ops).toEqual(["create", "rename", "setPreferredEditor"]);
    expect(r).toEqual({ id: "drv-1", name: "My App Preview", preferredEditor: "my-app" });
  });

  it("skips setPreferredEditor when none is given", async () => {
    const r = await createPreviewDrive(SWITCHBOARD_URL, "X");
    expect(ops).toEqual(["create", "rename"]);
    expect(r.preferredEditor).toBeNull();
  });
});

describe("gqlRequest auth header", () => {
  const driveId = "preview-abcd1234";

  function authHeaderOf(call: unknown): string | null {
    const init = (call as [unknown, RequestInit])[1];
    const headers = init.headers as Record<string, string>;
    return headers.Authorization ?? headers.authorization ?? null;
  }

  let fetchSpy: MockInstance<typeof globalThis.fetch>;

  function mockOk(data: Record<string, unknown>) {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ data }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
  }

  afterEach(() => fetchSpy?.mockRestore());

  it("attaches a Bearer token to every request when one is provided", async () => {
    const doc = {
      id: "doc-1",
      slug: "d",
      name: "Doc",
      documentType: "x",
      preferredEditor: null,
      state: {},
      revisionsList: [],
    };
    mockOk({ createEmptyDocument: doc, renameDocument: doc });

    await createEmptyPreviewDocument(
      SWITCHBOARD_URL,
      driveId,
      "x",
      "Doc",
      "tok-123",
    );

    // createEmptyDocument + renameDocument = two requests, both authed.
    expect(fetchSpy.mock.calls.length).toBe(2);
    for (const call of fetchSpy.mock.calls) {
      expect(authHeaderOf(call)).toBe("Bearer tok-123");
    }
  });

  it("sends no Authorization header when no token is provided", async () => {
    mockOk({ findDocuments: { items: [] } });

    await listPreviewDocuments(SWITCHBOARD_URL, driveId);

    expect(authHeaderOf(fetchSpy.mock.calls[0])).toBeNull();
  });
});

describe("gqlRequest auth-failure guidance", () => {
  let fetchSpy: MockInstance<typeof globalThis.fetch>;

  function mockGraphqlError(message: string) {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ errors: [{ message }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
  }

  afterEach(() => fetchSpy?.mockRestore());

  it("turns an anonymous Forbidden into 'Authorize agent' guidance", async () => {
    mockGraphqlError("Forbidden: insufficient permissions to write to this document");
    await expect(
      listPreviewDocuments(SWITCHBOARD_URL, "preview-x"),
    ).rejects.toThrow(/authorize agent/i);
  });

  it("explains a permission gap when a token was already attached", async () => {
    mockGraphqlError("Forbidden: insufficient permissions to write to this document");
    await expect(
      listPreviewDocuments(SWITCHBOARD_URL, "preview-x", "tok-123"),
    ).rejects.toThrow(/admin/i);
  });

  it("leaves non-permission GraphQL errors unchanged", async () => {
    mockGraphqlError("Variable \"$x\" is not defined");
    await expect(
      listPreviewDocuments(SWITCHBOARD_URL, "preview-x"),
    ).rejects.toThrow(/is not defined/);
  });
});

describe("preview drive URL builders", () => {
  it("driveRemoteUrl swaps /graphql for /d/<id>", () => {
    expect(driveRemoteUrl("http://localhost:4001/graphql", "abc")).toBe("http://localhost:4001/d/abc");
    expect(driveRemoteUrl("http://localhost:4001/graphql/", "abc")).toBe("http://localhost:4001/d/abc");
  });

  it("buildPreviewDriveRootPath appends an encoded driveUrl param when given", () => {
    expect(buildPreviewDriveRootPath("abc")).toBe("/d/abc?embed=1");
    const remote = "http://localhost:4001/d/abc";
    expect(buildPreviewDriveRootPath("abc", remote)).toBe(
      `/d/abc?embed=1&driveUrl=${encodeURIComponent(remote)}`,
    );
  });

  it("browserDriveRemoteUrl routes through the proxy switchboard mount when a proxy is configured", () => {
    expect(
      browserDriveRemoteUrl({
        driveId: "abc",
        proxyUrl: "https://wise-hare.vetra.io",
        switchboardUrl: "http://localhost:4001/graphql",
      }),
    ).toBe("https://wise-hare.vetra.io/reactor-project/switchboard/d/abc");
    // trailing slash on the proxy URL is stripped
    expect(
      browserDriveRemoteUrl({ driveId: "abc", proxyUrl: "http://localhost:8090/" }),
    ).toBe("http://localhost:8090/reactor-project/switchboard/d/abc");
    // a proxy under a base path keeps the path prefix
    expect(
      browserDriveRemoteUrl({ driveId: "abc", proxyUrl: "https://host/myagent" }),
    ).toBe("https://host/myagent/reactor-project/switchboard/d/abc");
  });

  it("browserDriveRemoteUrl falls back to the switchboard origin without a proxy", () => {
    expect(
      browserDriveRemoteUrl({
        driveId: "abc",
        switchboardUrl: "http://localhost:4001/graphql",
      }),
    ).toBe("http://localhost:4001/d/abc");
    expect(browserDriveRemoteUrl({ driveId: "abc" })).toBeUndefined();
  });
});
