import { defineCommand } from "../../framework.js";
import { projectRoot } from "../../helpers/project.js";
import {
  enrichActionValidationError,
  normalizeSpecActions,
  resolveActionsInput,
} from "./_helpers.js";
import { serialized } from "../../helpers/spec-drive-sync.js";
import { contentOperationCount, findSpec } from "./drive-specs.js";
import { specUpdateMeta } from "./meta.js";
import { applySpecActions, createSpecDocument } from "./registry.js";

export const specUpdate = defineCommand({
  ...specUpdateMeta,
  execute: async (input, context) => {
    await projectRoot(context.workdir);
    const { drive, doc: held } = await findSpec(context, input.name);
    const { id, name, documentType } = held.header;
    // The reactor records a failing action without throwing, so the batch is
    // applied to a copy of the held state first and executed only when clean.
    const state = held.state as { global?: unknown; local?: unknown };
    const copy = createSpecDocument(documentType, {
      name,
      initialState: { global: state.global, local: state.local ?? {} },
    });
    const { actions, minted } = normalizeSpecActions(
      copy,
      await resolveActionsInput({
        actions: input.actions,
        from: input.from,
      }),
    );
    let built: Record<string, unknown>[];
    try {
      built = applySpecActions(copy, actions).built;
    } catch (err) {
      enrichActionValidationError(err, documentType);
    }
    // On a v2-required switchboard the client signs them.
    if (built.length > 0) {
      await serialized(() => drive.client.execute(id, "main", built));
    }
    const opsCount = await contentOperationCount(drive, id);
    let text = `Applied ${actions.length} action(s) to ${documentType} "${name}" (now ${opsCount} op(s) total)`;
    if (minted.length > 0) {
      /* The agent omitted these creation ids, so it can't know them; list them
       * so a follow-up action can target the entity. */
      text +=
        `\nMinted id(s) — reference these in later actions:\n` +
        minted
          .map((m) => `  ${m.type}${m.label ? ` "${m.label}"` : ""} → ${m.id}`)
          .join("\n");
    }
    return {
      text,
      data: { documentId: id, documentType, name },
    };
  },
});
