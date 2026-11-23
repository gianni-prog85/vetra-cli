import { defineCommand } from "../../framework.js";
import { projectRoot } from "../../helpers/project.js";
import {
  getPreviewAuthToken,
  listPreviewDocuments,
  resolvePreviewEndpoint,
} from "../../helpers/reactor-project-preview.js";
import { formatColumns } from "../spec/_helpers.js";
import { specPreviewListMeta } from "./meta.js";

export const specPreviewList = defineCommand({
  ...specPreviewListMeta,
  execute: async (input, context) => {
    const base = await projectRoot(context.workdir);
    const { switchboardUrl, driveId } = resolvePreviewEndpoint(
      context.services,
      base,
    );
    const token = await getPreviewAuthToken(context.workdir, context.config);
    const items = await listPreviewDocuments(switchboardUrl, driveId, token);
    const filtered = input.type
      ? items.filter((d) => d.documentType === input.type)
      : items;
    if (filtered.length === 0) {
      return { text: "(no preview documents)" };
    }
    const rows = filtered.map((d) => {
      const ops = d.revisionsList.reduce((sum, r) => sum + r.revision, 0);
      return [
        d.name,
        d.slug ?? "—",
        d.id,
        d.documentType,
        String(ops),
      ];
    });
    return {
      text: formatColumns(rows),
    };
  },
});
