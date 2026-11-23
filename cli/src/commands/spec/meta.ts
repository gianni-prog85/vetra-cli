/**
 * What `--help` and the agent's tool list read of the spec commands: ids,
 * descriptions, input schemas. Imports zod only; each command's module
 * (./list.ts, ...) adds `execute` and loads on first use (./index.ts).
 */
import { z } from "zod";

export const formatSchema = z
  .enum(["json", "toon"])
  .describe(
    'Output encoding. "json" (default) is universal; "toon" (Token-Oriented Object Notation) is ~40% smaller — prefer it when the projected result is still large.',
  );

export const actionInputSchema = z.object({
  type: z
    .string()
    .describe(
      "LITERAL action name from `spec-schema --type <doc-type>` for the spec being updated. Do not invent, shorten, or extrapolate by pattern — names are per doc-type and usually include the doc-type prefix (e.g. `SET_SUBGRAPH_NAME`, not `SET_NAME`; `RELEASE_NEW_VERSION`, not `ADD_SPECIFICATION`).",
    ),
  input: z
    .unknown()
    .optional()
    .describe(
      "Action payload. Shape comes from the action's input schema in `spec-schema`.",
    ),
  scope: z
    .string()
    .optional()
    .describe('Action scope. Defaults to "global"; rarely needs overriding.'),
});

/** `--actions`: a real array from tool/MCP callers, a JSON-encoded string from the shell. */
const actionsSchema = z
  .preprocess((v) => {
    if (typeof v !== "string") return v;
    try {
      return JSON.parse(v) as unknown;
    } catch {
      return v;
    }
  }, z.array(actionInputSchema))
  .optional()
  .describe(
    "Inline JSON array of actions. Preferred for agent tool calls — no filesystem detour needed.",
  );

const actionsFromSchema = z
  .string()
  .optional()
  .describe(
    "Path to a JSON file containing the actions array. Use for human CLI workflows.",
  );

/**
 * The commands that read or write the Studio drive run in the Studio that
 * runs for the project, with its reactor (`needs` in clint's `Command`).
 */
const inStudio = { needs: "reactor" } as const;

export const specListMeta = {
  ...inStudio,
  id: "spec-list",
  description:
    "List the project's spec documents (product and project specs, in the Studio drive). Filter with --category or --type.",
  inputSchema: z.object({
    category: z
      .enum(["product", "project"])
      .optional()
      .describe(
        'Limit to one spec family: "product" (ideation sheets, feature, work-breakdown-structure) or "project" (builder set: document-model, editor, app, processor, subgraph). Omit to list both.',
      ),
    type: z
      .string()
      .optional()
      .describe(
        'Filter to one document type, e.g. "powerhouse/document-editor". Takes precedence over --category. Omit to list all specs.',
      ),
  }),
};

export const specGetMeta = {
  ...inStudio,
  id: "spec-get",
  description:
    "Read a spec. Pass --filter (or --latest) for data; otherwise returns summary + help.",
  inputSchema: z.object({
    name: z
      .string()
      .default("")
      .describe(
        "Spec to read — accepts display name, slug, or id (see spec-list).",
      ),
    full: z
      .boolean()
      .default(false)
      .describe(
        "Return the full state value (token-heavy). Default returns a summary + help.",
      ),
    latest: z
      .boolean()
      .default(false)
      .describe(
        "For doc-model specs: scope the value (and --filter) to `state.global.specifications.at(-1)` instead of `state.global`. With --latest, the modules/state shortcuts become `$.modules[*]`, `$.state.global`, etc.",
      ),
    filter: z
      .string()
      .optional()
      .describe(
        "JSONPath (RFC 9535) projection. Without --latest, applied to the doc's state (default scope: $.global). With --latest, applied to the latest specification.",
      ),
    format: formatSchema.optional(),
  }),
};

export const specCreateMeta = {
  ...inStudio,
  id: "spec-create",
  description:
    "Create a new spec document in the Studio drive (product and project specs alike).",
  inputSchema: z.object({
    type: z
      .string()
      .default("")
      .describe('Document model type, e.g. "powerhouse/document-editor".'),
    name: z
      .string()
      .describe(
        "Human-readable display name. Used as the doc's header.name and (kebab-cased) as its slug.",
      ),
    dryRun: z
      .boolean()
      .default(false)
      .describe(
        "If set, create the doc in-memory only — don't add it to the drive.",
      ),
  }),
};

export const specUpdateMeta = {
  ...inStudio,
  id: "spec-update",
  description: "Apply actions to a spec via the document model's reducer.",
  // Piped actions are read when neither option gives them.
  stdin: (input: Record<string, unknown>) =>
    input.actions === undefined && !input.from,
  inputSchema: z.object({
    name: z
      .string()
      .default("")
      .describe(
        "Spec to update — accepts display name, slug, or id (see spec-list).",
      ),
    actions: actionsSchema,
    from: actionsFromSchema,
  }),
};

export const specDeleteMeta = {
  ...inStudio,
  id: "spec-delete",
  description: "Delete a spec document by name.",
  inputSchema: z.object({
    name: z
      .string()
      .default("")
      .describe(
        "Spec to delete — accepts display name, slug, or id (see spec-list).",
      ),
  }),
};

export const specExtractMeta = {
  ...inStudio,
  id: "spec-extract",
  description:
    "Extract specs by reverse-engineering existing package source into the Studio drive.",
  inputSchema: z.object({
    type: z
      .enum(["all", "document-model", "editor", "app", "processor", "subgraph"])
      .default("all")
      .describe(
        'Which modules to extract. "all" (default) covers every type; or pick one.',
      ),
  }),
};

export const specGenerateMeta = {
  ...inStudio,
  id: "spec-generate",
  description:
    "Generate source code from one or all specs in the project (document models, editors, apps, processors, subgraphs).",
  inputSchema: z.object({
    name: z
      .string()
      .optional()
      .describe(
        "Spec to generate — accepts display name, slug, or id (see spec-list). When omitted, generate code for every spec in the Studio drive.",
      ),
    skipChecks: z
      .boolean()
      .optional()
      .describe(
        "Skip the post-generation typecheck and lint over generated files. Defaults to false.",
      ),
  }),
};

export const specSchemaListMeta = {
  id: "spec-schema-list",
  description: "List known document model types.",
  inputSchema: z.object({}),
};

export const specSchemaMeta = {
  id: "spec-schema",
  description:
    "Read a doc-model schema. Pass --action, --state, or --filter for data; otherwise returns summary + help.",
  inputSchema: z.object({
    type: z
      .string()
      .default("")
      .describe('Document model type, e.g. "powerhouse/document-editor".'),
    full: z
      .boolean()
      .default(false)
      .describe(
        "Return the full schema (token-heavy). Default returns a summary + help.",
      ),
    filter: z
      .string()
      .optional()
      .describe(
        "JSONPath (RFC 9535) projection. Mutually exclusive with --action / --state.",
      ),
    action: z
      .string()
      .optional()
      .describe(
        'Shortcut: return only the GraphQL input type for the named operation (e.g. "SET_MODEL_NAME"), followed by the values of every enum it uses. Several comma-separated names ("ADD_MODULE,ADD_OPERATION") return them all in one call. Implies --type when only one type has the action(s). Mutually exclusive with --filter / --state.',
      ),
    state: z
      .boolean()
      .default(false)
      .describe(
        "Shortcut: return only the GraphQL schema for the doc's global state. Mutually exclusive with --filter / --action.",
      ),
    format: formatSchema.optional(),
  }),
};

/** `actions` and `from` of the update commands (spec-update, spec-preview-update). */
export const actionsInput = { actions: actionsSchema, from: actionsFromSchema };
