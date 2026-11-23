import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = join(__dirname, "..", "src", "main.ts");
// tsx's own entry, run by this node: the `.bin/tsx` shim is a shell script,
// which Windows cannot spawn without a shell.
const TSX_CLI = createRequire(import.meta.url).resolve("tsx/cli");

type RunResult = { stdout: string; stderr: string; code: number };

async function run(
  opts: { workdir?: string; input?: string },
  ...args: string[]
): Promise<RunResult> {
  const cliArgs = opts.workdir ? ["-w", opts.workdir, ...args] : args;
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    // One-shot: no switchboard drive to attach to.
    delete env.VETRA_SWITCHBOARD_URL;
    const child = spawn(process.execPath, [TSX_CLI, CLI_PATH, ...cliArgs], {
      stdio: ["pipe", "pipe", "pipe"],
      env,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ stdout, stderr, code: code ?? 1 }));
    if (opts.input !== undefined) child.stdin.write(opts.input);
    child.stdin.end();
  });
}

describe("vetra spec-* (e2e)", () => {
  // E2E spawns tsx; bump the per-test timeout to absorb the warm-up.
  const TIMEOUT = 60_000;

  it(
    "--help lists all spec-* commands",
    async () => {
      const { stdout, code } = await run({}, "--help");
      expect(code).toBe(0);
      for (const cmd of [
        "spec-list",
        "spec-get",
        "spec-create",
        "spec-update",
        "spec-delete",
        "spec-extract",
        "spec-generate",
        "spec-schema-list",
        "spec-schema",
        "reactor-project-build",
        "reactor-project-check",
        "reactor-project-publish",
      ]) {
        expect(stdout).toContain(cmd);
      }
      // Studio creates no project: no init command.
      expect(stdout).not.toContain("reactor-project-init");
    },
    TIMEOUT,
  );

  it(
    "with no drive to reach, says where specifications live and writes no specs/ folder",
    async () => {
      const workdir = mkdtempSync(join(tmpdir(), "vetra-e2e-"));
      writeFileSync(join(workdir, "powerhouse.config.json"), "{}\n");
      mkdirSync(join(workdir, "node_modules"));
      try {
        for (const args of [
          ["spec-list"],
          ["spec-create", "--type", "powerhouse/document-model", "--name", "E2E"],
          ["spec-get", "--name", "E2E"],
        ]) {
          const r = await run({ workdir }, ...args);
          expect(r.code).not.toBe(0);
          expect(r.stderr).toMatch(/Specifications are kept in the Studio drive/);
          expect(r.stderr).toMatch(/VETRA_SWITCHBOARD_URL/);
        }
        expect(existsSync(join(workdir, "specs"))).toBe(false);
      } finally {
        rmSync(workdir, { recursive: true, force: true });
      }
    },
    TIMEOUT,
  );

  it(
    "spec-schema --action returns the raw GraphQL for the named action",
    async () => {
      const { stdout, code } = await run(
        {},
        "spec-schema",
        "--type",
        "powerhouse/document-model",
        "--action",
        "SET_MODEL_NAME",
      );
      expect(code).toBe(0);
      expect(stdout).toMatch(/^input SetModelNameInput/);
      expect(stdout).toMatch(/name: String!/);
    },
    TIMEOUT,
  );

  it(
    "spec-schema rejects mutually-exclusive --action + --state",
    async () => {
      const { stderr, code } = await run(
        {},
        "spec-schema",
        "--type",
        "powerhouse/document-model",
        "--action",
        "SET_MODEL_NAME",
        "--state",
      );
      expect(code).not.toBe(0);
      expect(stderr).toMatch(/mutually exclusive/);
    },
    TIMEOUT,
  );

  it(
    "required flag missing fails non-zero",
    async () => {
      const { code, stderr } = await run({}, "spec-get");
      expect(code).not.toBe(0);
      expect(stderr).toMatch(/name/);
    },
    TIMEOUT,
  );
});
