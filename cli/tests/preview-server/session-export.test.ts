import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { unzipSync, strFromU8 } from "fflate";

import { buildSessionExport, listSessions } from "../../src/preview-server/session-export.js";
import { makeWorkdir } from "../spec/_fixtures.js";

const SESSION_ID = "sess-1";
const CHAT_TYPE = "powerhouse/chat-session";

interface FakeDoc {
  header: { id: string; name?: string; documentType: string };
  state?: unknown;
}

function makeDrive(overrides?: {
  children?: FakeDoc[][];
  session?: unknown;
  ops?: unknown[];
}) {
  const session =
    overrides && "session" in overrides
      ? overrides.session
      : {
          header: { id: SESSION_ID, name: "S", documentType: CHAT_TYPE },
          state: { global: { threadId: "t-1", resourceId: SESSION_ID, status: "ACTIVE" } },
        };
  // The drive's `child` documents, page by page.
  const pages = overrides?.children ?? [
    [
      session as FakeDoc,
      { header: { id: "other", name: "spec", documentType: "powerhouse/spec" } },
    ],
  ];
  const ops = overrides?.ops ?? [{ index: 0 }];
  const page = (i: number, type: string): unknown => ({
    results: pages[i].filter((d) => d.header.documentType === type),
    next: i + 1 < pages.length ? async () => page(i + 1, type) : undefined,
  });
  const client = {
    get: async (id: string) => (id === SESSION_ID ? session : null),
    find: async (search: { type: string; parentId: string }) =>
      search.parentId === "drive-1" ? page(0, search.type) : { results: [] },
    getOperations: async () => ({ results: ops, next: undefined }),
  };
  return { reactor: { client }, driveId: "drive-1" } as never;
}

const META = { versions: { vetraCli: "x", ph: "y" }, agentLogging: false };

describe("session-export listSessions / buildSessionExport", () => {
  let workdir: string;
  let cleanup: () => void;
  beforeEach(() => ({ workdir, cleanup } = makeWorkdir()));
  afterEach(() => cleanup());

  it("lists only the drive's chat sessions, from their state", async () => {
    const sessions = await listSessions(makeDrive());
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      id: SESSION_ID,
      name: "S",
      status: "ACTIVE",
      threadId: "t-1",
    });
  });

  it("reads every page, past one without a session", async () => {
    const later = {
      header: { id: "sess-2", name: "Later", documentType: CHAT_TYPE },
      state: { global: { status: "ENDED" } },
    };
    const sessions = await listSessions(
      makeDrive({
        children: [
          [{ header: { id: "spec-1", documentType: "powerhouse/spec" } }],
          [later],
        ],
      }),
    );
    expect(sessions.map((s) => s.id)).toEqual(["sess-2"]);
  });

  it("exports a zip with the doc, operations, and metadata (no mastra db here)", async () => {
    const res = await buildSessionExport(makeDrive(), workdir, SESSION_ID, META);
    expect(res.kind).toBe("ok");
    if (res.kind !== "ok") return;
    const entries = unzipSync(res.zip);
    const names = Object.keys(entries);
    expect(names).toContain("chat-session.json");
    expect(names).toContain("chat-session-operations.json");
    expect(names).toContain("metadata.json");
    expect(names).not.toContain("mastra-thread.json");
    const meta = JSON.parse(strFromU8(entries["metadata.json"]));
    expect(meta.sources).toMatchObject({ chatSession: true, mastraThread: false });
    expect(meta.threadId).toBe("t-1");
  });

  it("sanitizes the session id in the download filename", async () => {
    const drive = makeDrive();
    const nasty = 'a/b"c\r\nx';
    // Route the nasty id to the same session doc so it resolves.
    (drive as unknown as { reactor: { client: { get: (id: string) => Promise<unknown> } } }).reactor.client.get =
      async (id: string) => ({ header: { id }, state: { global: { threadId: null } } });
    const res = await buildSessionExport(drive, workdir, nasty, META);
    expect(res.kind).toBe("ok");
    if (res.kind !== "ok") return;
    expect(res.filename).toMatch(/^vetra-session-[A-Za-z0-9._-]+\.zip$/);
  });

  it("returns not-found for an unknown session id", async () => {
    const res = await buildSessionExport(makeDrive(), workdir, "nope", META);
    expect(res.kind).toBe("not-found");
  });
});
