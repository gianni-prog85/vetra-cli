import { defineCommand } from "../../framework.js";
import { projectRoot } from "../../helpers/project.js";
import {
  findPreviewByName,
  getPreviewAuthToken,
  getPreviewDocument,
  resolvePreviewEndpoint,
} from "../../helpers/reactor-project-preview.js";
import { renderProjected } from "../spec/_helpers.js";
import { specPreviewGetMeta } from "./meta.js";

export const specPreviewGet = defineCommand({
  ...specPreviewGetMeta,
  execute: async (input, context) => {
    const base = await projectRoot(context.workdir);
    const { switchboardUrl, driveId } = resolvePreviewEndpoint(
      context.services,
      base,
    );
    const token = await getPreviewAuthToken(context.workdir, context.config);
    const row = await findPreviewByName(switchboardUrl, driveId, input.name, token);
    const doc = await getPreviewDocument(switchboardUrl, row.id, token);
    if (!doc) {
      throw new Error(
        `Preview document "${row.name}" (${row.id}) vanished between list and fetch.`,
      );
    }
    const opsTotal = doc.revisionsList.reduce((sum, r) => sum + r.revision, 0);
    const summary = `${doc.documentType} "${doc.name}" — ${opsTotal} operation(s).`;

    if (!input.full && !input.filter) {
      return { text: summary };
    }

    const filter = input.filter ?? (input.full ? "$" : "$.global");
    return { text: renderProjected(doc.state, filter, input.format) };
  },
});
