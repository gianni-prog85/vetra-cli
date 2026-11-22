/**
 * projectBin: how a project's `.bin` tool is started without a shell, per
 * platform, and that the command it gives really runs on this machine.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { projectBin } from "../../src/helpers/project-bin.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");

describe("projectBin", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "project-bin-"));
    mkdirSync(path.join(root, "node_modules", ".bin"), { recursive: true });
    mkdirSync(path.join(root, "node_modules", "typescript", "bin"), { recursive: true });
    writeFileSync(path.join(root, "node_modules", ".bin", "tsc"), "");
    writeFileSync(
      path.join(root, "node_modules", "typescript", "package.json"),
      JSON.stringify({ name: "typescript", bin: { tsc: "./bin/tsc" } }),
    );
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("is the shim itself on POSIX", () => {
    expect(projectBin(root, "tsc", "typescript", "linux")).toEqual({
      file: path.join(root, "node_modules", ".bin", "tsc"),
      args: [],
    });
  });

  it("is this node with the package's JS bin on Windows", () => {
    expect(projectBin(root, "tsc", "typescript", "win32")).toEqual({
      file: process.execPath,
      args: [path.join(root, "node_modules", "typescript", "bin", "tsc")],
    });
  });

  it("takes a string bin as the package's own command", () => {
    writeFileSync(path.join(root, "node_modules", ".bin", "eslint"), "");
    mkdirSync(path.join(root, "node_modules", "eslint"), { recursive: true });
    writeFileSync(
      path.join(root, "node_modules", "eslint", "package.json"),
      JSON.stringify({ name: "eslint", bin: "./bin/eslint.js" }),
    );
    expect(projectBin(root, "eslint", "eslint", "win32")?.args).toEqual([
      path.join(root, "node_modules", "eslint", "bin", "eslint.js"),
    ]);
  });

  it("is null without the shim, or on Windows without the package", () => {
    expect(projectBin(root, "eslint", "eslint", "linux")).toBeNull();
    rmSync(path.join(root, "node_modules", "typescript"), { recursive: true });
    expect(projectBin(root, "tsc", "typescript", "win32")).toBeNull();
  });

  it("gives a command that runs on this platform (this repo's tsc)", () => {
    const bin = projectBin(REPO_ROOT, "tsc", "typescript");
    expect(bin).not.toBeNull();
    const out = execFileSync(bin!.file, [...bin!.args, "--version"], {
      encoding: "utf8",
      windowsHide: true,
    });
    expect(out).toMatch(/^Version \d+\.\d+/);
  });
});
