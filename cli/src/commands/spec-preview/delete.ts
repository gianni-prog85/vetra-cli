import { defineCommand } from "../../framework.js";
import { projectRoot } from "../../helpers/project.js";
import {
  deletePreviewDocument,
  findPreviewByName,
  getPreviewAuthToken,
  resolvePreviewEndpoint,
} from "../../helpers/reactor-project-preview.js";
import { specPreviewDeleteMeta } from "./meta.js";

export const specPreviewDelete = defineCommand({
  ...specPreviewDeleteMeta,
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
