/**
 * ts-check runs the edited file's project tools for real: this repo's tsc and
 * eslint, reached through a linked `node_modules`, on this machine's platform
 * (on Windows through `projectBin`'s node + JS bin).
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { lintAndTypecheck } from "../../src/lifecycle/ts-check.js";

const REPO_NODE_MODULES = path.resolve(import.meta.dirname, "..", "..", "..", "node_modules");
const TIMEOUT = 120_000;

describe("ts-check runs the project's tools", () => {
  let project: string;
  let linked: string;
  beforeEach(() => {
    project = mkdtempSync(path.join(tmpdir(), "ts-check-"));
    linked = path.join(project, "node_modules");
    // A junction on Windows (no privilege needed); a symlink elsewhere.
    symlinkSync(REPO_NODE_MODULES, linked, "junction");
    writeFileSync(
      path.join(project, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { strict: true, noEmit: true, types: [] }, include: ["editors"] }),
    );
    mkdirSync(path.join(project, "editors", "todo"), { recursive: true });
  });
  afterEach(() => {
    // The link first, so nothing can reach the repo's node_modules.
    unlinkSync(linked);
    rmSync(project, { recursive: true, force: true });
  });

  it(
    "reports the written file's tsc errors only, under the tool-call path",
    async () => {
      const file = path.join(project, "editors", "todo", "editor.ts");
      writeFileSync(file, "export const n: number = 'x';\n");
      writeFileSync(path.join(project, "editors", "todo", "other.ts"), "export const s: string = 1;\n");

      const problems = await lintAndTypecheck(file, "todo/editors/todo/editor.ts", undefined);

      expect(problems).toHaveLength(1);
      expect(problems[0]).toMatch(/^tsc:\n/);
      expect(problems[0]).toContain("todo/editors/todo/editor.ts(1,14): error TS2322");
      expect(problems[0]).not.toContain("other.ts");
    },
    TIMEOUT,
  );

  it(
    "reports what eslint --fix leaves, under the tool-call path",
    async () => {
      writeFileSync(
        path.join(project, "eslint.config.js"),
        'module.exports = [{ files: ["**/*.ts"], rules: { "no-undef": "error" } }];\n',
      );
      const file = path.join(project, "editors", "todo", "editor.ts");
      writeFileSync(file, "export const a = missingThing;\n");

      const problems = await lintAndTypecheck(file, "todo/editors/todo/editor.ts", undefined);

      const eslint = problems.find((p) => p.startsWith("eslint:"));
      expect(eslint).toBeDefined();
      expect(eslint).toContain("todo/editors/todo/editor.ts");
      expect(eslint).toContain("no-undef");
      expect(eslint).not.toContain(project);
    },
    TIMEOUT,
  );
});
