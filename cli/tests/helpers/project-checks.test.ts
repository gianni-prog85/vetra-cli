import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path, { join } from "node:path";
import { createProcessManager } from "@powerhousedao/clint";
import { isModulePath, parseTscOutput, runChecks } from "../../src/helpers/project-checks.js";

const base = "/proj";
const genFile = join(base, "document-models", "wt", "v1", "gen", "reducer.ts");
const reducerSrc = join(
  base,
  "document-models",
  "wt",
  "v1",
  "src",
  "reducers",
  "workouts.ts",
);
const editorSrc = join(base, "editors", "wt-editor", "components", "editor.tsx");
const appFile = join(base, "apps", "wt-app", "index.ts");
const rootFile = join(base, "vite.config.ts");

describe("isModulePath", () => {
  it("covers generated output", () => {
    expect(isModulePath(genFile)).toBe(true);
  });

  it("covers the editable reducer implementation outside gen/", () => {
    // The regression this guards: a malformed reducer lands here and must be
    // in scope so spec-generate's typecheck catches it.
    expect(isModulePath(reducerSrc)).toBe(true);
  });

  it("covers editor sources (no gen/ split)", () => {
    expect(isModulePath(editorSrc)).toBe(true);
  });

  it("covers app sources", () => {
    expect(isModulePath(appFile)).toBe(true);
  });

  it("excludes non-module project files", () => {
    expect(isModulePath(rootFile)).toBe(false);
  });
});

describe("parseTscOutput", () => {
  const lines = [
    "editors/todo/editor.ts(2,3): error TS2339: Property 'foo' does not exist on type '1'.",
    "editors/todo/editor.ts(4,1): warning TS6133: 'x' is declared but its value is never read.",
  ];

  it("reads LF output (TypeScript 7, and up to 6 on POSIX)", () => {
    const found = parseTscOutput(`${lines.join("\n")}\n`, base, "all");
    expect(found.map((d) => [d.line, d.column, d.code, d.severity])).toEqual([
      [2, 3, "TS2339", "error"],
      [4, 1, "TS6133", "warning"],
    ]);
  });

  it("reads CRLF output (TypeScript up to 6 on Windows)", () => {
    const found = parseTscOutput(`${lines.join("\r\n")}\r\n`, base, "all");
    expect(found).toHaveLength(2);
    expect(found[0].message).toBe("Property 'foo' does not exist on type '1'.");
  });
});

/** This repo's tsc (6) and eslint, reached through a linked node_modules and
 * started the way the Cli starts them (clint's process manager, a shell). */
describe("runChecks on this machine", () => {
  const REPO_NODE_MODULES = path.resolve(import.meta.dirname, "..", "..", "..", "node_modules");
  let project: string;
  let linked: string;
  beforeEach(() => {
    project = mkdtempSync(path.join(tmpdir(), "project-checks-"));
    linked = path.join(project, "node_modules");
    symlinkSync(REPO_NODE_MODULES, linked, "junction");
    writeFileSync(
      path.join(project, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { strict: true, noEmit: true, types: [] }, include: ["editors", "root.ts"] }),
    );
    writeFileSync(
      path.join(project, "eslint.config.js"),
      'module.exports = [{ files: ["**/*.ts"], rules: { "no-useless-concat": "error" } }];\n',
    );
    mkdirSync(path.join(project, "editors", "todo"), { recursive: true });
    writeFileSync(
      path.join(project, "editors", "todo", "editor.ts"),
      'export const n = 1;\nn.foo();\nexport const s = "a" + "b";\n',
    );
    // Outside the module trees: reported for `all`, not for `module`.
    writeFileSync(path.join(project, "root.ts"), "export const r: number = 'x';\n");
  });
  afterEach(() => {
    unlinkSync(linked);
    rmSync(project, { recursive: true, force: true });
  });

  it(
    "runs tsc and eslint and parses what they report",
    async () => {
      const pm = createProcessManager();
      const outcome = await runChecks(project, (command, opts) => pm.run(command, opts), {
        scope: "module",
      });

      expect(outcome.notes).toEqual([]);
      expect(outcome.ran).toEqual({ tsc: { failedToRun: undefined }, eslint: { failedToRun: undefined } });
      const found = outcome.diagnostics.map((d) => [d.source, path.basename(d.file), d.line, d.column, d.code]);
      expect(found).toEqual([
        ["tsc", "editor.ts", 2, 3, "TS2339"],
        ["eslint", "editor.ts", 3, 22, "no-useless-concat"],
      ]);
    },
    120_000,
  );
});
