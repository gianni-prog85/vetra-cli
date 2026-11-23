import { describe, expect, it } from "vitest";
import type { PHDocument } from "@powerhousedao/shared/document-model";
import { resolveSpecEntry } from "../../src/commands/spec/registry.js";
import { DOCUMENT_MODEL_TYPE } from "../../src/commands/spec/document-model.js";
import {
  canonicalModelState,
  modelStatesEqual,
  planModelSpecSync,
  type ModelSpecAction,
  type ModelSpecPlan,
} from "../../src/helpers/model-spec-diff.js";

interface Op {
  id: string;
  name: string;
  description: string;
  schema: string;
  template: string;
  reducer: string;
  scope: string;
  errors: { id: string; code: string; name: string; description: string; template: string }[];
  examples: { id: string; value: string }[];
}
interface Mod {
  id: string;
  name: string;
  description: string;
  operations: Op[];
}
interface Spec {
  version: number;
  changeLog: unknown[];
  state: Record<
    "global" | "local",
    { schema: string; initialValue: string; examples: { id: string; value: string }[] }
  >;
  modules: Mod[];
}
interface Model {
  id: string;
  name: string;
  extension: string;
  description: string;
  author: { name: string; website: string };
  specifications: Spec[];
}

function op(id: string, name: string, extra: Partial<Op> = {}): Op {
  return {
    id,
    name,
    description: `${name} description`,
    schema: `input ${name}Input { id: ID! }`,
    template: `${name} description`,
    reducer: "",
    scope: "global",
    errors: [],
    examples: [],
    ...extra,
  };
}

function specV1(): Spec {
  return {
    version: 1,
    changeLog: [],
    state: {
      global: {
        schema: "type InvoiceState { total: Int }",
        initialValue: '{"total":0}',
        examples: [{ id: "ex-state", value: '{"total":5}' }],
      },
      local: { schema: "", initialValue: "", examples: [] },
    },
    modules: [
      {
        id: "mod-lines",
        name: "lines",
        description: "Invoice lines",
        operations: [
          op("op-add", "ADD_LINE", {
            errors: [
              {
                id: "err-dup",
                code: "DUPLICATE_LINE",
                name: "DuplicateLine",
                description: "The line exists",
                template: "",
              },
            ],
            examples: [{ id: "ex-add", value: '{"id":"1"}' }],
          }),
          op("op-remove", "REMOVE_LINE"),
        ],
      },
      {
        id: "mod-status",
        name: "status",
        description: "",
        operations: [op("op-send", "SEND")],
      },
    ],
  };
}

function model(specifications: Spec[] = [specV1()]): Model {
  return {
    id: "sektar/invoice",
    name: "Invoice",
    extension: "inv",
    description: "An invoice",
    author: { name: "Sektar", website: "https://sektar.io" },
    specifications,
  };
}

const clone = <T>(value: T): T => structuredClone(value);

/** The state a document holding `current` has after the plan's actions. */
function applied(current: unknown, actions: ModelSpecAction[]): unknown {
  const entry = resolveSpecEntry(DOCUMENT_MODEL_TYPE);
  let doc: PHDocument = entry.createDocument({ global: clone(current), local: {} });
  for (const action of actions) doc = entry.reducer(doc, action);
  return (doc.state as unknown as { global: unknown }).global;
}

function actionsOf(plan: ModelSpecPlan): ModelSpecAction[] {
  if (plan.kind !== "actions") throw new Error(`expected actions, got ${JSON.stringify(plan)}`);
  return plan.actions;
}

const types = (plan: ModelSpecPlan) => actionsOf(plan).map((a) => a.type);

describe("planModelSpecSync", () => {
  it("plans nothing when the document equals the report", () => {
    expect(planModelSpecSync(model(), model())).toEqual({ kind: "none" });
  });

  it("ignores fields a specification does not have", () => {
    const current = { ...model(), extra: "x" };
    expect(planModelSpecSync(current, model())).toEqual({ kind: "none" });
  });

  it("gives only the matching operation for one changed operation schema", () => {
    const target = model();
    target.specifications[0]!.modules[0]!.operations[1]!.schema =
      "input RemoveLineInput { id: ID!, reason: String }";
    const plan = planModelSpecSync(model(), target);
    expect(actionsOf(plan)).toHaveLength(1);
    expect(actionsOf(plan)[0]).toMatchObject({
      type: "SET_OPERATION_SCHEMA",
      scope: "global",
      input: { id: "op-remove", schema: "input RemoveLineInput { id: ID!, reason: String }" },
    });
    expect(modelStatesEqual(applied(model(), actionsOf(plan)), target)).toBe(true);
  });

  it("is idempotent: the plan's result plans nothing", () => {
    const target = model();
    target.specifications[0]!.modules[0]!.operations[0]!.description = "Adds a line";
    target.specifications[0]!.state.global.schema = "type InvoiceState { total: Int, n: Int }";
    const plan = planModelSpecSync(model(), target);
    expect(types(plan).sort()).toEqual(["SET_OPERATION_DESCRIPTION", "SET_STATE_SCHEMA"]);
    const after = applied(model(), actionsOf(plan));
    expect(planModelSpecSync(after, target)).toEqual({ kind: "none" });
  });

  it("removes an operation the report no longer has", () => {
    const target = model();
    target.specifications[0]!.modules[0]!.operations.pop();
    const plan = planModelSpecSync(model(), target);
    expect(actionsOf(plan)).toHaveLength(1);
    expect(actionsOf(plan)[0]).toMatchObject({
      type: "DELETE_OPERATION",
      input: { id: "op-remove" },
    });
  });

  it("adds an operation with its errors and examples", () => {
    const target = model();
    target.specifications[0]!.modules[1]!.operations.push(
      op("op-pay", "PAY", {
        template: "",
        errors: [
          { id: "err-paid", code: "PAID", name: "Paid", description: "", template: "" },
        ],
        examples: [{ id: "ex-pay", value: "{}" }],
      }),
    );
    const plan = planModelSpecSync(model(), target);
    expect(types(plan)).toEqual([
      "ADD_OPERATION",
      "SET_OPERATION_TEMPLATE",
      "ADD_OPERATION_ERROR",
      "ADD_OPERATION_EXAMPLE",
    ]);
    expect(modelStatesEqual(applied(model(), actionsOf(plan)), target)).toBe(true);
  });

  it("moves an operation, edits modules and restores the orders", () => {
    const target = model();
    const [lines, status] = target.specifications[0]!.modules as [Mod, Mod];
    status.operations.unshift(lines.operations.shift()!);
    target.specifications[0]!.modules = [
      status,
      lines,
      { id: "mod-new", name: "extra", description: "", operations: [] },
    ];
    lines.name = "invoice_lines";
    const plan = planModelSpecSync(model(), target);
    expect(types(plan)).toEqual([
      "SET_MODULE_NAME",
      "ADD_MODULE",
      "MOVE_OPERATION",
      "REORDER_MODULES",
      "REORDER_MODULE_OPERATIONS",
    ]);
    expect(modelStatesEqual(applied(model(), actionsOf(plan)), target)).toBe(true);
  });

  it("edits errors, examples and the header in place", () => {
    const target = model();
    target.name = "Sales invoice";
    target.author.name = "Sektar BV";
    const add = target.specifications[0]!.modules[0]!.operations[0]!;
    add.errors[0]!.description = "The line is already there";
    add.examples = [];
    target.specifications[0]!.state.global.examples[0]!.value = '{"total":9}';
    const plan = planModelSpecSync(model(), target);
    expect(types(plan)).toEqual([
      "SET_MODEL_NAME",
      "SET_AUTHOR_NAME",
      "UPDATE_STATE_EXAMPLE",
      "DELETE_OPERATION_EXAMPLE",
      "SET_OPERATION_ERROR_DESCRIPTION",
    ]);
    expect(modelStatesEqual(applied(model(), actionsOf(plan)), target)).toBe(true);
  });

  it("releases a new version and writes only what differs in it", () => {
    const v2 = specV1();
    v2.version = 2;
    v2.modules[1]!.operations[0]!.schema = "input SendInput { id: ID!, to: String }";
    const target = model([specV1(), v2]);
    const plan = planModelSpecSync(model(), target);
    expect(types(plan)).toEqual(["RELEASE_NEW_VERSION", "SET_OPERATION_SCHEMA"]);
    const after = applied(model(), actionsOf(plan));
    expect(canonicalModelState(after).specifications.map((s) => s.version)).toEqual([1, 2]);
    expect(modelStatesEqual(after, target)).toBe(true);
  });

  it("writes a change in the latest of two versions without touching the first", () => {
    const v2 = specV1();
    v2.version = 2;
    const current = model([specV1(), clone(v2)]);
    v2.modules[0]!.operations[0]!.reducer = "state.total += 1;";
    const target = model([specV1(), v2]);
    const plan = planModelSpecSync(current, target);
    expect(types(plan)).toEqual(["SET_OPERATION_REDUCER"]);
    expect(modelStatesEqual(applied(current, actionsOf(plan)), target)).toBe(true);
  });

  it("asks for a new document when an earlier version changed", () => {
    const v2 = specV1();
    v2.version = 2;
    const current = model([specV1(), clone(v2)]);
    const target = model([specV1(), v2]);
    target.specifications[0]!.state.global.schema = "type InvoiceState { total: Float }";
    expect(planModelSpecSync(current, target).kind).toBe("recreate");
  });

  it("asks for a new document when the report has fewer versions", () => {
    const v2 = specV1();
    v2.version = 2;
    expect(planModelSpecSync(model([specV1(), v2]), model()).kind).toBe("recreate");
  });

  it("asks for a new document when no operation can write the change", () => {
    const target = model();
    target.specifications[0]!.changeLog = [{ id: "c1", content: "first" }];
    expect(planModelSpecSync(model(), target).kind).toBe("recreate");
  });

  it("asks for a new document when the reducer refuses an action", () => {
    const target = model();
    target.specifications[0]!.modules[0]!.operations[1]!.name = "ADD_LINE";
    const plan = planModelSpecSync(model(), target);
    expect(plan.kind).toBe("recreate");
  });
});
