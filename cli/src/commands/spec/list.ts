import { z } from "zod";
import { defineCommand } from "../../framework.js";
import { projectRoot } from "../../helpers/project.js";
import { requireSpecDrive } from "../../helpers/embedded-drive.js";
import { formatColumns } from "./_helpers.js";
import { listDriveSpecs, specDriveOf } from "./drive-specs.js";

export const specList = defineCommand({
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
  execute: async (input, context) => {
    await projectRoot(context.workdir);
    const drive = specDriveOf(await requireSpecDrive(context));
    const docs = await listDriveSpecs(drive, {
      documentType: input.type,
      category: input.category,
    });
    if (docs.length === 0) {
      return { text: "(no specs)" };
    }
    const rows = docs.map((d) => [
      d.header.name,
      d.header.slug || "—",
      d.header.documentType,
      d.header.id,
    ]);
    return {
      text: formatColumns(rows),
    };
  },
});
