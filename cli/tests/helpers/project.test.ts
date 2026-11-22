import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertProjectInstalled, projectRoot } from "../../src/helpers/project.js";

describe("projectRoot", () => {
  let workdir: string;
  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), "vetra-project-"));
  });
  afterEach(() => {
    rmSync(workdir, { recursive: true, force: true });
  });

  it("is the workdir when it is a Reactor package", async () => {
    writeFileSync(join(workdir, "powerhouse.config.json"), "{}", "utf8");
    await expect(projectRoot(workdir)).resolves.toBe(workdir);
  });

  it("refuses a workdir without powerhouse.config.json, and never picks a subfolder", async () => {
    // A project in a subfolder is not discovered: Studio works in one project.
    mkdirSync(join(workdir, "alpha"));
    writeFileSync(join(workdir, "alpha", "powerhouse.config.json"), "{}", "utf8");
    await expect(projectRoot(workdir)).rejects.toThrow(
      /The workdir is not a Reactor Package project \(no powerhouse\.config\.json at .*\)\.\nStudio works inside one project/,
    );
  });
});

describe("assertProjectInstalled", () => {
  let workdir: string;
  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), "vetra-project-"));
    writeFileSync(join(workdir, "powerhouse.config.json"), "{}", "utf8");
  });
  afterEach(() => {
    rmSync(workdir, { recursive: true, force: true });
  });

  it("refuses a project with no install, and says not to hand-write it", async () => {
    writeFileSync(join(workdir, "package.json"), "{}", "utf8");
    await expect(assertProjectInstalled(workdir)).rejects.toThrow(
      /The project is not installed \(no node_modules at [\s\S]*pnpm install[\s\S]*never hand-write/,
    );
  });

  it("accepts an installed project", async () => {
    mkdirSync(join(workdir, "node_modules"));
    await expect(assertProjectInstalled(workdir)).resolves.toBeUndefined();
  });
});
