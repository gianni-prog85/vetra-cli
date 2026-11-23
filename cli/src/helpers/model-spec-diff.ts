/**
 * The operations that bring a `powerhouse/document-model` document to a
 * reported model specification (the Preview inspector's `documentModel`).
 *
 * The plan is a diff, not a rewrite: equal states give no action, a change in
 * one place gives the actions for that place. The model's reducers write the
 * latest specification only, so the plan covers the document's latest version
 * and the versions the report has beyond it (`RELEASE_NEW_VERSION`, then a
 * diff of the copy). The plan is applied to a copy of the document with the
 * model's own reducer before it is returned; a plan that does not arrive at
 * the reported state is dropped for `recreate`, which also covers what no
 * operation can write: an earlier version, a version number, a change log.
 */
import type { PHDocument } from "@powerhousedao/shared/document-model";
import { resolveSpecEntry } from "../commands/spec/registry.js";
import { DOCUMENT_MODEL_TYPE } from "../commands/spec/document-model.js";

type Scope = "global" | "local";
const SCOPES: readonly Scope[] = ["global", "local"];

export interface ModelSpecAction {
  type: string;
  input: unknown;
  scope: string;
  [key: string]: unknown;
}

export type ModelSpecPlan =
  /** The document equals the report. */
  | { kind: "none" }
  /** The actions that make it equal, in order. */
  | { kind: "actions"; actions: ModelSpecAction[] }
  /** No operations reach the report: the document is built again from it. */
  | { kind: "recreate"; reason: string };

interface Example {
  id: string;
  value: string | null;
}
interface ScopeState {
  schema: string | null;
  initialValue: string | null;
  examples: Example[];
}
interface OperationError {
  id: string;
  code: string | null;
  name: string | null;
  description: string | null;
  template: string | null;
}
interface Operation {
  id: string;
  name: string | null;
  description: string | null;
  schema: string | null;
  template: string | null;
  reducer: string | null;
  scope: string | null;
  errors: OperationError[];
  examples: Example[];
}
interface Module {
  id: string;
  name: string | null;
  description: string | null;
  operations: Operation[];
}
interface Specification {
  version: number | null;
  changeLog: unknown[];
  state: Record<Scope, ScopeState>;
  modules: Module[];
}
/** A model's global state, narrowed to the fields a specification has. */
export interface CanonicalModelState {
  id: string | null;
  name: string | null;
  extension: string | null;
  description: string | null;
  author: { name: string | null; website: string | null };
  specifications: Specification[];
}

type Raw = Record<string, unknown> | null | undefined;

const text = (v: unknown): string | null => (typeof v === "string" ? v : null);
const ident = (v: unknown): string => (typeof v === "string" ? v : "");
const list = (v: unknown): Raw[] => (Array.isArray(v) ? (v as Raw[]) : []);

function example(raw: Raw): Example {
  return { id: ident(raw?.id), value: text(raw?.value) };
}

function scopeState(raw: Raw): ScopeState {
  return {
    schema: text(raw?.schema),
    initialValue: text(raw?.initialValue),
    examples: list(raw?.examples).map(example),
  };
}

function operation(raw: Raw): Operation {
  return {
    id: ident(raw?.id),
    name: text(raw?.name),
    description: text(raw?.description),
    schema: text(raw?.schema),
    template: text(raw?.template),
    reducer: text(raw?.reducer),
    scope: text(raw?.scope),
    errors: list(raw?.errors).map((e) => ({
      id: ident(e?.id),
      code: text(e?.code),
      name: text(e?.name),
      description: text(e?.description),
      template: text(e?.template),
    })),
    examples: list(raw?.examples).map(example),
  };
}

function specification(raw: Raw): Specification {
  const state = raw?.state as Raw;
  return {
    version: typeof raw?.version === "number" ? raw.version : null,
    changeLog: Array.isArray(raw?.changeLog) ? raw.changeLog : [],
    state: {
      global: scopeState(state?.global as Raw),
      local: scopeState(state?.local as Raw),
    },
    modules: list(raw?.modules).map((m) => ({
      id: ident(m?.id),
      name: text(m?.name),
      description: text(m?.description),
      operations: list(m?.operations).map(operation),
    })),
  };
}

/** The specification fields of a model's global state, in a fixed shape. */
export function canonicalModelState(state: unknown): CanonicalModelState {
  const raw = state as Raw;
  const author = raw?.author as Raw;
  return {
    id: text(raw?.id),
    name: text(raw?.name),
    extension: text(raw?.extension),
    description: text(raw?.description),
    author: { name: text(author?.name), website: text(author?.website) },
    specifications: list(raw?.specifications).map(specification),
  };
}

const same = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

const sameOrder = (a: { id: string }[], b: { id: string }[]): boolean =>
  a.length === b.length && a.every((item, i) => item.id === b[i]!.id);

/** Whether a document's global state equals a reported one. */
export function modelStatesEqual(a: unknown, b: unknown): boolean {
  return same(canonicalModelState(a), canonicalModelState(b));
}

type Creator = (input?: unknown) => Record<string, unknown>;

function creators(): Record<string, Creator> {
  return resolveSpecEntry(DOCUMENT_MODEL_TYPE).actions;
}

function make(type: string, input?: unknown): ModelSpecAction {
  const creator = creators()[type];
  if (!creator) throw new Error(`no action creator "${type}"`);
  return creator(input) as ModelSpecAction;
}

function headerActions(
  cur: CanonicalModelState,
  tgt: CanonicalModelState,
): ModelSpecAction[] {
  const out: ModelSpecAction[] = [];
  if (cur.id !== tgt.id) out.push(make("setModelId", { id: tgt.id }));
  if (cur.name !== tgt.name) out.push(make("setModelName", { name: tgt.name }));
  if (cur.extension !== tgt.extension) {
    out.push(make("setModelExtension", { extension: tgt.extension }));
  }
  if (cur.description !== tgt.description) {
    out.push(make("setModelDescription", { description: tgt.description }));
  }
  if (cur.author.name !== tgt.author.name) {
    out.push(make("setAuthorName", { authorName: tgt.author.name }));
  }
  if (cur.author.website !== tgt.author.website) {
    out.push(make("setAuthorWebsite", { authorWebsite: tgt.author.website }));
  }
  return out;
}

function stateActions(cur: Specification, tgt: Specification): ModelSpecAction[] {
  const out: ModelSpecAction[] = [];
  for (const scope of SCOPES) {
    const c = cur.state[scope];
    const t = tgt.state[scope];
    if (c.schema !== t.schema) {
      out.push(make("setStateSchema", { scope, schema: t.schema }));
    }
    if (c.initialValue !== t.initialValue) {
      out.push(make("setInitialState", { scope, initialValue: t.initialValue }));
    }
    const wanted = new Map(t.examples.map((e) => [e.id, e]));
    const held = new Map(c.examples.map((e) => [e.id, e]));
    for (const id of held.keys()) {
      if (!wanted.has(id)) out.push(make("deleteStateExample", { scope, id }));
    }
    for (const e of t.examples) {
      const have = held.get(e.id);
      if (!have) {
        out.push(make("addStateExample", { scope, id: e.id, example: e.value }));
      } else if (have.value !== e.value) {
        out.push(
          make("updateStateExample", { scope, id: e.id, newExample: e.value }),
        );
      }
    }
  }
  return out;
}

function errorFieldActions(
  cur: OperationError | undefined,
  tgt: OperationError,
): ModelSpecAction[] {
  const out: ModelSpecAction[] = [];
  const id = tgt.id;
  if (cur?.code !== tgt.code) {
    out.push(make("setOperationErrorCode", { id, errorCode: tgt.code }));
  }
  if (cur?.name !== tgt.name) {
    out.push(make("setOperationErrorName", { id, errorName: tgt.name }));
  }
  if (cur?.description !== tgt.description) {
    out.push(
      make("setOperationErrorDescription", { id, errorDescription: tgt.description }),
    );
  }
  if (cur?.template !== tgt.template) {
    out.push(make("setOperationErrorTemplate", { id, errorTemplate: tgt.template }));
  }
  return out;
}

/** The errors and examples of one operation, after the removals. */
function operationPartActions(
  cur: Operation | undefined,
  tgt: Operation,
): ModelSpecAction[] {
  const out: ModelSpecAction[] = [];
  const errors = new Map((cur?.errors ?? []).map((e) => [e.id, e]));
  for (const e of tgt.errors) {
    const have = errors.get(e.id);
    if (have) {
      out.push(...errorFieldActions(have, e));
    } else {
      out.push(
        make("addOperationError", {
          operationId: tgt.id,
          id: e.id,
          errorCode: e.code,
          errorName: e.name,
          errorDescription: e.description,
          errorTemplate: e.template,
        }),
      );
    }
  }
  const examples = new Map((cur?.examples ?? []).map((e) => [e.id, e]));
  for (const e of tgt.examples) {
    const have = examples.get(e.id);
    if (!have) {
      out.push(
        make("addOperationExample", { operationId: tgt.id, id: e.id, example: e.value }),
      );
    } else if (have.value !== e.value) {
      out.push(make("updateOperationExample", { id: e.id, example: e.value }));
    }
  }
  return out;
}

function operationFieldActions(cur: Operation, tgt: Operation): ModelSpecAction[] {
  const out: ModelSpecAction[] = [];
  const id = tgt.id;
  if (cur.name !== tgt.name) out.push(make("setOperationName", { id, name: tgt.name }));
  if (cur.scope !== tgt.scope) {
    out.push(make("setOperationScope", { id, scope: tgt.scope }));
  }
  if (cur.schema !== tgt.schema) {
    out.push(make("setOperationSchema", { id, schema: tgt.schema }));
  }
  if (cur.description !== tgt.description) {
    out.push(make("setOperationDescription", { id, description: tgt.description }));
  }
  if (cur.template !== tgt.template) {
    out.push(make("setOperationTemplate", { id, template: tgt.template }));
  }
  if (cur.reducer !== tgt.reducer) {
    out.push(make("setOperationReducer", { id, reducer: tgt.reducer }));
  }
  return out;
}

/**
 * Everything but the orders. Removals come first, so an id or an operation
 * name that moves is free before it is added again.
 */
function moduleActions(cur: Specification, tgt: Specification): ModelSpecAction[] {
  const out: ModelSpecAction[] = [];
  const held = new Map<string, { op: Operation; moduleId: string }>();
  for (const m of cur.modules) {
    for (const op of m.operations) held.set(op.id, { op, moduleId: m.id });
  }
  const wanted = new Map<string, Operation>();
  for (const m of tgt.modules) for (const op of m.operations) wanted.set(op.id, op);

  for (const [id, { op }] of held) {
    const target = wanted.get(id);
    if (!target) {
      out.push(make("deleteOperation", { id }));
      continue;
    }
    const errors = new Set(target.errors.map((e) => e.id));
    for (const e of op.errors) {
      if (!errors.has(e.id)) out.push(make("deleteOperationError", { id: e.id }));
    }
    const examples = new Set(target.examples.map((e) => e.id));
    for (const e of op.examples) {
      if (!examples.has(e.id)) out.push(make("deleteOperationExample", { id: e.id }));
    }
  }

  const modules = new Map(cur.modules.map((m) => [m.id, m]));
  for (const m of tgt.modules) {
    const have = modules.get(m.id);
    if (!have) {
      out.push(make("addModule", { id: m.id, name: m.name, description: m.description }));
      continue;
    }
    if (have.name !== m.name) out.push(make("setModuleName", { id: m.id, name: m.name }));
    if (have.description !== m.description) {
      out.push(make("setModuleDescription", { id: m.id, description: m.description }));
    }
  }

  for (const m of tgt.modules) {
    for (const op of m.operations) {
      const have = held.get(op.id);
      if (!have) {
        out.push(
          make("addOperation", {
            id: op.id,
            moduleId: m.id,
            name: op.name,
            description: op.description,
            schema: op.schema,
            template: op.template,
            reducer: op.reducer,
            scope: op.scope,
          }),
        );
        // The reducer fills an empty template from the description.
        const filled = op.template || op.description || "";
        if (filled !== (op.template ?? "")) {
          out.push(make("setOperationTemplate", { id: op.id, template: op.template }));
        }
        out.push(...operationPartActions(undefined, op));
        continue;
      }
      if (have.moduleId !== m.id) {
        out.push(make("moveOperation", { operationId: op.id, newModuleId: m.id }));
      }
      out.push(...operationFieldActions(have.op, op));
      out.push(...operationPartActions(have.op, op));
    }
  }

  const kept = new Set(tgt.modules.map((m) => m.id));
  for (const m of cur.modules) {
    if (!kept.has(m.id)) out.push(make("deleteModule", { id: m.id }));
  }
  return out;
}

/** The orders, read once the content is in place. */
function orderActions(cur: Specification, tgt: Specification): ModelSpecAction[] {
  const out: ModelSpecAction[] = [];
  const ids = (items: { id: string }[]) => items.map((i) => i.id);
  for (const scope of SCOPES) {
    if (!sameOrder(cur.state[scope].examples, tgt.state[scope].examples)) {
      out.push(
        make("reorderStateExamples", { scope, order: ids(tgt.state[scope].examples) }),
      );
    }
  }
  if (!sameOrder(cur.modules, tgt.modules)) {
    out.push(make("reorderModules", { order: ids(tgt.modules) }));
  }
  const modules = new Map(cur.modules.map((m) => [m.id, m]));
  for (const m of tgt.modules) {
    const have = modules.get(m.id);
    if (!have) continue;
    if (!sameOrder(have.operations, m.operations)) {
      out.push(
        make("reorderModuleOperations", { moduleId: m.id, order: ids(m.operations) }),
      );
    }
    const operations = new Map(have.operations.map((op) => [op.id, op]));
    for (const op of m.operations) {
      const held = operations.get(op.id);
      if (!held) continue;
      if (!sameOrder(held.errors, op.errors)) {
        out.push(
          make("reorderOperationErrors", { operationId: op.id, order: ids(op.errors) }),
        );
      }
      if (!sameOrder(held.examples, op.examples)) {
        out.push(
          make("reorderOperationExamples", {
            operationId: op.id,
            order: ids(op.examples),
          }),
        );
      }
    }
  }
  return out;
}

/** A document of the model holding `global`, to run a plan on. */
function scratchDocument(global: unknown): PHDocument {
  return resolveSpecEntry(DOCUMENT_MODEL_TYPE).createDocument({
    global: structuredClone(global),
    local: {},
  });
}

function reduce(doc: PHDocument, action: ModelSpecAction): PHDocument {
  const next = resolveSpecEntry(DOCUMENT_MODEL_TYPE).reducer(doc, action);
  const ops = (next.operations as Record<string, { error?: string }[]>)[action.scope];
  const error = ops?.[ops.length - 1]?.error;
  if (error) throw new Error(`${action.type}: ${error}`);
  return next;
}

const globalOf = (doc: PHDocument): unknown =>
  (doc.state as { global?: unknown }).global;

/**
 * The plan that brings a document holding `current` (its `state.global`) to
 * `target` (a reported `documentModel`).
 */
export function planModelSpecSync(current: unknown, target: unknown): ModelSpecPlan {
  const cur = canonicalModelState(current);
  const tgt = canonicalModelState(target);
  if (same(cur, tgt)) return { kind: "none" };

  const held = cur.specifications.length;
  const reported = tgt.specifications.length;
  if (reported === 0) return { kind: "recreate", reason: "the report has no specification" };
  if (held === 0) return { kind: "recreate", reason: "the document has no specification" };
  if (held > reported) {
    return { kind: "recreate", reason: "the report has fewer versions than the document" };
  }
  for (let i = 0; i < held - 1; i++) {
    if (!same(cur.specifications[i], tgt.specifications[i])) {
      return { kind: "recreate", reason: `version ${tgt.specifications[i]!.version} changed, and it is not the latest` };
    }
  }
  if (cur.specifications[held - 1]!.version !== tgt.specifications[held - 1]!.version) {
    return { kind: "recreate", reason: "the version numbers differ" };
  }

  try {
    let doc = scratchDocument(current);
    const actions: ModelSpecAction[] = [];
    const apply = (batch: ModelSpecAction[]) => {
      for (const action of batch) {
        doc = reduce(doc, action);
        actions.push(action);
      }
    };
    const latest = () => canonicalModelState(globalOf(doc)).specifications.at(-1)!;

    apply(headerActions(cur, tgt));
    for (let i = held - 1; i < reported; i++) {
      const wanted = tgt.specifications[i]!;
      if (i >= held) apply([make("releaseNewVersion")]);
      apply(stateActions(latest(), wanted));
      apply(moduleActions(latest(), wanted));
      apply(orderActions(latest(), wanted));
    }
    if (!same(canonicalModelState(globalOf(doc)), tgt)) {
      return { kind: "recreate", reason: "no operations reach the reported state" };
    }
    if (actions.length === 0) {
      return { kind: "recreate", reason: "no operations reach the reported state" };
    }
    return { kind: "actions", actions };
  } catch (err) {
    return {
      kind: "recreate",
      reason: `an operation was refused (${err instanceof Error ? err.message : String(err)})`,
    };
  }
}
