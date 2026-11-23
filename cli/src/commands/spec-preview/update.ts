import { defineCommand } from "../../framework.js";
import { projectRoot } from "../../helpers/project.js";
import {
  findPreviewByName,
  getPreviewAuthToken,
  getPreviewDocument,
  mutatePreviewDocument,
  resolvePreviewEndpoint,
} from "../../helpers/reactor-project-preview.js";
import {
  DOCUMENT_MODEL_TYPE,
  batchTouchesTypeDefinitions,
} from "../spec/document-model.js";
import {
  formatDuplicateTypeError,
  newDuplicateTypeDefinitions,
} from "../spec/registry.js";
import {
  enrichActionValidationError,
  resolveActionsInput,
} from "../spec/_helpers.js";
import { specPreviewUpdateMeta } from "./meta.js";

export const specPreviewUpdate = defineCommand({
  ...specPreviewUpdateMeta,
  execute: async (input, context) => {
    const base = await projectRoot(context.workdir);
    const { switchboardUrl, driveId: defaultDriveId } = resolvePreviewEndpoint(
      context.services,
      base,
    );
    const driveId = input.drive ?? defaultDriveId;
    const token = await getPreviewAuthToken(context.workdir, context.config);
    const row = await findPreviewByName(switchboardUrl, driveId, input.name, token);
    const actions = await resolveActionsInput({
      actions: input.actions,
      from: input.from,
    });

    // The reactor applies preview mutations through the same reducer as the
    // local path but skips its duplicate-type guard. For document-model edits
    // that touch SDL, capture the pre-mutation state so we can reject a
    // newly-introduced duplicate (Sentry #917) before it reaches the gateway
    // via the preview drive. A batch that touches no schema can't add one.
    const guardDuplicates =
      row.documentType === DOCUMENT_MODEL_TYPE &&
      batchTouchesTypeDefinitions(actions);
    const before = guardDuplicates
      ? (await getPreviewDocument(switchboardUrl, row.id, token))?.state
      : undefined;

    let next: Awaited<ReturnType<typeof mutatePreviewDocument>>;
    try {
      next = await mutatePreviewDocument(switchboardUrl, row.id, actions, token);
    } catch (err) {
      enrichActionValidationError(err, row.documentType);
    }

    if (guardDuplicates) {
      const error = formatDuplicateTypeError(
        newDuplicateTypeDefinitions(before, next.state),
      );
      if (error) throw error;
    }
    const opsCount = next.revisionsList.reduce(
      (sum, r) => sum + r.revision,
      0,
    );
    return {
      text: `Applied ${actions.length} action(s) to ${next.documentType} "${next.name}" (now ${opsCount} op(s) total) in preview drive ${driveId}`,
    };
  },
});
