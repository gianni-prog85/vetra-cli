import { z } from "zod";
import { defineCommand } from "../../framework.js";
import { projectRoot } from "../../helpers/project.js";
import {
  deletePreviewDocument,
  findPreviewByName,
  getPreviewAuthToken,
  resolvePreviewEndpoint,
} from "../../helpers/reactor-project-preview.js";

export const specPreviewDelete = defineCommand({
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
  execute: async (input, context) => {
    const base = await projectRoot(context.workdir);
    const { switchboardUrl, driveId } = resolvePreviewEndpoint(
      context.services,
      base,
    );
    const token = await getPreviewAuthToken(context.workdir, context.config);
    const row = await findPreviewByName(switchboardUrl, driveId, input.name, token);
    const success = await deletePreviewDocument(switchboardUrl, row.id, token);
    return {
      text: success
        ? `Deleted "${row.name}" (${row.id}) from preview drive ${driveId}`
        : `Failed to delete "${row.name}" (${row.id}) from preview drive ${driveId}`,
    };
  },
});
