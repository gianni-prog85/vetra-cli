import { defineCommand } from "../../framework.js";
import { requireOption } from "../../helpers/cli-errors.js";
import { projectRoot } from "../../helpers/project.js";
import {
  createEmptyPreviewDocument,
  getPreviewAuthToken,
  resolvePreviewEndpoint,
} from "../../helpers/reactor-project-preview.js";
import { specPreviewCreateMeta } from "./meta.js";

export const specPreviewCreate = defineCommand({
  ...specPreviewCreateMeta,
  execute: async (input, context) => {
    const base = await projectRoot(context.workdir);
    requireOption(
      input.type,
      "type",
      "Pass any document type the running reactor knows about.",
    );
    const { switchboardUrl, driveId: defaultDriveId } = resolvePreviewEndpoint(
      context.services,
      base,
    );
    const driveId = input.drive ?? defaultDriveId;
    const token = await getPreviewAuthToken(context.workdir, context.config);
    const created = await createEmptyPreviewDocument(
      switchboardUrl,
      driveId,
      input.type,
      input.name,
      token,
    );
    return {
      text: `Created ${created.documentType} "${created.name}"  id: ${created.id}  (drive ${driveId})`,
    };
  },
});
