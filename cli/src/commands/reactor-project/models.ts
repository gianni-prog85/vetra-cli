import { z } from "zod";
import { defineCommand } from "../../framework.js";
import { formatPreviewModels, previewModels } from "../../helpers/preview-inspector.js";
import { projectRoot } from "../../helpers/project.js";

/**
 * `preview-models`: the document model types the Preview run has loaded, as
 * its inspector reported them (at ready and on every reload). Read-only.
 */
export const previewModelsCommand = defineCommand({
  id: "preview-models",
  description:
    "List the document model types (and versions) the Preview run has loaded from the project, as its inspector reports them",
  inputSchema: z.object({
    full: z
      .boolean()
      .optional()
      .describe("Include each version's full document model state in the data. Defaults to false."),
  }),
  execute: async ({ full }, context) => {
    const services = context.services;
    if (!services) throw new Error("No services configured");
    const projectPath = await projectRoot(context.workdir);
    const models = previewModels(services, projectPath, { full: full ?? false });
    return { text: formatPreviewModels(models), data: models };
  },
});
