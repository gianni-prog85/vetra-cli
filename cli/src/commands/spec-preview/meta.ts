/** Ids, descriptions and input schemas of the spec-preview commands (see ../spec/meta.ts). */
import { z } from "zod";
import { actionsInput, formatSchema } from "../spec/meta.js";

export const specPreviewListMeta = {
  id: "spec-preview-list",
  description:
    "List documents in the running reactor-project's preview drive.",
  inputSchema: z.object({
    type: z
      .string()
      .optional()
      .describe(
        'Filter to one document type, e.g. "powerhouse/document-editor". Omit to list every preview document.',
      ),
  }),
};

export const specPreviewGetMeta = {
  id: "spec-preview-get",
  description:
    "Read a document from the reactor-project's preview drive. Pass --filter for projection.",
  inputSchema: z.object({
    name: z
      .string()
      .default("")
      .describe(
        "Preview document to read — accepts display name, slug, or id (see spec-preview-list).",
      ),
    full: z
      .boolean()
      .default(false)
      .describe(
        "Return the full state value (token-heavy). Default returns a summary plus header info.",
      ),
    filter: z
      .string()
      .optional()
      .describe(
        "JSONPath (RFC 9535) projection. Default scope: $.global (state.global). With --full, scope is the whole state.",
      ),
    format: formatSchema.optional(),
  }),
};

export const specPreviewCreateMeta = {
  id: "spec-preview-create",
  description:
    "Create a document in the running reactor-project's preview drive. Any document type registered by the running reactor is accepted — framework spec types and document models from installed packages alike. Use --drive to target a specific drive (e.g. an app preview drive).",
  inputSchema: z.object({
    type: z
      .string()
      .default("")
      .describe(
        'Type of a document model spec in the project, e.g. "brand/todo-list".',
      ),
    name: z
      .string()
      .describe(
        "Human-readable display name. Used as the doc's header.name; the reactor populates the slug.",
      ),
    drive: z
      .string()
      .optional()
      .describe(
        "Target drive id. When omitted, uses the project's default preview drive. Pass a drive id from spec-preview-create-drive to create documents inside an app preview drive.",
      ),
  }),
};

export const specPreviewCreateDriveMeta = {
  id: "spec-preview-create-drive",
  description:
    "Create a preview drive bound to a drive app. The drive's preferredEditor is set to the app's editor config.id so Connect renders the app when the drive is opened. Idempotent: reuses an existing preview drive already bound to this app.",
  inputSchema: z.object({
    app: z
      .string()
      .describe(
        "App spec display name or editor id. Used to resolve the preferredEditor value from powerhouse.manifest.json apps[].",
      ),
    name: z
      .string()
      .optional()
      .describe(
        'Display name for the preview drive. Defaults to "<App> Preview".',
      ),
  }),
};

export const specPreviewUpdateMeta = {
  id: "spec-preview-update",
  description:
    "Apply actions to a preview document through the document model's reducer.",
  inputSchema: z.object({
    name: z
      .string()
      .default("")
      .describe(
        "Preview document to update — accepts display name, slug, or id (see spec-preview-list).",
      ),
    drive: z
      .string()
      .optional()
      .describe(
        "Target drive id. When omitted, uses the project's default preview drive.",
      ),
    ...actionsInput,
  }),
};

export const specPreviewDeleteMeta = {
  id: "spec-preview-delete",
  description: "Remove a document from the reactor-project's preview drive.",
  inputSchema: z.object({
    name: z
      .string()
      .default("")
      .describe(
        "Preview document to delete — accepts display name, slug, or id (see spec-preview-list).",
      ),
  }),
};

export const specPreviewShowMeta = {
  id: "spec-preview-show",
  description:
    "Resolve the preview iframe URL for a document or drive in the reactor-project. Use this to point the user's BUILD-card iframe at a specific document or drive root. For documents, the URL embeds the preview drive id and document slug. For drives (use --drive), it points at the drive root so Connect renders the drive's app. Both include `?embed=1` so Connect renders without its outer chrome.",
  inputSchema: z.object({
    name: z
      .string()
      .default("")
      .describe(
        "Preview document to show — accepts display name, slug, or id (see spec-preview-list). Ignored when --drive is set.",
      ),
    drive: z
      .string()
      .optional()
      .describe(
        "Drive id to show. When set, resolves a drive-root URL (renders the drive's app) instead of a document URL.",
      ),
    app: z
      .string()
      .optional()
      .describe(
        "App spec display name or editor id (only with --drive). Re-binds the drive's preferredEditor before showing — REQUIRED after populating the drive, because adding documents wipes the binding. Resolved from powerhouse.manifest.json apps[].",
      ),
  }),
};
