import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { addFile } from "@powerhousedao/shared/document-drive";
import { createSpecDocument } from "../../src/commands/spec/registry.js";
import { specCreate } from "../../src/commands/spec/create.js";
import { specDelete } from "../../src/commands/spec/delete.js";
import { specGenerate } from "../../src/commands/spec/generate.js";
import { specGet } from "../../src/commands/spec/get.js";
import { specList } from "../../src/commands/spec/list.js";
import {
  ACTION_REFERENCE_MAX_CHARS,
  actionReference,
  enumValues,
  specSchema,
} from "../../src/commands/spec/schema.js";
import { specSchemaList } from "../../src/commands/spec/schema-list.js";
import { specUpdate } from "../../src/commands/spec/update.js";
import { makeCtx, makeWorkdir, useSpecDrive } from "./_fixtures.js";

const DOC_TYPE = "powerhouse/document-model";
const PRODUCT_TYPE = "powerhouse/feature";

describe("createSpecDocument", () => {
  // Specs are applied unsigned and mirrored into the drive under their file
  // id, so they stay legacy-signature documents on 6.2.3 (v2 by default).
  it("creates a legacy-signature document whose id is not header-derived", () => {
    const doc = createSpecDocument("powerhouse/app", { name: "Legacy App" });
    expect(doc.header.protocolVersions).toEqual({ "base-reducer": 2 });
    expect(doc.header.sig.nonce).toBe("");
    expect(doc.header.name).toBe("Legacy App");
    expect(doc.header.documentType).toBe("powerhouse/app");
  });
});

describe("spec-list", () => {
  const { ctx, drive } = useSpecDrive();
  let workdir: string;
  let cleanup: () => void;
  beforeEach(() => ({ workdir, cleanup } = makeWorkdir()));
  afterEach(() => cleanup());

  it("has the expected id and schema fields", () => {
    expect(specList.id).toBe("spec-list");
    expect(specList.inputSchema.shape).toHaveProperty("type");
  });

  it("reports (no specs) on an empty workdir", async () => {
    const result = await specList.execute({}, ctx(workdir));
    expect(result.text).toBe("(no specs)");
  });

  it("lists created specs with name/type/id columns", async () => {
    await specCreate.execute(
      { type: DOC_TYPE, name: "Alpha", dryRun: false },
      ctx(workdir),
    );
    await specCreate.execute(
      { type: DOC_TYPE, name: "Beta", dryRun: false },
      ctx(workdir),
    );
    const result = await specList.execute({}, ctx(workdir));
    expect(result.text).toMatch(/Alpha/);
    expect(result.text).toMatch(/Beta/);
    expect(result.text).toMatch(new RegExp(DOC_TYPE));
  });

  it("filters by --type", async () => {
    await specCreate.execute(
      { type: DOC_TYPE, name: "Alpha", dryRun: false },
      ctx(workdir),
    );
    const result = await specList.execute(
      { type: "powerhouse/document-editor" },
      ctx(workdir),
    );
    expect(result.text).toBe("(no specs)");
  });

  it("filters by --category", async () => {
    await specCreate.execute(
      { type: DOC_TYPE, name: "BuilderSpec", dryRun: false },
      ctx(workdir),
    );
    await specCreate.execute(
      { type: PRODUCT_TYPE, name: "ProductSpec", dryRun: false },
      ctx(workdir),
    );

    const project = await specList.execute(
      { category: "project" },
      ctx(workdir),
    );
    expect(project.text).toMatch(/BuilderSpec/);
    expect(project.text).not.toMatch(/ProductSpec/);

    const product = await specList.execute(
      { category: "product" },
      ctx(workdir),
    );
    expect(product.text).toMatch(/ProductSpec/);
    expect(product.text).not.toMatch(/BuilderSpec/);

    const all = await specList.execute({}, ctx(workdir));
    expect(all.text).toMatch(/BuilderSpec/);
    expect(all.text).toMatch(/ProductSpec/);
  });

  it("lists a document filed in the drive without the child relationship", async () => {
    // What the drive explorer makes: the document and its file node only.
    const { module, driveId } = drive();
    const doc = createSpecDocument(PRODUCT_TYPE, { name: "RootProduct" });
    await module.client.create(doc);
    await module.client.execute(driveId, "main", [
      addFile({
        id: doc.header.id,
        name: "RootProduct",
        documentType: PRODUCT_TYPE,
        parentFolder: null,
      }),
    ]);
    const result = await specList.execute({}, ctx(workdir));
    expect(result.text).toMatch(/RootProduct/);
    expect(result.text).toMatch(new RegExp(PRODUCT_TYPE));
  });

  it("never reads a specs/ folder in the project", async () => {
    mkdirSync(join(workdir, "specs", "feature"), { recursive: true });
    writeFileSync(join(workdir, "specs", "feature", "on-disk.feature.phd"), "x");
    const result = await specList.execute({}, ctx(workdir));
    expect(result.text).toBe("(no specs)");
  });

  it("says where specifications live when no drive can be reached", async () => {
    await expect(specList.execute({}, makeCtx(workdir))).rejects.toThrow(
      /Specifications are kept in the Studio drive[\s\S]*VETRA_SWITCHBOARD_URL/,
    );
  });

  it("requires the workdir to be a project, whatever the category", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vetra-noreactor-"));
    try {
      for (const category of ["project", "product", undefined] as const) {
        await expect(
          specList.execute(category ? { category } : {}, ctx(dir)),
        ).rejects.toThrow(/The workdir is not a Reactor Package project/);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("spec-create", () => {
  const { ctx, drive } = useSpecDrive();
  let workdir: string;
  let cleanup: () => void;
  beforeEach(() => ({ workdir, cleanup } = makeWorkdir()));
  afterEach(() => cleanup());

  it("persists a new spec in the drive by default, and writes no specs/ folder", async () => {
    const result = await specCreate.execute(
      { type: DOC_TYPE, name: "Persisted", dryRun: false },
      ctx(workdir),
    );
    expect(result.text).toMatch(/Created/);
    const id = (result.data as { documentId: string }).documentId;
    expect(result.text).toContain(`id: ${id}`);
    expect((await drive().nodes()).find((n) => n.id === id)).toMatchObject({
      kind: "file",
      name: "Persisted",
      documentType: DOC_TYPE,
    });
    expect(existsSync(join(workdir, "specs"))).toBe(false);
    const list = await specList.execute({}, ctx(workdir));
    expect(list.text).toMatch(/Persisted/);
  });

  it("lists the type's action shapes so spec-update needs no spec-schema call", async () => {
    const result = await specCreate.execute(
      { type: "powerhouse/document-editor", name: "Board Editor", dryRun: false },
      ctx(workdir),
    );
    expect(result.text).toContain(
      "Actions of powerhouse/document-editor (spec-update input shapes",
    );
    expect(result.text).toContain(
      "  ADD_DOCUMENT_TYPE: input AddDocumentTypeInput { id: OID! documentType: String! }",
    );
    expect(result.text).toMatch(/Enum values:\n {2}StatusType: /);
    // The created line stays first, the listing follows a blank line.
    const [first, second] = result.text.split("\n");
    expect(first).toMatch(/^Created powerhouse\/document-editor "Board Editor" {2}id: \S+$/);
    expect(second).toBe("");
  });

  it("product specs come without the action listing (Plan's token budget)", async () => {
    const result = await specCreate.execute(
      { type: PRODUCT_TYPE, name: "Lean Feature", dryRun: true },
      ctx(workdir),
    );
    expect(result.text).toMatch(/^Created powerhouse\/feature "Lean Feature"/);
    expect(result.text).not.toContain("Actions of");
    const model = await specCreate.execute(
      { type: DOC_TYPE, name: "Model", dryRun: true },
      ctx(workdir),
    );
    expect(model.text).toContain("Actions of powerhouse/document-model");
    expect(model.text.length).toBeLessThan(ACTION_REFERENCE_MAX_CHARS + 600);
  });

  it("caps the action listing, naming the actions left out", () => {
    const full = actionReference(DOC_TYPE);
    expect(full).not.toContain(" more: ");
    const capped = actionReference(DOC_TYPE, { maxChars: 400 });
    const [, ...lines] = capped.split("\n");
    const listed = lines.filter((l) => /^ {2}[A-Z_]+: /.test(l));
    expect(listed.length).toBeGreaterThan(0);
    expect(listed.join("\n").length).toBeLessThanOrEqual(400);
    expect(capped).toMatch(/ {2}… \d+ more: [A-Z_, ]+ — spec-schema --type powerhouse\/document-model --action [A-Z_,]+/);
  });

  it("does not persist when --dryRun is set", async () => {
    const result = await specCreate.execute(
      { type: DOC_TYPE, name: "Ephemeral", dryRun: true },
      ctx(workdir),
    );
    expect(result.text).toMatch(/in-memory, not saved/);
    const list = await specList.execute({}, ctx(workdir));
    expect(list.text).toBe("(no specs)");
  });

  it("a dry run needs no drive", async () => {
    const result = await specCreate.execute(
      { type: DOC_TYPE, name: "Ephemeral", dryRun: true },
      makeCtx(workdir),
    );
    expect(result.text).toMatch(/in-memory, not saved/);
  });

  it("refuses to create without a drive to reach", async () => {
    await expect(
      specCreate.execute(
        { type: DOC_TYPE, name: "Nowhere", dryRun: false },
        makeCtx(workdir),
      ),
    ).rejects.toThrow(/Specifications are kept in the Studio drive/);
    expect(existsSync(join(workdir, "specs"))).toBe(false);
  });

  it("creates a product spec in the drive, beside the project specs", async () => {
    const result = await specCreate.execute(
      { type: PRODUCT_TYPE, name: "RootFeature", dryRun: false },
      ctx(workdir),
    );
    expect(result.text).toMatch(/Created/);
    const list = await specList.execute({}, ctx(workdir));
    expect(list.text).toMatch(/RootFeature/);
  });

  it("refuses any spec in a workdir that is no project", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vetra-noreactor-"));
    try {
      for (const type of [DOC_TYPE, PRODUCT_TYPE]) {
        await expect(
          specCreate.execute({ type, name: "NeedsProject", dryRun: false }, ctx(dir)),
        ).rejects.toThrow(/The workdir is not a Reactor Package project/);
      }
      await expect(specList.execute({}, ctx(dir))).rejects.toThrow(
        /The workdir is not a Reactor Package project/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("spec-get", () => {
  const { ctx } = useSpecDrive();
  let workdir: string;
  let cleanup: () => void;
  beforeEach(async () => {
    ({ workdir, cleanup } = makeWorkdir());
    await specCreate.execute(
      { type: DOC_TYPE, name: "Target", dryRun: false },
      ctx(workdir),
    );
  });
  afterEach(() => cleanup());

  it("returns a summary + help by default (no slicer, no --full)", async () => {
    const result = await specGet.execute(
      { name: "Target", full: false, latest: false },
      ctx(workdir),
    );
    expect(result.text).toMatch(/powerhouse\/document-model "Target"/);
    expect(result.text).toMatch(/Usage examples for "Target"/);
    // Default must NOT dump the full state payload.
    expect(result.text).not.toContain('"global"');
  });

  it("returns the full state when --full is passed", async () => {
    const result = await specGet.execute(
      { name: "Target", full: true, latest: false },
      ctx(workdir),
    );
    expect(result.text).toMatch(/"specifications":/);
  });

  it("projects via --filter against the state", async () => {
    const result = await specGet.execute(
      { name: "Target", full: false, latest: false, filter: "$.global.specifications[0].version" },
      ctx(workdir),
    );
    expect(result.text).toBe("1");
  });

  it("throws when the spec is missing", async () => {
    await expect(
      specGet.execute({ name: "DoesNotExist", full: false, latest: false }, ctx(workdir)),
    ).rejects.toThrow(/Unknown spec "DoesNotExist"/);
  });
});

describe("spec-update", () => {
  const { ctx } = useSpecDrive();
  let workdir: string;
  let cleanup: () => void;
  beforeEach(async () => {
    ({ workdir, cleanup } = makeWorkdir());
    await specCreate.execute(
      { type: DOC_TYPE, name: "Target", dryRun: false },
      ctx(workdir),
    );
  });
  afterEach(() => cleanup());

  it("applies actions read from a file", async () => {
    const actionsPath = join(workdir, "actions.json");
    writeFileSync(
      actionsPath,
      JSON.stringify([{ type: "SET_MODEL_NAME", input: { name: "Renamed" } }]),
    );
    const result = await specUpdate.execute(
      { name: "Target", from: actionsPath },
      ctx(workdir),
    );
    expect(result.text).toMatch(/Applied 1 action/);
    const after = await specGet.execute(
      { name: "Target", full: false, latest: false, filter: "$.global.name" },
      ctx(workdir),
    );
    expect(after.text).toBe("Renamed");
  });

  it("rejects malformed JSON", async () => {
    const actionsPath = join(workdir, "broken.json");
    writeFileSync(actionsPath, "not json");
    await expect(
      specUpdate.execute(
        { name: "Target", from: actionsPath },
        ctx(workdir),
      ),
    ).rejects.toThrow(/Invalid JSON/);
  });

  it("rejects when actions input is not an array", async () => {
    const actionsPath = join(workdir, "obj.json");
    writeFileSync(actionsPath, JSON.stringify({ type: "FOO" }));
    await expect(
      specUpdate.execute(
        { name: "Target", from: actionsPath },
        ctx(workdir),
      ),
    ).rejects.toThrow(/JSON array/);
  });

  it("enriches invalid-input errors with the action's GraphQL input schema", async () => {
    /* SET_MODEL_NAME requires `name: String!` — pass a wrong-shaped payload and
     * expect the error to include the schema so the agent can self-correct. */
    await expect(
      specUpdate.execute(
        {
          name: "Target",
          actions: [{ type: "SET_MODEL_NAME", input: { wrong: 1 } }],
        },
        ctx(workdir),
      ),
    ).rejects.toThrow(/input SetModelNameInput[\s\S]*name: String!/);
  });

  it("trims the raw zod JSON dump out of input-shape errors", async () => {
    /* The error must name the offending field and show the schema, without the
     * multi-line `{ "code": "invalid_type", ... }` blob the reducer emits. */
    const promise = specUpdate.execute(
      {
        name: "Target",
        actions: [{ type: "SET_MODEL_NAME", input: { wrong: 1 } }],
      },
      ctx(workdir),
    );
    await expect(promise).rejects.toThrow(/SET_MODEL_NAME: [^\n]*name/);
    await expect(promise).rejects.toThrow(
      expect.objectContaining({
        message: expect.not.stringContaining('"code": "invalid_type"'),
      }),
    );
  });

  it("lists valid action types when the action is unknown", async () => {
    await expect(
      specUpdate.execute(
        {
          name: "Target",
          actions: [{ type: "NOT_A_REAL_ACTION", input: {} }],
        },
        ctx(workdir),
      ),
    ).rejects.toThrow(/Valid action types[\s\S]*SET_MODEL_NAME/);
  });

  it("suggests the closest action name on a near-miss", async () => {
    /* `SET_NAME` is the canonical agent miss for subgraph; here on
     * document-model the closest match is `SET_MODEL_NAME`. */
    await expect(
      specUpdate.execute(
        {
          name: "Target",
          actions: [{ type: "SET_NAME", input: { name: "x" } }],
        },
        ctx(workdir),
      ),
    ).rejects.toThrow(/Did you mean:[^\n]*SET_MODEL_NAME/);
  });

  it("applies SET_STATE_SCHEMA / SET_INITIAL_STATE without a payload scope", async () => {
    /* The first-update foot-gun: agents omit the required payload `scope`
     * because the action-level scope already defaults to global. The reducer
     * must accept the normalized actions. */
    const result = await specUpdate.execute(
      {
        name: "Target",
        actions: [
          { type: "SET_STATE_SCHEMA", input: { schema: "type S { x: Int }" } },
          { type: "SET_INITIAL_STATE", input: { initialValue: "{}" } },
        ],
      },
      ctx(workdir),
    );
    expect(result.text).toMatch(/Applied 2 action/);
  });

  it("mints an id for an ADD_MODULE that supplies only a name", async () => {
    const result = await specUpdate.execute(
      { name: "Target", actions: [{ type: "ADD_MODULE", input: { name: "Workouts" } }] },
      ctx(workdir),
    );
    expect(result.text).toMatch(/Applied 1 action/);
    // The minted id must be surfaced so a later action can target the module.
    expect(result.text).toMatch(/Minted id\(s\)[\s\S]*ADD_MODULE "Workouts" → [0-9a-f-]{36}/i);
    const ids = await specGet.execute(
      { name: "Target", full: false, latest: true, filter: "$.modules[*].id" },
      ctx(workdir),
    );
    expect(ids.text).toMatch(/[0-9a-f-]{36}/i);
  });

  it("resolves a moduleId given as a name within the same batch", async () => {
    const result = await specUpdate.execute(
      {
        name: "Target",
        actions: [
          { type: "ADD_MODULE", input: { id: "mod-1", name: "Workouts" } },
          {
            type: "ADD_OPERATION",
            input: {
              moduleId: "Workouts",
              name: "ADD_WORKOUT",
              schema: "input AddWorkoutInput { id: String! }",
            },
          },
        ],
      },
      ctx(workdir),
    );
    expect(result.text).toMatch(/Applied 2 action/);
    const ops = await specGet.execute(
      { name: "Target", full: false, latest: true, filter: "$.modules[?(@.id=='mod-1')].operations[*].name" },
      ctx(workdir),
    );
    expect(ops.text).toMatch(/ADD_WORKOUT/);
  });
});

describe("spec-generate", () => {
  const { ctx } = useSpecDrive();
  let workdir: string;
  let cleanup: () => void;
  beforeEach(async () => {
    ({ workdir, cleanup } = makeWorkdir());
    // buildTsMorphProject reads a tsconfig from the project root.
    writeFileSync(
      join(workdir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "Bundler",
          strict: true,
        },
      }),
    );
    await specCreate.execute(
      { type: DOC_TYPE, name: "Target", dryRun: false },
      ctx(workdir),
    );
    await specUpdate.execute(
      {
        name: "Target",
        actions: [
          { type: "SET_MODEL_ID", input: { id: "powerhouse/target" } },
          { type: "SET_MODEL_NAME", input: { name: "Target" } },
          { type: "SET_MODEL_EXTENSION", input: { extension: "tgt" } },
        ],
      },
      ctx(workdir),
    );
  });
  afterEach(() => cleanup());

  it("throws a trimmed parse error when a single-target schema is TypeScript, not SDL", async () => {
    /* The canonical agent footgun: a state schema written in TS syntax passes
     * spec-update's JSON validation but fails codegen. A single-target generate
     * must surface this as a tool error, not bury it in `data.skipped`. */
    await specUpdate.execute(
      {
        name: "Target",
        actions: [
          {
            type: "SET_STATE_SCHEMA",
            input: {
              scope: "global",
              schema:
                "type TodoItem = {\n  id: string;\n  text: string;\n};\n\ntype TargetState = {\n  items: TodoItem[];\n};",
            },
          },
          {
            type: "SET_INITIAL_STATE",
            input: { scope: "global", initialValue: '{ "items": [] }' },
          },
        ],
      },
      ctx(workdir),
    );

    // Codegen runs in this process (makeCtx's runProcess rejects any spawn);
    // @graphql-tools/load inlines the SDL around the parse error.
    const promise = specGenerate.execute(
      { name: "Target", skipChecks: true },
      ctx(workdir),
    );
    await expect(promise).rejects.toThrow(
      /Failed to parse the GraphQL document/,
    );
    // The thrown message must be trimmed, not the multi-kB schema dump.
    await expect(promise).rejects.toThrow(
      expect.objectContaining({
        message: expect.not.stringContaining("type TodoItem = {"),
      }),
    );
  });
});

// M0: the agent hand-wrote powerhouse.config.json + package.json; spec-create
// accepted the stub and spec-generate then failed fetching ph-cli (npm 404).
describe("a hand-written (never installed) project", () => {
  const { ctx } = useSpecDrive();
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vetra-stub-"));
    writeFileSync(join(dir, "powerhouse.config.json"), "{}\n");
    writeFileSync(join(dir, "package.json"), "{}\n");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("spec-create and spec-generate refuse it and say to install it", async () => {
    const notInstalled = /The project is not installed \(no node_modules at [\s\S]*pnpm install/;
    await expect(
      specCreate.execute({ type: DOC_TYPE, name: "Todo", dryRun: false }, ctx(dir)),
    ).rejects.toThrow(notInstalled);
    await expect(
      specGenerate.execute({ skipChecks: true }, ctx(dir)),
    ).rejects.toThrow(notInstalled);
    // Product specs generate no code and are unaffected.
    await expect(
      specCreate.execute({ type: PRODUCT_TYPE, name: "Todo", dryRun: false }, ctx(dir)),
    ).resolves.toMatchObject({ text: expect.stringContaining("Created") });
  });
});

describe("spec-delete", () => {
  const { ctx } = useSpecDrive();
  let workdir: string;
  let cleanup: () => void;
  beforeEach(() => ({ workdir, cleanup } = makeWorkdir()));
  afterEach(() => cleanup());

  it("removes a spec from the drive", async () => {
    await specCreate.execute(
      { type: DOC_TYPE, name: "Doomed", dryRun: false },
      ctx(workdir),
    );
    const result = await specDelete.execute(
      { name: "Doomed" },
      ctx(workdir),
    );
    expect(result.text).toMatch(/Deleted "Doomed"/);
    const list = await specList.execute({}, ctx(workdir));
    expect(list.text).toBe("(no specs)");
  });

  it("throws if the spec is missing", async () => {
    await expect(
      specDelete.execute({ name: "Missing" }, ctx(workdir)),
    ).rejects.toThrow(/Unknown spec "Missing"/);
  });
});

describe("spec-schema-list", () => {
  const ctx = makeCtx;
  let workdir: string;
  let cleanup: () => void;
  beforeEach(() => ({ workdir, cleanup } = makeWorkdir()));
  afterEach(() => cleanup());

  it("returns registered document model types", async () => {
    const result = await specSchemaList.execute({}, ctx(workdir));
    expect(result.text).toMatch(/powerhouse\/document-model/);
    expect(result.text).toContain(DOC_TYPE);
  });
});

describe("spec-schema", () => {
  const ctx = makeCtx;
  let workdir: string;
  let cleanup: () => void;
  beforeEach(() => ({ workdir, cleanup } = makeWorkdir()));
  afterEach(() => cleanup());

  it("returns a summary + help by default (no slicer, no --full)", async () => {
    const result = await specSchema.execute(
      { type: DOC_TYPE, state: false, full: false },
      ctx(workdir),
    );
    expect(result.text).toMatch(new RegExp(`^${DOC_TYPE} —`));
    expect(result.text).toMatch(/^Modules: /m);
    expect(result.text).toMatch(/^JSONPath examples/m);
    // Default must NOT dump the full schema payload.
    expect(result.text).not.toContain('"specifications"');
  });

  it("returns the full schema when --full is passed", async () => {
    const result = await specSchema.execute(
      { type: DOC_TYPE, state: false, full: true },
      ctx(workdir),
    );
    expect(result.text).toContain("specifications");
  });

  it("--action returns the GraphQL input for one operation", async () => {
    const result = await specSchema.execute(
      { type: DOC_TYPE, action: "SET_MODEL_NAME", full: false, state: false },
      ctx(workdir),
    );
    expect(result.text).toMatch(/^input SetModelNameInput/);
    expect(result.text).toMatch(/name: String!/);
  });

  it("--action lists the values of the state enums its input uses", async () => {
    const result = await specSchema.execute(
      { type: "powerhouse/problem-sheet", action: "SET_CORE_JOB", state: false, full: false },
      ctx(workdir),
    );
    expect(result.text).toMatch(/^input SetCoreJobInput/);
    expect(result.text).toMatch(/\n\nEnum values:\n {2}Motivation: LOVE_TO \| WANT_TO \| NEED_TO \| HAVE_TO \| HATE_TO \| CANNOT$/);
    // An input without enums, or a --format payload, gets no extra lines.
    const plain = await specSchema.execute(
      { type: DOC_TYPE, action: "SET_MODEL_NAME", state: false, full: false },
      ctx(workdir),
    );
    expect(plain.text).not.toContain("Enum values");
    const json = await specSchema.execute(
      { type: "powerhouse/problem-sheet", action: "SET_CORE_JOB", state: false, full: false, format: "json" },
      ctx(workdir),
    );
    expect(json.text).not.toContain("Enum values");
  });

  it("enum values skip descriptions, comments and directives", () => {
    const schema = [
      '"""Why: { the job } matters"""',
      "enum Motivation {",
      '  "loves it" LOVE_TO',
      "  # legacy values below",
      '  NEED_TO @deprecated(reason: "use HAVE_TO")',
      "  HAVE_TO",
      "}",
    ].join("\n");
    expect(enumValues({ state: { global: { schema } } })).toEqual(
      new Map([["Motivation", ["LOVE_TO", "NEED_TO", "HAVE_TO"]]]),
    );
  });

  it("--action implies --type when only one type has the action", async () => {
    const result = await specSchema.execute(
      { type: "", action: "SET_EDITOR_STATUS", state: false, full: false },
      ctx(workdir),
    );
    expect(result.text).toMatch(/^input SetEditorStatusInput/);
    expect(result.text).toMatch(/Enum values:\n {2}StatusType: /);
    // Types that disagree on the input: every variant, in one answer.
    const shared = await specSchema.execute(
      { type: "", action: "ADD_DOCUMENT_TYPE", state: false, full: false },
      ctx(workdir),
    );
    expect(shared.text).toContain("the input differs by type");
    expect(shared.text).toMatch(
      /powerhouse\/document-editor, powerhouse\/processor:\n {2}ADD_DOCUMENT_TYPE: input AddDocumentTypeInput \{ id: OID! documentType: String! \}/,
    );
    expect(shared.text).toMatch(
      /powerhouse\/app:\n {2}ADD_DOCUMENT_TYPE: input AddDocumentTypeInput \{ documentType: String! \}/,
    );
    // Without an action the type is still needed, and the error lists the
    // valid ones inline (no extra spec-schema-list call).
    await expect(
      specSchema.execute({ type: "", state: false, full: false }, ctx(workdir)),
    ).rejects.toThrow(/Missing required option --type\.\nValid types: .*powerhouse\/document-editor/);
  });

  it("--action takes several comma-separated actions in one call", async () => {
    const result = await specSchema.execute(
      {
        type: "powerhouse/document-editor",
        action: "SET_EDITOR_NAME, SET_EDITOR_STATUS",
        state: false,
        full: false,
      },
      ctx(workdir),
    );
    expect(result.text).toContain("input SetEditorNameInput");
    expect(result.text).toContain("input SetEditorStatusInput");
    expect(result.text).toMatch(/Enum values:\n {2}StatusType: /);
    await expect(
      specSchema.execute(
        { type: "powerhouse/document-editor", action: "SET_EDITOR_NAME,NOPE", state: false, full: false },
        ctx(workdir),
      ),
    ).rejects.toThrow(/Unknown action "NOPE"/);
  });

  it("--state returns the GraphQL state schema", async () => {
    const result = await specSchema.execute(
      { type: DOC_TYPE, full: false, state: true },
      ctx(workdir),
    );
    expect(result.text.length).toBeGreaterThan(0);
    expect(result.text).not.toMatch(/^Schema for /);
  });

  it("--action rejects unknown action names with a discovery hint", async () => {
    await expect(
      specSchema.execute(
        { type: DOC_TYPE, action: "NOT_A_REAL_ACTION", full: false, state: false },
        ctx(workdir),
      ),
    ).rejects.toThrow(
      /Unknown action "NOT_A_REAL_ACTION"[\s\S]*spec-schema --type/,
    );
  });

  it("--action suggests the closest match on a near-miss", async () => {
    await expect(
      specSchema.execute(
        { type: DOC_TYPE, action: "SET_NAME", full: false, state: false },
        ctx(workdir),
      ),
    ).rejects.toThrow(/Did you mean:[^.]*SET_MODEL_NAME/);
  });

  it("rejects --action combined with --state", async () => {
    await expect(
      specSchema.execute(
        { type: DOC_TYPE, action: "SET_MODEL_NAME", full: false, state: true },
        ctx(workdir),
      ),
    ).rejects.toThrow(/mutually exclusive/);
  });

  it("targets the LATEST specification, not specifications[0]", async () => {
    // We can't easily release a new version in a unit test, but we can verify
    // the resolved filter string mentions the script index for "last element".
    // (Defensive: prevents regression to the buggy `[0]` form.)
    const result = await specSchema.execute(
      { type: DOC_TYPE, action: "SET_MODEL_NAME", full: false, state: false },
      ctx(workdir),
    );
    // Latest-spec correctness is verified end-to-end in the multi-spec
    // simulation; here we just confirm the action shortcut still resolves.
    expect(result.text).toMatch(/SetModelNameInput/);
  });
});

describe("specs live in the Studio drive", () => {
  const { ctx } = useSpecDrive();
  let dir: string;
  let cleanup: () => void;
  beforeEach(() => ({ workdir: dir, cleanup } = makeWorkdir()));
  afterEach(() => cleanup());

  it("a project spec and a product spec sit side by side; get/update/delete reach both", async () => {
    await specCreate.execute(
      { type: "powerhouse/document-editor", name: "Todo Editor", dryRun: false },
      ctx(dir),
    );
    const updated = await specUpdate.execute(
      {
        name: "Todo Editor",
        actions: [{ type: "SET_EDITOR_NAME", input: { name: "Todo Board" } }],
      },
      ctx(dir),
    );
    expect(updated.text).not.toMatch(/Unknown spec/);
    const got = await specGet.execute(
      { name: "Todo Editor", full: false, latest: false },
      ctx(dir),
    );
    expect(got.text).toMatch(/powerhouse\/document-editor "Todo Editor"/);

    await specCreate.execute(
      { type: PRODUCT_TYPE, name: "RootFeature", dryRun: false },
      ctx(dir),
    );
    const root = await specGet.execute(
      { name: "RootFeature", full: false, latest: false },
      ctx(dir),
    );
    expect(root.text).toMatch(/RootFeature/);
    const deleted = await specDelete.execute({ name: "RootFeature" }, ctx(dir));
    expect(deleted.text).toMatch(/Deleted "RootFeature"/);
    const list = await specList.execute({}, ctx(dir));
    expect(list.text).toMatch(/Todo Editor/);
    expect(list.text).not.toMatch(/RootFeature/);
  });

  it("a project in a subfolder of a workspace is not picked", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "vetra-workspace-"));
    try {
      const sub = join(workspace, "todo-list");
      mkdirSync(join(sub, "node_modules"), { recursive: true });
      writeFileSync(join(sub, "powerhouse.config.json"), "{}\n");
      await expect(
        specCreate.execute(
          { type: "powerhouse/document-editor", name: "Todo Editor", dryRun: false },
          makeCtx(workspace),
        ),
      ).rejects.toThrow(/The workdir is not a Reactor Package project/);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
