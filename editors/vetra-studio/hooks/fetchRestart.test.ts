import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  fetchRestart,
  setPreviewConfigSkipForTests,
} from "./preview-server-client.js";

// Read studio.config.json (component tests skip it).
beforeAll(() => setPreviewConfigSkipForTests(false));

const urls: string[] = [];

function respond(status: number, body: unknown): void {
  urls.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      urls.push(url);
      // The Cli's local API, as studio.config.json names it.
      const response = url.endsWith("studio.config.json")
        ? new Response(
            JSON.stringify({ previewServerUrl: "http://127.0.0.1:61234" }),
          )
        : new Response(JSON.stringify(body), { status });
      return Promise.resolve(response);
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchRestart", () => {
  it("posts /restart (the Studio's own project) and returns the result", async () => {
    respond(202, { kind: "started" });
    expect(await fetchRestart()).toMatchObject({ kind: "started" });
    expect(urls).toContain("http://127.0.0.1:61234/restart");
  });

  it("returns null on a Studio without /restart, so the caller can start", async () => {
    respond(404, { error: "not found", path: "/restart" });
    expect(await fetchRestart()).toBeNull();
  });

  it("a refused restart says so and never falls back to a start", async () => {
    respond(403, { error: "forbidden" });
    await expect(fetchRestart()).rejects.toThrow(
      "Couldn't restart the preview.",
    );
    expect(urls.some((u) => u.includes("/start"))).toBe(false);
  });

  it("an unauthenticated restart (401) is refused the same way", async () => {
    respond(401, { error: "unauthorized" });
    await expect(fetchRestart()).rejects.toThrow(
      "Couldn't restart the preview.",
    );
  });

  it("a workdir that is no project is a result, not a missing route", async () => {
    respond(404, { kind: "unknown-project", error: "unknown project" });
    expect(await fetchRestart()).toMatchObject({ kind: "unknown-project" });
  });
});
