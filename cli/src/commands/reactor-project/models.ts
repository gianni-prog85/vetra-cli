import { defineCommand } from "../../framework.js";
import { previewModelsMeta } from "./meta.js";
import { formatPreviewModels, previewModels } from "../../helpers/preview-inspector.js";
import { projectRoot } from "../../helpers/project.js";

/**
 * `preview-models`: the document model types the Preview run has loaded, as
 * its inspector reported them (at ready and on every reload). Read-only.
 */
export const previewModelsCommand = defineCommand({
  ...previewModelsMeta,
  execute: async ({ full }, context) => {
    const projectPath = await projectRoot(context.workdir);
    const models = previewModels(context.services, projectPath, { full: full ?? false });
    return { text: formatPreviewModels(models), data: models };
  },
});
