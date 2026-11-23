/**
 * Parity check of the generation engine in `cli/src/generation` against the
 * linked monorepo's `ph-cli generate`.
 *
 * Two copies of one fixture project get the same spec files. One is generated
 * by `ph-cli generate <kind> --document <file>`, the other by the engine in
 * this process; after each kind the two trees are compared. Then both are
 * extracted (`--extract`, per kind and `all`) and the specs compared.
 *
 * Run: `pnpm run parity:generation` (add `-- --keep` to keep the two trees).
 * Exits 1 on any difference.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  DocumentModelGlobalState,
  PHDocument,
} from "@powerhousedao/shared/document-model";
import {
  extractSpecFiles,
  generateFromSpecFile,
  GENERATION_KINDS,
  type GenerationKind,
} from "../../../src/generation/run.js";
import { getDocument } from "../../../src/generation/spec/spec-api.js";
import { getSpecEntry, saveSpec } from "../../../src/generation/spec/specs.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../../..");
const require = createRequire(import.meta.url);

const keep = process.argv.includes("--keep");

/** The linked monorepo's ph-cli entry, run with this Node. */
function phCliEntry(): { entry: string; version: string } {
  const manifestPath = require.resolve("@powerhousedao/ph-cli/package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    version: string;
    bin: Record<string, string>;
  };
  return {
    entry: join(dirname(manifestPath), manifest.bin["ph-cli"]),
    version: manifest.version,
  };
}

const phCli = phCliEntry();

function runPhCli(args: string[], cwd: string): string {
  const result = spawnSync(process.execPath, [phCli.entry, ...args], {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, FORCE_COLOR: "0" },
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.status !== 0) {
    throw new Error(
      `ph-cli ${args.join(" ")} exited ${String(result.status)}:\n${output}`,
    );
  }
  return output;
}

const MODEL_TYPE = "powerhouse/document-model";

function modelState(): DocumentModelGlobalState {
  return JSON.parse(
    readFileSync(
      join(repoRoot, "document-models/studio-product/studio-product.json"),
      "utf8",
    ),
  ) as DocumentModelGlobalState;
}

function specDocument(documentType: string, name: string, global: unknown) {
  const doc = getSpecEntry(documentType).createDocument({ global });
  doc.header.name = name;
  return doc;
}

/** The fixture project with one spec per kind (two processors); resolves to the spec paths by kind. */
async function seedProject(
  dir: string,
): Promise<Record<GenerationKind, string[]>> {
  cpSync(join(here, "fixture"), dir, { recursive: true });
  const model = modelState();
  const documentTypes = [{ id: "dt-1", documentType: model.id }];
  const save = (doc: PHDocument) => saveSpec(doc, dir);
  return {
    "document-model": [await save(specDocument(MODEL_TYPE, model.name, model))],
    editor: [
      await save(
        specDocument("powerhouse/document-editor", "Product Editor", {
          name: "Product Editor",
          documentTypes,
          status: "CONFIRMED",
        }),
      ),
    ],
    app: [
      await save(
        specDocument("powerhouse/app", "Product Explorer", {
          name: "Product Explorer",
          status: "CONFIRMED",
          allowedDocumentTypes: [model.id],
          isDragAndDropEnabled: true,
        }),
      ),
    ],
    subgraph: [
      await save(
        specDocument("powerhouse/subgraph", "Product Search", {
          name: "Product Search",
          status: "CONFIRMED",
        }),
      ),
    ],
    processor: [
      await save(
        specDocument("powerhouse/processor", "Product Index", {
          name: "Product Index",
          type: "relational",
          documentTypes,
          status: "CONFIRMED",
          processorApps: ["switchboard"],
        }),
      ),
      await save(
        specDocument("powerhouse/processor", "Product Stats", {
          name: "Product Stats",
          type: "analytics",
          documentTypes,
          status: "CONFIRMED",
          processorApps: ["connect", "switchboard"],
        }),
      ),
    ],
  };
}

/** Relative path → content hash, for every file outside node_modules and specs/. */
function tree(root: string): Map<string, string> {
  const files = new Map<string, string>();
  for (const entry of readdirSync(root, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    const rel = relative(root, path).replaceAll("\\", "/");
    if (rel.startsWith("node_modules/") || rel.startsWith("specs/")) continue;
    files.set(rel, createHash("sha256").update(readFileSync(path)).digest("hex"));
  }
  return files;
}

function diffTrees(a: Map<string, string>, b: Map<string, string>): string[] {
  const differences: string[] = [];
  for (const [path, hash] of a) {
    if (!b.has(path)) differences.push(`only ph-cli: ${path}`);
    else if (b.get(path) !== hash) differences.push(`content differs: ${path}`);
  }
  for (const path of b.keys()) {
    if (!a.has(path)) differences.push(`only engine: ${path}`);
  }
  return differences.sort();
}

function changedSince(before: Map<string, string>, after: Map<string, string>) {
  let changed = 0;
  for (const [path, hash] of after) if (before.get(path) !== hash) changed++;
  return changed;
}

/** A spec without what differs from run to run: ids, timestamps, hashes. */
async function comparableSpec(path: string): Promise<string> {
  const doc = await getDocument(path);
  const scrub = (value: unknown, key?: string): unknown => {
    if (Array.isArray(value)) return value.map((item) => scrub(item));
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, scrub(v, k)]),
      );
    }
    return key === "id" && typeof value === "string" ? "<id>" : value;
  };
  return JSON.stringify(
    {
      documentType: doc.header.documentType,
      name: doc.header.name,
      state: scrub((doc.state as Record<string, unknown>).global),
    },
    null,
    1,
  );
}

async function specs(root: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  const dir = join(root, "specs");
  let entries;
  try {
    entries = readdirSync(dir, { recursive: true, withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    files.set(
      relative(root, path).replaceAll("\\", "/"),
      await comparableSpec(path),
    );
  }
  return files;
}

const results: { step: string; files: string; differences: string[] }[] = [];

function record(step: string, files: string, differences: string[]) {
  results.push({ step, files, differences });
  console.log(
    `${differences.length === 0 ? "same  " : "DIFFER"}  ${step}  (${files})`,
  );
  for (const difference of differences) console.log(`          ${difference}`);
}

const work = mkdtempSync(join(tmpdir(), "vetra-generation-parity-"));
const seed = join(work, "seed");
const phDir = join(work, "ph-cli");
const engineDir = join(work, "engine");

console.log(`ph-cli ${phCli.version} (${phCli.entry})`);
console.log(`trees: ${work}`);

try {
  const seeded = await seedProject(seed);
  cpSync(seed, phDir, { recursive: true });
  cpSync(seed, engineDir, { recursive: true });
  const inDir = (dir: string, path: string) => join(dir, relative(seed, path));

  for (const kind of GENERATION_KINDS) {
    const before = tree(phDir);
    for (const spec of seeded[kind]) {
      const installs = kind === "processor" || kind === "subgraph";
      runPhCli(
        [
          "generate",
          kind,
          "--document",
          inDir(phDir, spec),
          ...(installs ? ["--skip-install"] : []),
        ],
        phDir,
      );
      await generateFromSpecFile(kind, inDir(engineDir, spec), engineDir, {
        skipInstall: true,
        quiet: true,
        log: () => {},
        warn: () => {},
      });
    }
    const after = tree(phDir);
    record(
      `generate ${kind} --document`,
      `${changedSince(before, after)} files written, ${after.size} compared`,
      diffTrees(after, tree(engineDir)),
    );
  }

  for (const kind of [...GENERATION_KINDS, "all"] as const) {
    rmSync(join(phDir, "specs"), { recursive: true, force: true });
    rmSync(join(engineDir, "specs"), { recursive: true, force: true });
    runPhCli(["generate", kind, "--extract"], phDir);
    await extractSpecFiles(kind, engineDir);
    const phSpecs = await specs(phDir);
    record(
      `generate ${kind} --extract`,
      `${phSpecs.size} specs`,
      diffTrees(phSpecs, await specs(engineDir)),
    );
  }
} finally {
  if (keep) {
    mkdirSync(work, { recursive: true });
    writeFileSync(join(work, "results.json"), JSON.stringify(results, null, 2));
  } else {
    rmSync(work, { recursive: true, force: true, maxRetries: 10 });
  }
}

const differing = results.filter((result) => result.differences.length > 0);
console.log(
  differing.length === 0
    ? `parity: ${results.length} steps, no differences`
    : `parity: ${differing.length} of ${results.length} steps differ`,
);
process.exitCode = differing.length === 0 ? 0 : 1;
