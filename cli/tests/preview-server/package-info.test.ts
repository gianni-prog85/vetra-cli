import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readProjectPackage } from "../../src/preview-server/package-info.js";

describe("readProjectPackage without a project", () => {
  let workdir: string;
  beforeEach(() => {
    workdir = mkdtempSync(path.join(tmpdir(), "package-info-"));
  });
  afterEach(() => rmSync(workdir, { recursive: true, force: true }));

  it("reads the workdir itself when it is the project (the project home)", async () => {
    writeFileSync(path.join(workdir, "powerhouse.config.json"), "{}\n");
    writeFileSync(
      path.join(workdir, "package.json"),
      JSON.stringify({ name: "@acme/shop", version: "1.0.9" }),
    );
    await expect(readProjectPackage(workdir, "")).resolves.toEqual({
      kind: "ok",
      project: "",
      name: "@acme/shop",
      version: "1.0.9",
    });
  });

  it("a workdir that is no project is an unknown project", async () => {
    await expect(readProjectPackage(workdir, "")).resolves.toMatchObject({
      kind: "unknown-project",
    });
  });
});
