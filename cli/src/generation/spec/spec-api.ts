/**
 * In-memory mirror of reactor-mcp's document tool surface: same function
 * names and input shapes.
 *
 * See `packages/reactor-mcp/src/tools/reactor.ts` for the canonical schema.
 */
import type {
  Action,
  DocumentModelGlobalState,
  OperationSpecification,
  PHDocument,
} from "@powerhousedao/shared/document-model";
import { camelCase } from "change-case";

import { getSpecEntry, listSpecDocumentTypes } from "./specs.js";

export type DocumentModelInfo = {
  name: string;
  type: string;
  description: string;
  extension: string;
  authorName: string;
  authorWebsite: string;
};

/** Mirrors reactor-mcp `getDocumentModels`. */
export function getDocumentModels(): DocumentModelInfo[] {
  return listSpecDocumentTypes().map((documentType) => {
    const { jsonSpec } = getSpecEntry(documentType);
    return {
      name: jsonSpec.name,
      type: jsonSpec.id,
      description: jsonSpec.description ?? "",
      extension: jsonSpec.extension ?? "",
      authorName: jsonSpec.author?.name ?? "",
      authorWebsite: jsonSpec.author?.website ?? "",
    };
  });
}

/** Mirrors reactor-mcp `getDocumentModelSchema`. Returns the full
 *  `DocumentModelGlobalState` (schema + operations + errors), same payload
 *  shape reactor-mcp serves. */
export function getDocumentModelSchema(
  documentType: string,
): DocumentModelGlobalState {
  return getSpecEntry(documentType).jsonSpec;
}

/** Mirrors reactor-mcp `createDocument`. Returns an in-memory document. */
export function createDocument(
  documentType: string,
  opts: {
    name?: string;
    initialState?: { global?: unknown; local?: unknown };
  } = {},
): PHDocument {
  const entry = getSpecEntry(documentType);
  const doc = entry.createDocument(opts.initialState);
  if (opts.name) doc.header.name = opts.name;
  return doc;
}

export type ActionInput = {
  type: string;
  input?: unknown;
  scope?: string;
};

/** Mirrors reactor-mcp `addActions`. Validates every action up front against
 *  the document model's latest specification, then applies them in order via
 *  the reducer. If any action is invalid, throws an aggregated error and
 *  leaves `doc` untouched. */
export function addActions(
  doc: PHDocument,
  actions: ActionInput[],
): PHDocument {
  const entry = getSpecEntry(doc.header.documentType);
  const built = validateAndBuildActions(entry, actions);
  let current = doc;
  for (let i = 0; i < built.length; i++) {
    const action = built[i];
    current = entry.reducer(current, action);
    /* The base reducer wraps custom reducers in try/catch and records any
     * throw as `operation.error` instead of propagating. For an atomic
     * batch apply that's the wrong shape — surface the error so callers
     * bail out before persisting a half-applied doc. */
    const scope = action.scope ?? "global";
    const ops = current.operations[scope];
    const last = ops?.[ops.length - 1];
    if (last?.error) {
      const failures: ActionValidationError[] = [
        {
          index: i,
          type: actions[i].type ?? "<missing>",
          errors: [`Reducer error: ${last.error}`],
        },
      ];
      throw formatValidationError(failures);
    }
  }
  return current;
}

export type ActionValidationError = {
  /** Position in the input array. */
  index: number;
  /** The action's `type` field (or `<missing>` when not a string). */
  type: string;
  /** Human-readable reasons the action was rejected. */
  errors: string[];
};

/** Validate a list of actions without applying them. Returns one entry per
 *  invalid action with all of its problems aggregated. Used by `addActions`
 *  and exposed for callers that want a dry-run check. */
export function validateActions(
  documentType: string,
  actions: ActionInput[],
): ActionValidationError[] {
  const entry = getSpecEntry(documentType);
  const failures: ActionValidationError[] = [];
  for (let i = 0; i < actions.length; i++) {
    const errors = collectActionErrors(entry, actions[i]);
    if (errors.length > 0) {
      failures.push({ index: i, type: actions[i].type ?? "<missing>", errors });
    }
  }
  return failures;
}

/** Run validateActions across the batch and, on success, materialize the
 *  built Action objects. On any failure throws with every action's errors
 *  aggregated — the caller never sees a partial apply. */
function validateAndBuildActions(
  entry: ReturnType<typeof getSpecEntry>,
  actions: ActionInput[],
): Action[] {
  const built: Action[] = [];
  const failures: ActionValidationError[] = [];
  for (let i = 0; i < actions.length; i++) {
    const item = actions[i];
    const errors = collectActionErrors(entry, item);
    if (errors.length > 0) {
      failures.push({ index: i, type: item.type ?? "<missing>", errors });
      continue;
    }
    built.push(buildAction(entry.actions, item));
  }
  if (failures.length > 0) throw formatValidationError(failures);
  return built;
}

/* Mirrors reactor-mcp's `validateDocumentModelAction`: confirms the operation
 * is declared in the latest spec, looks up the action creator, runs the
 * creator's own input validation, and checks scope. */
function collectActionErrors(
  entry: ReturnType<typeof getSpecEntry>,
  item: ActionInput,
): string[] {
  const errors: string[] = [];
  if (typeof item.type !== "string" || item.type.length === 0) {
    errors.push("Missing `type` field");
    return errors;
  }
  const specs = entry.jsonSpec.specifications;
  if (!specs || specs.length === 0) {
    errors.push("Document model has no specifications");
    return errors;
  }
  const latest = specs[specs.length - 1];
  let operation: OperationSpecification | undefined;
  for (const module of latest.modules ?? []) {
    const found = (module.operations ?? []).find((op) => op.name === item.type);
    if (found) {
      operation = found;
      break;
    }
  }
  if (!operation) {
    errors.push(
      `Operation "${item.type}" is not defined in any module of the document model`,
    );
  }
  const creatorName = camelCase(item.type);
  const creator = entry.actions[creatorName];
  if (!creator) {
    errors.push(`No action creator found.`);
  } else {
    try {
      creator(item.input);
    } catch (err) {
      errors.push(
        `Input validation error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  if (operation?.scope && item.scope && item.scope !== operation.scope) {
    errors.push(
      `Scope "${item.scope}" does not match operation scope "${operation.scope}"`,
    );
  }
  return errors;
}

function formatValidationError(failures: ActionValidationError[]): Error {
  const lines = failures.map(
    (f) => `  [${f.index}] ${f.type}: ${f.errors.join("; ")}`,
  );
  const header =
    failures.length === 1
      ? "1 action failed validation:"
      : `${failures.length} actions failed validation:`;
  const err = new Error([header, ...lines].join("\n")) as Error & {
    failures: ActionValidationError[];
  };
  err.failures = failures;
  return err;
}

function buildAction(
  actionsModule: Record<string, (input?: any) => Action>,
  item: ActionInput,
): Action {
  const creatorName = camelCase(item.type);
  const creator = actionsModule[creatorName];
  if (!creator) {
    throw new Error(
      `No action creator found for "${item.type}" (looked up as "${creatorName}")`,
    );
  }
  const action = creator(item.input);
  // Caller may override the scope (creator picks a default).
  if (item.scope) action.scope = item.scope;
  return action;
}
